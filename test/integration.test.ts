import { describe, expect, it } from 'vitest';
import { RtlSdrClient } from '../src/index';

/**
 * Integration test against a REAL rtl_tcp server (rtl-sdr-blog, ./rtl-sdr-blog-master).
 *
 * Target is taken from environment variables (override before running the npm task):
 *   RTL_TCP_HOST  (default 192.168.0.29)
 *   RTL_TCP_PORT  (default 1234)
 *
 *   Linux/macOS:  RTL_TCP_HOST=10.0.0.5 RTL_TCP_PORT=1234 npm run test:integration
 *   Windows cmd:  set RTL_TCP_HOST=10.0.0.5 && set RTL_TCP_PORT=1234 && npm run test:integration
 */
const HOST = process.env.RTL_TCP_HOST ?? '192.168.0.29';
const PORT = Number(process.env.RTL_TCP_PORT ?? '1234');

describe(`integration: real rtl_tcp server @ ${HOST}:${PORT}`, () => {
	it('handshakes, applies settings and streams live IQ samples', { timeout: 30_000 }, async () => {
		const client = new RtlSdrClient({
			host: HOST,
			port: PORT,
			connectTimeoutMs: 10_000,
			chunkSize: 1024
		});
		try {
			await client.connect().catch((err: Error) => {
				throw new Error(
					`Cannot connect to rtl_tcp at ${HOST}:${PORT}: ${err.message}. ` +
						`Is the server running and not already occupied by another client?`
				);
			});

			expect(client.connected).toBe(true);
			expect([0, 1, 2, 3, 4, 5, 6]).toContain(client.tunerType);
			console.log(
				`tuner: ${client.tunerName} (type=${client.tunerType}, gain steps=${client.tunerGainCount})`
			);

			// Server must accept the control frames without error.
			await client.configure({
				centerFrequency: 100_000_000,
				sampleRate: 2_048_000,
				autoGain: true
			});

			// The server streams IQ right after the handshake; wait for the first chunk.
			const first = await new Promise<Int16Array>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error(`No IQ samples received from ${HOST}:${PORT} within 5000 ms`)),
					5000
				);
				client.once('samples', (iq: Int16Array) => {
					clearTimeout(timer);
					resolve(iq);
				});
			});

			expect(first.length).toBeGreaterThan(0);
			expect(first.length % 2).toBe(0); // interleaved I,Q pairs

			let peak = 0;
			for (let i = 0; i < first.length; i++) {
				const a = Math.abs(first[i]);
				if (a > peak) peak = a;
			}
			console.log(`first chunk: ${first.length / 2} IQ samples, peak amplitude ${peak}`);
			expect(
				peak,
				'Flat (all-zero) IQ stream — no tuner activity detected. Check the dongle / antenna.'
			).toBeGreaterThan(0);
		} finally {
			await client.disconnect();
		}
	});
});
