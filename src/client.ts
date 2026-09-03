/**
 * TCP client for the rtl_tcp server (rtl-sdr-blog fork).
 *
 * Lifecycle: idle -> handshake -> stream.
 * After the handshake the server sends an unframed, continuous stream of
 * IQ samples (int16, I/Q interleaved); the client chunks it into
 * chunkSize I/Q pairs and emits 'samples' events.
 */
import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import {
	COMMANDS,
	DEFAULT_HOST,
	DEFAULT_PORT,
	HANDSHAKE_SIZE,
	MASK_WORD,
	PARAM_MAX,
	PARAM_MIN,
	TUNER_NAMES
} from './constants';
import { type Handshake, decodeIq, encodeCommand, parseHandshake } from './protocol';

/** Connection and streaming options. */
export interface RtlSdrClientOptions {
	/** Server host. Defaults to '127.0.0.1'. */
	host?: string;

	/** Server port. Defaults to 1234. */
	port?: number;

	/**
	 * Number of I/Q pairs per 'samples' event (pair = 2 samples = 4 bytes).
	 * Defaults to 16384.
	 */
	chunkSize?: number;

	/** Timeout (ms) for the TCP connect + handshake. Defaults to 5000. */
	connectTimeoutMs?: number;

	/**
	 * Max I/Q pairs kept in the receive buffer before the oldest ones are
	 * dropped (emits 'drop'). Defaults to 2_000_000.
	 */
	maxPendingSamples?: number;
}

/** A batch of settings applied by configure(). */
export interface ConfigureOptions {
	/** Center frequency, Hz. */
	centerFrequency?: number;
	/** Sample rate, Hz. */
	sampleRate?: number;
	/** Auto gain (AGC): true = enabled. */
	autoGain?: boolean;
	/** Manual gain, dB (applied when autoGain === false). */
	gainDb?: number;
	/** Frequency correction, PPM. */
	freqCorrectionPpm?: number;
	/** Bias-tee: true = enabled. */
	biasTee?: boolean;
}

/**
 * rtl_tcp client with an event-based API (extends EventEmitter).
 *
 * Events: 'connect', 'samples', 'drop', 'error', 'disconnect'.
 */
export class RtlSdrClient extends EventEmitter {
	private readonly _host: string;
	private readonly _port: number;
	/** 'samples' event chunk size in bytes (chunkSize pairs * 4). */
	private readonly _chunkBytes: number;
	private readonly _connectTimeoutMs: number;
	/** Max receive buffer size in bytes (maxPendingSamples * 4). */
	private readonly _maxPendingBytes: number;

	private _socket?: net.Socket;

	/** Connection state machine: idle -> handshake -> stream. */
	private _state: 'idle' | 'handshake' | 'stream' = 'idle';

	/** Receive buffer: accumulated IQ bytes not yet emitted to listeners. */
	private _rx = Buffer.alloc(0);
	private _handshake?: Handshake;

	/**
	 * In-flight command callbacks. Each command "resolves" when the socket
	 * write completes (or fails), since rtl_tcp has no command acknowledgements.
	 */
	private _pendingCmds = new Set<(e?: Error) => void>();
	private _connectResolve?: (c: RtlSdrClient) => void;
	private _connectReject?: (e: Error) => void;
	private _lastError?: Error;

	/** Counters: total I/Q pairs emitted, and total pairs dropped by the buffer cap. */
	private _totalIq = 0;
	private _totalDropped = 0;

	constructor(options: RtlSdrClientOptions = {}) {
		super();
		this._host = options.host ?? DEFAULT_HOST;
		this._port = options.port ?? DEFAULT_PORT;
		// Each I/Q pair takes 4 bytes (2 x int16).
		const chunkSize = Math.max(1, options.chunkSize ?? 16384);
		this._chunkBytes = chunkSize * 4;
		this._connectTimeoutMs = options.connectTimeoutMs ?? 5000;
		this._maxPendingBytes = Math.max(4, (options.maxPendingSamples ?? 2_000_000) * 4);
	}

	/** True once the handshake completed and the stream is active. */
	get connected(): boolean {
		return this._state === 'stream';
	}

	/** Tuner type from the handshake (a key of TUNER_NAMES). */
	get tunerType(): number | undefined {
		return this._handshake?.tunerType;
	}

	/** Tuner gain step count from the handshake. */
	get tunerGainCount(): number | undefined {
		return this._handshake?.tunerGainCount;
	}

	/** Human-readable tuner name (undefined until the handshake). */
	get tunerName(): string | undefined {
		return this._handshake ? (TUNER_NAMES[this._handshake.tunerType] ?? 'UNKNOWN') : undefined;
	}

