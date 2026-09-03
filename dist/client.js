"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RtlSdrClient = void 0;
/**
 * TCP client for the rtl_tcp server (rtl-sdr-blog fork).
 *
 * Lifecycle: idle -> handshake -> stream.
 * After the handshake the server sends an unframed, continuous stream of
 * IQ samples (int16, I/Q interleaved); the client chunks it into
 * chunkSize I/Q pairs and emits 'samples' events.
 */
const node_events_1 = require("node:events");
const net = __importStar(require("node:net"));
const constants_1 = require("./constants");
const protocol_1 = require("./protocol");
/**
 * rtl_tcp client with an event-based API (extends EventEmitter).
 *
 * Events: 'connect', 'samples', 'drop', 'error', 'disconnect'.
 */
class RtlSdrClient extends node_events_1.EventEmitter {
    constructor(options = {}) {
        super();
        /** Connection state machine: idle -> handshake -> stream. */
        this._state = 'idle';
        /** Receive buffer: accumulated IQ bytes not yet emitted to listeners. */
        this._rx = Buffer.alloc(0);
        /**
         * In-flight command callbacks. Each command "resolves" when the socket
         * write completes (or fails), since rtl_tcp has no command acknowledgements.
         */
        this._pendingCmds = new Set();
        /** Counters: total I/Q pairs emitted, and total pairs dropped by the buffer cap. */
        this._totalIq = 0;
        this._totalDropped = 0;
        // ---- internals --------------------------------------------------------
        /**
         * Incoming data handler.
         *
         * After the handshake the server streams IQ bytes with no framing,
         * so we accumulate them in _rx, cap the buffer, and hand full
         * chunks to listeners via _emitLoop.
         */
        this._onData = (chunk) => {
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
                if (this._rx.length >= constants_1.HANDSHAKE_SIZE) {
                    let handshake;
                    try {
                        handshake = (0, protocol_1.parseHandshake)(this._rx.subarray(0, constants_1.HANDSHAKE_SIZE));
                    }
                    catch (err) {
                        this._failConnect(err instanceof Error ? err : new Error(String(err)));
                        return;
                    }
                    this._handshake = handshake;
                    // Everything after the 12-byte header is IQ data.
                    this._rx = Buffer.from(this._rx.subarray(constants_1.HANDSHAKE_SIZE));
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
        /** Socket error handler. */
        this._onError = (err) => {
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
        this._onClose = () => {
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
        this._host = options.host ?? constants_1.DEFAULT_HOST;
        this._port = options.port ?? constants_1.DEFAULT_PORT;
        // Each I/Q pair takes 4 bytes (2 x int16).
        const chunkSize = Math.max(1, options.chunkSize ?? 16384);
        this._chunkBytes = chunkSize * 4;
        this._connectTimeoutMs = options.connectTimeoutMs ?? 5000;
        this._maxPendingBytes = Math.max(4, (options.maxPendingSamples ?? 2000000) * 4);
    }
    /** True once the handshake completed and the stream is active. */
    get connected() {
        return this._state === 'stream';
    }
    /** Tuner type from the handshake (a key of TUNER_NAMES). */
    get tunerType() {
        return this._handshake?.tunerType;
    }
    /** Tuner gain step count from the handshake. */
    get tunerGainCount() {
        return this._handshake?.tunerGainCount;
    }
    /** Human-readable tuner name (undefined until the handshake). */
    get tunerName() {
        return this._handshake ? (constants_1.TUNER_NAMES[this._handshake.tunerType] ?? 'UNKNOWN') : undefined;
    }
    /** I/Q pairs currently buffered (not yet emitted). */
    get bufferedSamples() {
        return (this._rx.length >> 2) | 0;
    }
    /** Total I/Q pairs emitted in 'samples' events since connect. */
    get totalSamplesEmitted() {
        return this._totalIq;
    }
    /** Total I/Q pairs dropped when maxPendingSamples was exceeded. */
    get droppedSamples() {
        return this._totalDropped;
    }
    /** Most recent error, if any. */
    get lastError() {
        return this._lastError;
    }
    /**
     * Connects to the server and waits for the handshake.
     * Resolves with the client itself; rejects on error.
     */
    connect() {
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
        const promise = new Promise((resolve, reject) => {
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
    async disconnect() {
        // Settle any in-flight commands with an error.
        this._finishPending(new Error('Disconnected'));
        const socket = this._socket;
        this._state = 'idle';
        this._rx = Buffer.alloc(0);
        if (socket && !socket.destroyed) {
            // Wait for the real close so the promise settles deterministically.
            await new Promise((resolve) => {
                socket.once('close', () => resolve());
                socket.end();
                socket.destroy();
            });
        }
        // 'disconnect' is emitted from _onClose.
    }
    // ---- commands (client -> server) -------------------------------------
    /** Sets the center frequency, Hz. */
    setCenterFrequency(hz) {
        this._checkInt(hz, 'center frequency');
        return this._sendCommand(constants_1.COMMANDS.CENTER_FREQUENCY, hz);
    }
    /** Sets the sample rate, Hz. */
    setSampleRate(hz) {
        this._checkInt(hz, 'sample rate');
        return this._sendCommand(constants_1.COMMANDS.SAMPLE_RATE, hz);
    }
    /** Gain mode: true = auto (AGC, param 0), false = manual (param 1). */
    setGainMode(auto) {
        return this._sendCommand(constants_1.COMMANDS.GAIN_MODE, auto ? 0 : 1);
    }
    /** Alias of setGainMode (for SDR#-style API compatibility). */
    setAutoGain(auto) {
        return this.setGainMode(auto);
    }
    /**
     * Sets manual gain in dB.
     * The protocol transmits gain in 0.1 dB steps, hence db * 10.
     */
    setGain(db) {
        if (!Number.isFinite(db)) {
            throw new TypeError('gain (dB) must be a finite number');
        }
        return this._sendCommand(constants_1.COMMANDS.GAIN, Math.round(db * 10));
    }
    /** Sets frequency correction in PPM (parts per million). */
    setFreqCorrection(ppm) {
        this._checkInt(ppm, 'freq correction (ppm)');
        return this._sendCommand(constants_1.COMMANDS.FREQ_CORRECTION, ppm);
    }
    /**
     * Sets the tuner IF gain.
     * Parameter packing: upper 16 bits — ifGain, lower 16 — gain.
     */
    setTunerIfGain(ifGain, gain) {
        const param = ((ifGain & constants_1.MASK_WORD) << 16) | (gain & constants_1.MASK_WORD);
        return this._sendCommand(constants_1.COMMANDS.TUNER_IF_GAIN, param);
    }
    /** Test mode (internal signal generator): true = on. */
    setTestMode(on) {
        return this._sendCommand(constants_1.COMMANDS.TEST_MODE, on ? 1 : 0);
    }
    /** AFC (auto frequency control): true = on. */
    setAfcMode(on) {
        return this._sendCommand(constants_1.COMMANDS.AFC_MODE, on ? 1 : 0);
    }
    /** Direct sampling: 0 = off, 1 = I only, 2 = Q only. */
    setDirectSampling(mode) {
        if (mode !== 0 && mode !== 1 && mode !== 2) {
            throw new RangeError('direct sampling mode must be 0, 1 or 2');
        }
        return this._sendCommand(constants_1.COMMANDS.DIRECT_SAMPLING, mode);
    }
    /** Offset tuning (IF offset): true = on. */
    setOffsetTuning(on) {
        return this._sendCommand(constants_1.COMMANDS.OFFSET_TUNING, on ? 1 : 0);
    }
    /** RTL-SDR crystal frequency, Hz (for drift correction). */
    setRtlXtal(hz) {
        this._checkInt(hz, 'RTL xtal');
        return this._sendCommand(constants_1.COMMANDS.RTL_XTAL, hz);
    }
    /** Tuner crystal frequency, Hz. */
    setTunerXtal(hz) {
        this._checkInt(hz, 'tuner xtal');
        return this._sendCommand(constants_1.COMMANDS.TUNER_XTAL, hz);
    }
    /** Sets gain by step index (0..tunerGainCount-1). */
    setGainByIndex(index) {
        this._checkInt(index, 'gain index');
        return this._sendCommand(constants_1.COMMANDS.GAIN_BY_INDEX, index);
    }
    /** Bias-tee (LNA power over the line): true = on. */
    setBiasTee(on) {
        return this._sendCommand(constants_1.COMMANDS.BIAS_TEE, on ? 1 : 0);
    }
    /**
     * Applies a batch of settings sequentially, in this order:
     * frequency -> sample rate -> gain mode/value -> PPM -> bias-tee.
     */
    async configure(opts) {
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
        }
        else if (opts.gainDb != null) {
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
    onSamples(cb) {
        return this.on('samples', cb);
    }
    /** Pauses the stream (TCP flow control); data keeps buffering in the OS. */
    pause() {
        this._socket?.pause();
        return this;
    }
    /** Resumes the stream after pause(). */
    resume() {
        this._socket?.resume();
        return this;
    }
    /**
     * Emits the leftover tail immediately (if the buffer holds at least
     * one I/Q pair but less than a full chunkSize).
     */
    flushSamples() {
        if (this._rx.length >= 4) {
            const rem = this._rx;
            this._rx = Buffer.alloc(0);
            this._emitIq(rem);
        }
    }
    /**
     * Emits all complete _chunkBytes-sized chunks from _rx.
     * The partial tail (if any) stays in _rx until more data arrives.
     */
    _emitLoop() {
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
    _emitIq(slice) {
        const iq = (0, protocol_1.decodeIq)(slice);
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
    _failConnect(err) {
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
    /** Destroys the socket and clears the reference to it. */
    _teardown() {
        const s = this._socket;
        this._socket = undefined;
        if (s && !s.destroyed) {
            s.destroy();
        }
    }
    /** Settles all pending commands with the given error. */
    _finishPending(err) {
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
    _sendCommand(cmd, param) {
        const socket = this._socket;
        if (!socket || socket.destroyed || this._state !== 'stream') {
            return Promise.reject(new Error('Not connected to the RTL-SDR server.'));
        }
        return new Promise((resolve, reject) => {
            // done() is invoked exactly once: on success or on error.
            const done = (e) => {
                this._pendingCmds.delete(done);
                if (e) {
                    reject(e);
                }
                else {
                    resolve();
                }
            };
            this._pendingCmds.add(done);
            socket.write((0, protocol_1.encodeCommand)(cmd, param), (err) => done(err ?? undefined));
        });
    }
    /** Validates that a value is an integer fitting the 32-bit command parameter. */
    _checkInt(value, label) {
        if (!Number.isInteger(value) || value < constants_1.PARAM_MIN || value > constants_1.PARAM_MAX) {
            throw new RangeError(`${label} must be an integer within the 32-bit range, got ${value}`);
        }
    }
}
exports.RtlSdrClient = RtlSdrClient;
//# sourceMappingURL=client.js.map