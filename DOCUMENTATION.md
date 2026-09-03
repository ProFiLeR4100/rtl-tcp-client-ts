# rtl-tcp-client — API Documentation

A small, zero-dependency TypeScript client for the `rtl_tcp` server (rtl-sdr-blog fork). It connects over TCP, performs
the 12-byte `RTL0` handshake, sends 5-byte control commands, and streams decoded int16 interleaved IQ samples.

Lifecycle: `idle -> handshake -> stream`. After the handshake the server sends an unframed, continuous stream of IQ
samples (int16, I/Q interleaved); the client chunks it into `chunkSize` I/Q pairs and emits `samples` events.

All methods below belong to the `RtlSdrClient` class (`src/client.ts`), the public API exported from `src/index.ts`.

---

## Constructor

### `new RtlSdrClient(options?: RtlSdrClientOptions)`

Creates a client instance (does **not** connect yet).

| Option              | Type     | Default       | Description                                                                                 |
| ------------------- | -------- | ------------- | ------------------------------------------------------------------------------------------- |
| `host`              | `string` | `'127.0.0.1'` | Server host.                                                                                |
| `port`              | `number` | `1234`        | Server port.                                                                                |
| `chunkSize`         | `number` | `16384`       | Number of I/Q pairs per `samples` event (1 pair = 2 samples = 4 bytes). Minimum 1.          |
| `connectTimeoutMs`  | `number` | `5000`        | Timeout in milliseconds for the TCP connect + handshake.                                    |
| `maxPendingSamples` | `number` | `2000000`     | Max I/Q pairs kept in the receive buffer before the oldest ones are dropped (emits `drop`). |

---

## Connection

### `connect(): Promise<RtlSdrClient>`

Connects to the server and waits for the 12-byte handshake to complete.

- Resolves with the client instance itself.
- If the client is already streaming, resolves immediately with the live client.
- If a connection is already in progress, rejects with
  `Error('A connection is already in progress or established.')`.
- Rejects on TCP error, handshake parse failure (`ProtocolError`), or timeout
  (`Error('Connection timed out after N ms')`).

### `disconnect(): Promise<void>`

Tears down the connection. Resolves once the socket is actually closed. All in-flight command promises are rejected with
`Error('Disconnected')`. The `disconnect` event is emitted when the close completes.

---

## State getters

### `get connected(): boolean`

`true` once the handshake completed and the stream is active.

### `get tunerType(): number | undefined`

Tuner type from the handshake (a key of `TUNER_NAMES`). `undefined` until connected.

### `get tunerGainCount(): number | undefined`

Tuner gain step count from the handshake. `undefined` until connected.

### `get tunerName(): string | undefined`

Human-readable tuner name (`UNKNOWN`, `E4000`, `FC0012`, `FC0013`, `FC2580`, `R820T`, `R828D`).
`undefined` until the handshake.

### `get bufferedSamples(): number`

I/Q pairs currently buffered in the receive buffer (not yet emitted to listeners).

### `get totalSamplesEmitted(): number`

Total I/Q pairs emitted in `samples` events since connect.

### `get droppedSamples(): number`

Total I/Q pairs dropped when the `maxPendingSamples` buffer cap was exceeded.

### `get lastError(): Error | undefined`

Most recent error, if any.

---

## Control commands (client → server)

Every command method returns `Promise<void>`. Since `rtl_tcp` has no command acknowledgements, a promise resolves when
the 5-byte frame has been written to the socket (queued into the TCP buffer), or rejects on socket/connection error.
Calling any command while not connected rejects with
`Error('Not connected to the RTL-SDR server.')`.

### `setCenterFrequency(hz: number): Promise<void>`

Sets the center frequency in Hz. `hz` must be an integer within the signed 32-bit range (enforced client-side; otherwise
`RangeError`). Protocol: command `0x01`.

### `setSampleRate(hz: number): Promise<void>`

Sets the sample rate in Hz. Same 32-bit integer validation. Protocol: command `0x02`.

### `setGainMode(auto: boolean): Promise<void>`

Sets the gain mode: `true` = automatic (AGC), `false` = manual. Protocol: command `0x03` (param 0 = auto, 1 = manual).

### `setAutoGain(auto: boolean): Promise<void>`