	/** I/Q pairs currently buffered (not yet emitted). */
	get bufferedSamples(): number {
		return (this._rx.length >> 2) | 0;
	}

	/** Total I/Q pairs emitted in 'samples' events since connect. */
	get totalSamplesEmitted(): number {
		return this._totalIq;
	}

	/** Total I/Q pairs dropped when maxPendingSamples was exceeded. */
	get droppedSamples(): number {
		return this._totalDropped;
	}

	/** Most recent error, if any. */
	get lastError(): Error | undefined {
		return this._lastError;
	}

	/**
	 * Connects to the server and waits for the handshake.
	 * Resolves with the client itself; rejects on error.
	 */
	connect(): Promise<RtlSdrClient> {
		// Already streaming — just return the live client.
		if (this._state === 'stream') {
			return Promise.resolve(this);
		}
		// A socket already exists (connect in progress) — don't start another.
		if (this._socket) {
			return Promise.reject(new Error('A connection is already in progress or established.'));
		}

		const socket = net.connect({
			host: this._host,
			port: this._port,
			timeout: this._connectTimeoutMs
		});
		this._socket = socket;
		this._state = 'handshake';

		// Promise that settles once the handshake is done.
		const promise = new Promise<RtlSdrClient>((resolve, reject) => {
			this._connectResolve = resolve;
			this._connectReject = reject;
		});

		socket.on('data', this._onData);
		socket.on('error', this._onError);
		socket.once('close', this._onClose);
		socket.once('timeout', () => {
			this._onError(new Error(`Connection timed out after ${this._connectTimeoutMs} ms`));
			socket.destroy();
		});

		return promise;
	}

	/**
	 * Tears down the connection. Resolves once the socket is actually closed.
	 * The 'disconnect' event is emitted from _onClose.
	 */
	async disconnect(): Promise<void> {
		// Settle any in-flight commands with an error.
		this._finishPending(new Error('Disconnected'));
		const socket = this._socket;
		this._state = 'idle';
		this._rx = Buffer.alloc(0);
		if (socket && !socket.destroyed) {
			// Wait for the real close so the promise settles deterministically.
			await new Promise<void>((resolve) => {
				socket.once('close', () => resolve());
				socket.end();
				socket.destroy();
			});
		}
		// 'disconnect' is emitted from _onClose.
	}

	// ---- commands (client -> server) -------------------------------------

	/** Sets the center frequency, Hz. */
	setCenterFrequency(hz: number): Promise<void> {
		this._checkInt(hz, 'center frequency');
		return this._sendCommand(COMMANDS.CENTER_FREQUENCY, hz);
	}

	/** Sets the sample rate, Hz. */
	setSampleRate(hz: number): Promise<void> {
		this._checkInt(hz, 'sample rate');
		return this._sendCommand(COMMANDS.SAMPLE_RATE, hz);
	}

