/**
 * TCP client for the rtl_tcp server (rtl-sdr-blog fork).
 *
 * Lifecycle: idle -> handshake -> stream.
 * After the handshake the server sends an unframed, continuous stream of
 * IQ samples (int16, I/Q interleaved); the client chunks it into
 * chunkSize I/Q pairs and emits 'samples' events.
 */
import { EventEmitter } from 'node:events';
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
export declare class RtlSdrClient extends EventEmitter {
    private readonly _host;
    private readonly _port;
    /** 'samples' event chunk size in bytes (chunkSize pairs * 4). */
    private readonly _chunkBytes;
    private readonly _connectTimeoutMs;
    /** Max receive buffer size in bytes (maxPendingSamples * 4). */
    private readonly _maxPendingBytes;
    private _socket?;
    /** Connection state machine: idle -> handshake -> stream. */
    private _state;
    /** Receive buffer: accumulated IQ bytes not yet emitted to listeners. */
    private _rx;
    private _handshake?;
    /**
     * In-flight command callbacks. Each command "resolves" when the socket
     * write completes (or fails), since rtl_tcp has no command acknowledgements.
     */
    private _pendingCmds;
    private _connectResolve?;
    private _connectReject?;
    private _lastError?;
    /** Counters: total I/Q pairs emitted, and total pairs dropped by the buffer cap. */
    private _totalIq;
    private _totalDropped;
    constructor(options?: RtlSdrClientOptions);
    /** True once the handshake completed and the stream is active. */
    get connected(): boolean;
    /** Tuner type from the handshake (a key of TUNER_NAMES). */
    get tunerType(): number | undefined;
    /** Tuner gain step count from the handshake. */
    get tunerGainCount(): number | undefined;
    /** Human-readable tuner name (undefined until the handshake). */
    get tunerName(): string | undefined;
    /** I/Q pairs currently buffered (not yet emitted). */
    get bufferedSamples(): number;
    /** Total I/Q pairs emitted in 'samples' events since connect. */
    get totalSamplesEmitted(): number;
    /** Total I/Q pairs dropped when maxPendingSamples was exceeded. */
    get droppedSamples(): number;
    /** Most recent error, if any. */
    get lastError(): Error | undefined;
    /**
     * Connects to the server and waits for the handshake.
     * Resolves with the client itself; rejects on error.
     */
    connect(): Promise<RtlSdrClient>;
    /**
     * Tears down the connection. Resolves once the socket is actually closed.
     * The 'disconnect' event is emitted from _onClose.
     */
    disconnect(): Promise<void>;
    /** Sets the center frequency, Hz. */
    setCenterFrequency(hz: number): Promise<void>;
    /** Sets the sample rate, Hz. */
    setSampleRate(hz: number): Promise<void>;
    /** Gain mode: true = auto (AGC, param 0), false = manual (param 1). */
    setGainMode(auto: boolean): Promise<void>;
    /** Alias of setGainMode (for SDR#-style API compatibility). */
    setAutoGain(auto: boolean): Promise<void>;
    /**
     * Sets manual gain in dB.
     * The protocol transmits gain in 0.1 dB steps, hence db * 10.
     */
    setGain(db: number): Promise<void>;
    /** Sets frequency correction in PPM (parts per million). */
    setFreqCorrection(ppm: number): Promise<void>;
    /**
     * Sets the tuner IF gain.
     * Parameter packing: upper 16 bits — ifGain, lower 16 — gain.
     */
    setTunerIfGain(ifGain: number, gain: number): Promise<void>;
    /** Test mode (internal signal generator): true = on. */
    setTestMode(on: boolean): Promise<void>;
    /** AFC (auto frequency control): true = on. */
    setAfcMode(on: boolean): Promise<void>;
    /** Direct sampling: 0 = off, 1 = I only, 2 = Q only. */
    setDirectSampling(mode: 0 | 1 | 2): Promise<void>;
    /** Offset tuning (IF offset): true = on. */
    setOffsetTuning(on: boolean): Promise<void>;
    /** RTL-SDR crystal frequency, Hz (for drift correction). */
    setRtlXtal(hz: number): Promise<void>;
    /** Tuner crystal frequency, Hz. */
    setTunerXtal(hz: number): Promise<void>;
    /** Sets gain by step index (0..tunerGainCount-1). */
    setGainByIndex(index: number): Promise<void>;
    /** Bias-tee (LNA power over the line): true = on. */
    setBiasTee(on: boolean): Promise<void>;
    /**
     * Applies a batch of settings sequentially, in this order:
     * frequency -> sample rate -> gain mode/value -> PPM -> bias-tee.
     */
    configure(opts: ConfigureOptions): Promise<void>;
    /** Subscribes to IQ samples; equivalent to on('samples', cb). */
    onSamples(cb: (iq: Int16Array) => void): this;
    /** Pauses the stream (TCP flow control); data keeps buffering in the OS. */
    pause(): this;
    /** Resumes the stream after pause(). */
    resume(): this;
    /**
     * Emits the leftover tail immediately (if the buffer holds at least
     * one I/Q pair but less than a full chunkSize).
     */
    flushSamples(): void;
    /**
     * Incoming data handler.
     *
     * After the handshake the server streams IQ bytes with no framing,
     * so we accumulate them in _rx, cap the buffer, and hand full
     * chunks to listeners via _emitLoop.
     */
    private _onData;
    /**
     * Emits all complete _chunkBytes-sized chunks from _rx.
     * The partial tail (if any) stays in _rx until more data arrives.
     */
    private _emitLoop;
    /** Decodes one chunk into an Int16Array and emits the 'samples' event. */
    private _emitIq;
    /**
     * Fails the connect: rejects the connect promise, emits 'error'
     * (if listened) and tears the socket down.
     */
    private _failConnect;
    /** Socket error handler. */
    private _onError;
    /**
     * Socket close handler (incl. server-side disconnect).
     * Emits 'disconnect' when the connection had been established.
     */
    private _onClose;
    /** Destroys the socket and clears the reference to it. */
    private _teardown;
    /** Settles all pending commands with the given error. */
    private _finishPending;
    /**
     * Sends a 5-byte command and awaits the socket write callback.
     * rtl_tcp has no command acknowledgements, so success =
     * a completed write (data queued into the TCP buffer).
     */
    private _sendCommand;
    /** Validates that a value is an integer fitting the 32-bit command parameter. */
    private _checkInt;
}
//# sourceMappingURL=client.d.ts.map