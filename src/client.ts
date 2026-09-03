import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import { COMMANDS, DEFAULT_HOST, DEFAULT_PORT, HANDSHAKE_SIZE, TUNER_NAMES } from './constants';
import { type Handshake, decodeIq, encodeCommand, parseHandshake } from './protocol';

export interface RtlSdrClientOptions {
	host?: string;
	port?: number;

	/** Number of IQ samples included in each 'samples' event. Default 16384. */
	chunkSize?: number;

	/** Milliseconds for TCP connect / handshake before timing out. Default 5000. */
	connectTimeoutMs?: number;

	/** Max IQ samples buffered before dropping the oldest. Default 2_000_000. */
	maxPendingSamples?: number;
}

export interface ConfigureOptions {
	centerFrequency?: number;
	sampleRate?: number;
	autoGain?: boolean;
	gainDb?: number;
	freqCorrectionPpm?: number;
	biasTee?: boolean;
}

export class RtlSdrClient extends EventEmitter {
	private readonly _host: string;
	private readonly _port: number;
	private readonly _chunkBytes: number;
	private readonly _connectTimeoutMs: number;
	private readonly _maxPendingBytes: number;

	private _socket?: net.Socket;
	private _state: 'idle' | 'handshake' | 'stream' = 'idle';
	private _rx = Buffer.alloc(0);
	private _handshake?: Handshake;
	private _pendingCmds = new Set<(e?: Error) => void>();
	private _connectResolve?: (c: RtlSdrClient) => void;
	private _connectReject?: (e: Error) => void;
	private _lastError?: Error;

	private _totalIq = 0;
	private _totalDropped = 0;

	constructor(options: RtlSdrClientOptions = {}) {
		super();
		this._host = options.host ?? DEFAULT_HOST;
		this._port = options.port ?? DEFAULT_PORT;
		const chunkSize = Math.max(1, options.chunkSize ?? 16384);
		this._chunkBytes = chunkSize * 4;
		this._connectTimeoutMs = options.connectTimeoutMs ?? 5000;
		this._maxPendingBytes = Math.max(4, (options.maxPendingSamples ?? 2_000_000) * 4);
	}

	get connected(): boolean {
		return this._state === 'stream';
	}

	get tunerType(): number | undefined {
		return this._handshake?.tunerType;
	}

	get tunerGainCount(): number | undefined {
		return this._handshake?.tunerGainCount;
	}

	get tunerName(): string | undefined {
		return this._handshake ? (TUNER_NAMES[this._handshake.tunerType] ?? 'UNKNOWN') : undefined;
	}

	/** IQ samples currently buffered (not yet emitted). */
	get bufferedSamples(): number {
		return (this._rx.length >> 2) | 0;
	}

	get totalSamplesEmitted(): number {
		return this._totalIq;
	}

	get droppedSamples(): number {
		return this._totalDropped;
	}

	get lastError(): Error | undefined {
		return this._lastError;
	}

	/** Connect to the server and complete the handshake. Resolves with the client. */
	connect(): Promise<RtlSdrClient> {
		if (this._state === 'stream') {
			return Promise.resolve(this);
		}
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

	/** Tear down the connection. Resolves once the socket is closed. */
	async disconnect(): Promise<void> {
		this._finishPending(new Error('Disconnected'));
		const socket = this._socket;
		this._state = 'idle';
		this._rx = Buffer.alloc(0);
		if (socket && !socket.destroyed) {
			await new Promise<void>((resolve) => {
				socket.once('close', () => resolve());
				socket.end();
				socket.destroy();
			});
		}
		// 'disconnect' is emitted from _onClose
	}

	// ---- commands -----------------------------------------------------------
	setCenterFrequency(hz: number): Promise<void> {
		this._checkInt(hz, 'center frequency');
		return this._sendCommand(COMMANDS.CENTER_FREQUENCY, hz);
	}

	setSampleRate(hz: number): Promise<void> {
		this._checkInt(hz, 'sample rate');
		return this._sendCommand(COMMANDS.SAMPLE_RATE, hz);
	}

	setGainMode(auto: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.GAIN_MODE, auto ? 0 : 1);
	}

	setAutoGain(auto: boolean): Promise<void> {
		return this.setGainMode(auto);
	}

	setGain(db: number): Promise<void> {
		if (!Number.isFinite(db)) {
			throw new TypeError('gain (dB) must be a finite number');
		}
		return this._sendCommand(COMMANDS.GAIN, Math.round(db * 10));
	}

	setFreqCorrection(ppm: number): Promise<void> {
		this._checkInt(ppm, 'freq correction (ppm)');
		return this._sendCommand(COMMANDS.FREQ_CORRECTION, ppm);
	}

	setTunerIfGain(ifGain: number, gain: number): Promise<void> {
		const param = ((ifGain & 0xffff) << 16) | (gain & 0xffff);
		return this._sendCommand(COMMANDS.TUNER_IF_GAIN, param);
	}

