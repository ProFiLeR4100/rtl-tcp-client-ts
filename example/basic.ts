import { RtlSdrClient } from '../src/index';

async function main(): Promise<void> {
	const client = new RtlSdrClient({ host: '127.0.0.1', port: 1234, chunkSize: 8192 });

	client.on('samples', (iq: Int16Array) => {
		// iq is interleaved [I0, Q0, I1, Q1, ...]
		let peak = 0;
		for (let i = 0; i < iq.length; i++) {
			const a = Math.abs(iq[i]);
			if (a > peak) peak = a;
		}
		process.stdout.write(`peak=${peak}\r`);
	});
	client.on('error', (e) => console.error('error', e));
	client.on('disconnect', () => console.log('\ndisconnected'));

	await client.connect();
	console.log(`Connected: tuner=${client.tunerName}`);
	await client.configure({
		centerFrequency: 100_000_000,
		sampleRate: 2_048_000,
		autoGain: false,
		gainDb: 30,
		freqCorrectionPpm: 0
	});
	console.log('Streaming IQ samples... (Ctrl+C to stop)');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