	/** Gain mode: true = auto (AGC, param 0), false = manual (param 1). */
	setGainMode(auto: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.GAIN_MODE, auto ? 0 : 1);
	}

	/** Alias of setGainMode (for SDR#-style API compatibility). */
	setAutoGain(auto: boolean): Promise<void> {
		return this.setGainMode(auto);
	}

	/**
	 * Sets manual gain in dB.
	 * The protocol transmits gain in 0.1 dB steps, hence db * 10.
	 */
	setGain(db: number): Promise<void> {
		if (!Number.isFinite(db)) {
			throw new TypeError('gain (dB) must be a finite number');
		}
		return this._sendCommand(COMMANDS.GAIN, Math.round(db * 10));
	}

	/** Sets frequency correction in PPM (parts per million). */
	setFreqCorrection(ppm: number): Promise<void> {
		this._checkInt(ppm, 'freq correction (ppm)');
		return this._sendCommand(COMMANDS.FREQ_CORRECTION, ppm);
	}

	/**
	 * Sets the tuner IF gain.
	 * Parameter packing: upper 16 bits — ifGain, lower 16 — gain.
	 */
	setTunerIfGain(ifGain: number, gain: number): Promise<void> {
		const param = ((ifGain & MASK_WORD) << 16) | (gain & MASK_WORD);
		return this._sendCommand(COMMANDS.TUNER_IF_GAIN, param);
	}

	/** Test mode (internal signal generator): true = on. */
	setTestMode(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.TEST_MODE, on ? 1 : 0);
	}

	/** AFC (auto frequency control): true = on. */
	setAfcMode(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.AFC_MODE, on ? 1 : 0);
	}

	/** Direct sampling: 0 = off, 1 = I only, 2 = Q only. */
	setDirectSampling(mode: 0 | 1 | 2): Promise<void> {
		if (mode !== 0 && mode !== 1 && mode !== 2) {
			throw new RangeError('direct sampling mode must be 0, 1 or 2');
		}
		return this._sendCommand(COMMANDS.DIRECT_SAMPLING, mode);
	}

	/** Offset tuning (IF offset): true = on. */
	setOffsetTuning(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.OFFSET_TUNING, on ? 1 : 0);
	}

	/** RTL-SDR crystal frequency, Hz (for drift correction). */
	setRtlXtal(hz: number): Promise<void> {
		this._checkInt(hz, 'RTL xtal');
		return this._sendCommand(COMMANDS.RTL_XTAL, hz);
	}

	/** Tuner crystal frequency, Hz. */
	setTunerXtal(hz: number): Promise<void> {
		this._checkInt(hz, 'tuner xtal');
		return this._sendCommand(COMMANDS.TUNER_XTAL, hz);
	}

	/** Sets gain by step index (0..tunerGainCount-1). */
	setGainByIndex(index: number): Promise<void> {
		this._checkInt(index, 'gain index');
		return this._sendCommand(COMMANDS.GAIN_BY_INDEX, index);
	}

	/** Bias-tee (LNA power over the line): true = on. */
	setBiasTee(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.BIAS_TEE, on ? 1 : 0);
	}

	/**
	 * Applies a batch of settings sequentially, in this order:
	 * frequency -> sample rate -> gain mode/value -> PPM -> bias-tee.
	 */
	async configure(opts: ConfigureOptions): Promise<void> {
		if (opts.centerFrequency != null) {
			await this.setCenterFrequency(opts.centerFrequency);
		}
		if (opts.sampleRate != null) {
			await this.setSampleRate(opts.sampleRate);
		}
		// Gain value only makes sense after the mode (auto/manual) is set.
		if (opts.autoGain != null) {
			await this.setGainMode(opts.autoGain);
			if (!opts.autoGain && opts.gainDb != null) {
				await this.setGain(opts.gainDb);
			}
		} else if (opts.gainDb != null) {
			// autoGain not specified but gainDb is — switch to manual mode first.
			await this.setGainMode(false);
			await this.setGain(opts.gainDb);
		}
		if (opts.freqCorrectionPpm != null) {
			await this.setFreqCorrection(opts.freqCorrectionPpm);
		}
		if (opts.biasTee != null) {
			await this.setBiasTee(opts.biasTee);
		}
	}

	// ---- data (server -> client) -----------------------------------------

	/** Subscribes to IQ samples; equivalent to on('samples', cb). */
	onSamples(cb: (iq: Int16Array) => void): this {
		return this.on('samples', cb);
	}

	/** Pauses the stream (TCP flow control); data keeps buffering in the OS. */
	pause(): this {
		this._socket?.pause();
		return this;
	}

	/** Resumes the stream after pause(). */
	resume(): this {
		this._socket?.resume();
		return this;
	}

	/**
	 * Emits the leftover tail immediately (if the buffer holds at least
	 * one I/Q pair but less than a full chunkSize).
	 */
	flushSamples(): void {
		if (this._rx.length >= 4) {
			const rem = this._rx;
			this._rx = Buffer.alloc(0);
			this._emitIq(rem);
		}
	}

	// ---- internals --------------------------------------------------------

	/**
	 * Incoming data handler.
	 *
	 * After the handshake the server streams IQ bytes with no framing,
	 * so we accumulate them in _rx, cap the buffer, and hand full
	 * chunks to listeners via _emitLoop.
	 */
	private _onData = (chunk: Buffer): void => {
		this._rx = Buffer.concat([this._rx, chunk]);

		// Buffer over the cap: drop the oldest bytes and count the loss.
		if (this._rx.length > this._maxPendingBytes) {
			const excess = this._rx.length - this._maxPendingBytes;
			this._totalDropped += (excess >> 2) | 0;
			this._rx = Buffer.from(this._rx.subarray(excess));
			this.emit('drop', excess);
		}

		// Handshake phase: wait for the full 12-byte header.
		if (this._state === 'handshake') {
			if (this._rx.length >= HANDSHAKE_SIZE) {
				let handshake: Handshake;

				try {
					handshake = parseHandshake(this._rx.subarray(0, HANDSHAKE_SIZE));
				} catch (err) {
					this._failConnect(err instanceof Error ? err : new Error(String(err)));
					return;
				}

				this._handshake = handshake;
				// Everything after the 12-byte header is IQ data.
				this._rx = Buffer.from(this._rx.subarray(HANDSHAKE_SIZE));
				this._state = 'stream';
				const resolve = this._connectResolve;
				this._connectResolve = undefined;
				this._connectReject = undefined;
				this.emit('connect');
				this._emitLoop();
				resolve?.(this);
			}

			return;
		}

		// Stream phase: emit full chunks, keep the partial tail in _rx.
		if (this._state === 'stream') {
			this._emitLoop();
		}
	};

	/**
	 * Emits all complete _chunkBytes-sized chunks from _rx.
	 * The partial tail (if any) stays in _rx until more data arrives.
	 */
	private _emitLoop(): void {
		const data = this._rx;
		const cb = this._chunkBytes;
		const nWhole = Math.floor(data.length / cb);
		let offset = 0;
		for (let i = 0; i < nWhole; i++) {
			this._emitIq(data.subarray(offset, offset + cb));
			offset += cb;
		}
		if (offset > 0) {
			this._rx = Buffer.from(data.subarray(offset));
		}
	}

	/** Decodes one chunk into an Int16Array and emits the 'samples' event. */
	private _emitIq(slice: Buffer): void {
		const iq = decodeIq(slice);
		const pairs = (iq.length >> 1) | 0;
		if (pairs > 0) {
			this._totalIq += pairs;
		}
		this.emit('samples', iq);
	}

	/**
	 * Fails the connect: rejects the connect promise, emits 'error'
	 * (if listened) and tears the socket down.
	 */
	private _failConnect(err: Error): void {
		const reject = this._connectReject;
		this._connectResolve = undefined;
		this._connectReject = undefined;
		this._lastError = err;
		if (this.listenerCount('error') > 0) {
			this.emit('error', err);
		}
		this._teardown();
		reject?.(err);
	}

	/** Socket error handler. */
	private _onError = (err: Error): void => {
		// Handshake still pending — fail the connect itself.
		if (this._connectReject) {
			this._failConnect(err);
			return;
		}
		// Otherwise the connection was established — fail all pending commands.
		this._finishPending(err);
		this._lastError = err;
		if (this.listenerCount('error') > 0) {
			this.emit('error', err);
		}
		this._teardown();
	};

	/**
	 * Socket close handler (incl. server-side disconnect).
	 * Emits 'disconnect' when the connection had been established.
	 */
	private _onClose = (): void => {
		// Closed before the handshake finished — fail the connect.
		if (this._connectReject) {
			const reject = this._connectReject;
			this._connectResolve = undefined;
			this._connectReject = undefined;
			this._lastError = new Error('Connection closed before the handshake completed');
			this._teardown();
			reject(this._lastError);
			return;
		}
		// Connection was established — emit 'disconnect'.
		this._state = 'idle';
		this._rx = Buffer.alloc(0);
		this._socket = undefined;
		this._finishPending(new Error('Connection closed'));
		this.emit('disconnect');
	};

	/** Destroys the socket and clears the reference to it. */
	private _teardown(): void {
		const s = this._socket;
		this._socket = undefined;
		if (s && !s.destroyed) {
			s.destroy();
		}
	}

	/** Settles all pending commands with the given error. */
	private _finishPending(err: Error): void {
		for (const f of this._pendingCmds) {
			f(err);
		}
		this._pendingCmds.clear();
	}

	/**
	 * Sends a 5-byte command and awaits the socket write callback.
	 * rtl_tcp has no command acknowledgements, so success =
	 * a completed write (data queued into the TCP buffer).
	 */
	private _sendCommand(cmd: number, param: number): Promise<void> {
		const socket = this._socket;
		if (!socket || socket.destroyed || this._state !== 'stream') {
			return Promise.reject(new Error('Not connected to the RTL-SDR server.'));
		}
		return new Promise<void>((resolve, reject) => {
			// done() is invoked exactly once: on success or on error.
			const done = (e?: Error): void => {
				this._pendingCmds.delete(done);
				if (e) {
					reject(e);
				} else {
					resolve();
				}
			};
			this._pendingCmds.add(done);
			socket.write(encodeCommand(cmd, param), (err) => done(err ?? undefined));
		});
	}

	/** Validates that a value is an integer fitting the 32-bit command parameter. */
	private _checkInt(value: number, label: string): void {
		if (!Number.isInteger(value) || value < PARAM_MIN || value > PARAM_MAX) {
			throw new RangeError(`${label} must be an integer within the 32-bit range, got ${value}`);
		}
	}
}