	setTestMode(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.TEST_MODE, on ? 1 : 0);
	}

	setAfcMode(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.AFC_MODE, on ? 1 : 0);
	}

	setDirectSampling(mode: 0 | 1 | 2): Promise<void> {
		if (mode !== 0 && mode !== 1 && mode !== 2) {
			throw new RangeError('direct sampling mode must be 0, 1 or 2');
		}
		return this._sendCommand(COMMANDS.DIRECT_SAMPLING, mode);
	}

	setOffsetTuning(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.OFFSET_TUNING, on ? 1 : 0);
	}

	setRtlXtal(hz: number): Promise<void> {
		this._checkInt(hz, 'RTL xtal');
		return this._sendCommand(COMMANDS.RTL_XTAL, hz);
	}

	setTunerXtal(hz: number): Promise<void> {
		this._checkInt(hz, 'tuner xtal');
		return this._sendCommand(COMMANDS.TUNER_XTAL, hz);
	}

	setGainByIndex(index: number): Promise<void> {
		this._checkInt(index, 'gain index');
		return this._sendCommand(COMMANDS.GAIN_BY_INDEX, index);
	}

	setBiasTee(on: boolean): Promise<void> {
		return this._sendCommand(COMMANDS.BIAS_TEE, on ? 1 : 0);
	}

	/** Apply a group of settings sequentially. */
	async configure(opts: ConfigureOptions): Promise<void> {
		if (opts.centerFrequency != null) {
			await this.setCenterFrequency(opts.centerFrequency);
		}
		if (opts.sampleRate != null) {
			await this.setSampleRate(opts.sampleRate);
		}
		if (opts.autoGain != null) {
			await this.setGainMode(opts.autoGain);
			if (!opts.autoGain && opts.gainDb != null) {
				await this.setGain(opts.gainDb);
			}
		} else if (opts.gainDb != null) {
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

	// ---- data ---------------------------------------------------------------
	onSamples(cb: (iq: Int16Array) => void): this {
		return this.on('samples', cb);
	}

	pause(): this {
		this._socket?.pause();
		return this;
	}

	resume(): this {
		this._socket?.resume();
		return this;
	}

	/** Emit any buffered (less than a full chunk) IQ samples now. */
	flushSamples(): void {
		if (this._rx.length >= 4) {
			const rem = this._rx;
			this._rx = Buffer.alloc(0);
			this._emitIq(rem);
		}
	}

	// ---- internals ----------------------------------------------------------
	private _onData = (chunk: Buffer): void => {
		this._rx = Buffer.concat([this._rx, chunk]);

		if (this._rx.length > this._maxPendingBytes) {
			const excess = this._rx.length - this._maxPendingBytes;
			this._totalDropped += (excess >> 2) | 0;
			this._rx = Buffer.from(this._rx.subarray(excess));
			this.emit('drop', excess);
		}

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

		if (this._state === 'stream') {
			this._emitLoop();
		}
	};

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

	private _emitIq(slice: Buffer): void {
		const iq = decodeIq(slice);
		const pairs = (iq.length >> 1) | 0;
		if (pairs > 0) {
			this._totalIq += pairs;
		}
		this.emit('samples', iq);
	}

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

	private _onError = (err: Error): void => {
		if (this._connectReject) {
			this._failConnect(err);
			return;
		}
		this._finishPending(err);
		this._lastError = err;
		if (this.listenerCount('error') > 0) {
			this.emit('error', err);
		}
		this._teardown();
	};

	private _onClose = (): void => {
		if (this._connectReject) {
			const reject = this._connectReject;
			this._connectResolve = undefined;
			this._connectReject = undefined;
			this._lastError = new Error('Connection closed before the handshake completed');
			this._teardown();
			reject(this._lastError);
			return;
		}
		this._state = 'idle';
		this._rx = Buffer.alloc(0);
		this._socket = undefined;
		this._finishPending(new Error('Connection closed'));
		this.emit('disconnect');
	};

	private _teardown(): void {
		const s = this._socket;
		this._socket = undefined;
		if (s && !s.destroyed) {
			s.destroy();
		}
	}

	private _finishPending(err: Error): void {
		for (const f of this._pendingCmds) {
			f(err);
		}
		this._pendingCmds.clear();
	}

	private _sendCommand(cmd: number, param: number): Promise<void> {
		const socket = this._socket;
		if (!socket || socket.destroyed || this._state !== 'stream') {
			return Promise.reject(new Error('Not connected to the RTL-SDR server.'));
		}
		return new Promise<void>((resolve, reject) => {
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

	private _checkInt(value: number, label: string): void {
		if (!Number.isInteger(value) || value < -0x7fffffff || value > 0xffffffff) {
			throw new RangeError(`${label} must be an integer within the 32-bit range, got ${value}`);
		}
	}
}
