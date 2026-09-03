# rtl-tcp-client

A small, zero-dependency **TypeScript** client for the [`rtl_tcp`](https://github.com/rtlsdrblog/rtl-sdr) (RTL-SDR) server protocol, as implemented by the `rtl-sdr-blog` C server. It speaks the same protocol used by SDR#, GQRX and gr-osmosdr.

- Connects over TCP (default `127.0.0.1:1234`).
- Performs and validates the 12-byte `RTL0` handshake.
- Sends all standard 5-byte control commands (frequency, sample rate, gain, PPM, bias-tee, xtal, ...).
- Streams decoded **int16 interleaved IQ** samples to a callback.

## Install / build

```bash
npm install
npm run build   # emits dist/ (CJS + .d.ts)
```

## Usage

```ts
import { RtlSdrClient } from 'rtl-tcp-client';

const client = new RtlSdrClient({ host: '127.0.0.1', port: 1234, chunkSize: 8192 });

client.on('samples', (iq: Int16Array) => {
  // iq is interleaved [I0, Q0, I1, Q1, ...]
});
client.on('error', (e) => console.error(e));
client.on('disconnect', () => console.log('disconnected'));

await client.connect();
console.log('tuner:', client.tunerName);
await client.configure({
  centerFrequency: 100_000_000,
  sampleRate: 2_048_000,
  autoGain: false,
  gainDb: 30,
  freqCorrectionPpm: 0,
});
```

## API

- `new RtlSdrClient({ host, port, chunkSize, connectTimeoutMs, maxPendingSamples })`
- `connect(): Promise<RtlSdrClient>` — connects and completes the handshake.
- `disconnect(): Promise<void>`
- Getters: `connected`, `tunerType`, `tunerGainCount`, `tunerName`, `bufferedSamples`, `totalSamplesEmitted`, `droppedSamples`, `lastError`.
- Commands (each returns `Promise<void>`): `setCenterFrequency(hz)`, `setSampleRate(hz)`, `setGainMode(auto)` / `setAutoGain(auto)`, `setGain(db)`, `setFreqCorrection(ppm)`, `setTunerIfGain(stage, gain)`, `setTestMode(on)`, `setAfcMode(on)`, `setDirectSampling(0|1|2)`, `setOffsetTuning(on)`, `setRtlXtal(hz)`, `setTunerXtal(hz)`, `setGainByIndex(i)`, `setBiasTee(on)`.
- `configure({...})` — applies a batch of the above in order.
- Events: `samples(Int16Array)`, `connect`, `disconnect`, `error(Error)`, `drop(excessBytes)`.
- Data helpers: `onSamples(cb)`, `pause()`, `resume()`, `flushSamples()`.

## Protocol notes

- Handshake (server -> client): `"RTL0" | UInt32BE tuner_type | UInt32BE tuner_gain_count`.
- Command frame (client -> server): `[cmdId:1][UInt32BE param:4]`.
- IQ data: raw int16 **little-endian**, interleaved I,Q; no framing.
- Command parameter values are **big-endian** while IQ samples are **little-endian** (by design of the protocol).
- `0x0a` (offset tuning) is repurposed as a **Bias-T toggle** in the rtl-sdr-blog fork.

## Tests

```bash
npm test
```
Tests run against an in-process mock `rtl_tcp` server (no hardware required).

### Integration test (real hardware)

Runs against a live `rtl_tcp` server, default target `192.168.0.29:1234`:

```bash
npm run test:integration
```

Override the target with environment variables (read by the test file, not hard-coded in package.json):

```bash
# Linux / macOS
RTL_TCP_HOST=10.0.0.5 RTL_TCP_PORT=1234 npm run test:integration
```

```bash
# Windows (cmd)
set RTL_TCP_HOST=10.0.0.5 && set RTL_TCP_PORT=1234 && npm run test:integration
```

The test handshakes with the server, applies frequency/sample-rate/AGC settings, and asserts that live, non-flat IQ samples arrive. The upstream server serves **one client at a time** — close SDR#/GQRX/other consumers before running it.

## Notes / limitations
- The upstream server serves **one client at a time**; after a disconnect it returns to listening.
- If you fall behind, the server drops oldest buffers; this client also caps its buffer (`maxPendingSamples`) and emits `drop`.
- At the default 2.048 MHz sample rate the stream is ~8 MiB/s; lower `sampleRate` for bandwidth-limited use.