Alias of `setGainMode(auto)` (SDR#-style API compatibility).

### `setGain(db: number): Promise<void>`

Sets the manual gain in dB. The value must be a finite number; the protocol transmits gain in 0.1 dB steps, so the sent
parameter is `Math.round(db * 10)` (e.g. 3.0 dB → 30). Only effective when the gain mode is manual. Protocol: command
`0x04`.

### `setFreqCorrection(ppm: number): Promise<void>`

Sets the frequency correction in PPM (parts per million), used to compensate for crystal drift. 32-bit integer
validation. Protocol: command `0x05`.

### `setTunerIfGain(ifGain: number, gain: number): Promise<void>`

Sets the tuner IF gain. Parameter packing: upper 16 bits = `ifGain`, lower 16 bits = `gain`
(each masked to 16 bits). Protocol: command `0x06`.

### `setTestMode(on: boolean): Promise<void>`

Enables/disables test mode (the internal signal generator): `true` = on. Protocol: command `0x07`.

### `setAfcMode(on: boolean): Promise<void>`

Enables/disables AFC (automatic frequency control): `true` = on. Protocol: command `0x08`.

### `setDirectSampling(mode: 0 | 1 | 2): Promise<void>`

Sets the direct sampling mode: `0` = off, `1` = I only, `2` = Q only. Any other value throws
`RangeError('direct sampling mode must be 0, 1 or 2')`. Protocol: command `0x09`.

### `setOffsetTuning(on: boolean): Promise<void>`

Enables/disables offset tuning (IF offset): `true` = on. Protocol: command `0x0a`. Note: in the rtl-sdr-blog fork this
command id is also documented as the bias-tee toggle; the fork maps it to offset tuning here.

### `setRtlXtal(hz: number): Promise<void>`

Sets the RTL-SDR crystal frequency in Hz (for drift correction). 32-bit integer validation. Protocol: command `0x0b`.

### `setTunerXtal(hz: number): Promise<void>`

Sets the tuner crystal frequency in Hz. 32-bit integer validation. Protocol: command `0x0c`.

### `setGainByIndex(index: number): Promise<void>`

Sets the gain by step index (`0 .. tunerGainCount - 1`). 32-bit integer validation. Protocol: command `0x0d`.

### `setBiasTee(on: boolean): Promise<void>`

Enables/disables the bias-tee (LNA power over the antenna line): `true` = on. Protocol: command `0x0e`.

### `configure(opts: ConfigureOptions): Promise<void>`

Applies a batch of settings sequentially, in this order:
frequency → sample rate → gain mode/value → PPM → bias-tee.

| Property            | Type      | Description                                          |
| ------------------- | --------- | ---------------------------------------------------- |
| `centerFrequency`   | `number`  | Center frequency, Hz.                                |
| `sampleRate`        | `number`  | Sample rate, Hz.                                     |
| `autoGain`          | `boolean` | Auto gain (AGC): `true` = enabled.                   |
| `gainDb`            | `number`  | Manual gain, dB (applied when `autoGain === false`). |
| `freqCorrectionPpm` | `number`  | Frequency correction, PPM.                           |
| `biasTee`           | `boolean` | Bias-tee: `true` = enabled.                          |

Behavior details:

- Gain value is only sent after the gain mode is set.
- If `autoGain` is omitted but `gainDb` is provided, the client first switches to manual mode, then applies the gain.
- If `autoGain` is `true`, any provided `gainDb` is ignored.
- All provided fields are applied strictly in sequence; the first failing command rejects and stops the batch.

---

## Data helpers (server → client)

### `onSamples(cb: (iq: Int16Array) => void): this`

Subscribes to IQ samples; equivalent to `client.on('samples', cb)`.
`iq` is an `Int16Array` of interleaved samples `[I0, Q0, I1, Q1, ...]`. Returns the client for chaining.

### `pause(): this`

Pauses the stream (TCP flow control via `socket.pause()`). Incoming data keeps buffering in the OS while the socket is
paused. Returns the client for chaining.

### `resume(): this`

Resumes the stream after `pause()`. Returns the client for chaining.

### `flushSamples(): void`

Emits the leftover buffer tail immediately, if it holds at least one I/Q pair (≥ 4 bytes) but less than a full
`chunkSize`. Useful before pausing/stopping to deliver the partial tail to listeners.

---

## Events

`RtlSdrClient` extends `EventEmitter`. Standard events:

| Event        | Payload      | Emitted when                                                                        |
| ------------ | ------------ | ----------------------------------------------------------------------------------- |
| `connect`    | —            | Handshake completed and the stream is active (also when `connect()` resolves).      |
| `samples`    | `Int16Array` | A full chunk of I/Q samples is ready (interleaved `[I0, Q0, I1, Q1, ...]`).         |
| `drop`       | `number`     | The receive buffer exceeded `maxPendingSamples`; payload = number of dropped bytes. |
| `error`      | `Error`      | A connection, handshake, or command error occurred.                                 |
| `disconnect` | —            | The connection was closed (client-initiated or server-side).                        |

---

## Protocol reference

- Handshake (server → client, 12 bytes): `"RTL0" | UInt32BE tuner_type | UInt32BE tuner_gain_count`.
- Command frame (client → server, 5 bytes): `[cmdId:1][param:UInt32BE]`.
- IQ data: raw int16 **little-endian**, interleaved I, Q; no framing.
- Command parameters are **big-endian** while IQ samples are **little-endian** (by protocol design).

Command ids:

| Id     | Name             | Param                                          |
| ------ | ---------------- | ---------------------------------------------- |
| `0x01` | Center frequency | Hz                                             |
| `0x02` | Sample rate      | Hz                                             |
| `0x03` | Gain mode        | 0 = auto (AGC), 1 = manual                     |
| `0x04` | Manual gain      | 0.1 dB steps (e.g. 30 = 3.0 dB)                |
| `0x05` | Freq correction  | PPM                                            |
| `0x06` | Tuner IF gain    | `[UInt16BE ifGain][UInt16BE gain]`             |
| `0x07` | Test mode        | 0/1                                            |
| `0x08` | AFC mode         | 0/1                                            |
| `0x09` | Direct sampling  | 0 = off, 1 = I only, 2 = Q only                |
| `0x0a` | Offset tuning    | 0/1 (bias-tee toggle in the rtl-sdr-blog fork) |
| `0x0b` | RTL xtal         | Hz                                             |
| `0x0c` | Tuner xtal       | Hz                                             |
| `0x0d` | Gain by index    | `0..tuner_gain_count-1`                        |
| `0x0e` | Bias-tee         | 0/1                                            |
