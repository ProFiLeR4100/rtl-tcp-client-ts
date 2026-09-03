import { describe, it, expect } from 'vitest';
import { RtlSdrClient } from '../src/index';
import { encodeIq } from '../src/protocol';
import { MockRtlTcpServer } from './helpers/mockServer';

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function nextEvent<T>(emitter: { once: (e: string, cb: (...a: unknown[]) => void) => void }, event: string): Promise<T> {
  return new Promise<T>((resolve) => emitter.once(event, (v) => resolve(v as T)));
}

describe('RtlSdrClient', () => {
  it('performs handshake and exposes tuner info', async () => {
    const server = new MockRtlTcpServer({ tunerType: 5, tunerGainCount: 12 });
    const port = await server.start();
    const client = new RtlSdrClient({ port, chunkSize: 16 });
    try {
      await client.connect();
      expect(client.connected).toBe(true);
      expect(client.tunerType).toBe(5);
      expect(client.tunerGainCount).toBe(12);
      expect(client.tunerName).toBe('R820T');
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it('rejects handshake with bad magic', async () => {
    const server = new MockRtlTcpServer({ magic: 'XXXX' });
    const port = await server.start();
    const client = new RtlSdrClient({ port, connectTimeoutMs: 3000 });
    await expect(client.connect()).rejects.toThrow(/magic/i);
    await server.close();
  });

  it('sends correctly framed commands', async () => {
    const server = new MockRtlTcpServer();
    const port = await server.start();
    const client = new RtlSdrClient({ port });
    try {
      await client.connect();
      await client.setCenterFrequency(100_000_000);
      await client.setSampleRate(2_048_000);
      await client.setGainMode(false);
      await client.setGain(43.0);
      await client.setFreqCorrection(-5);
      await client.setBiasTee(true);
      await tick(50); // let the in-process mock server process the received frames

      const cmds = server.receivedCommands;
      expect(cmds.length).toBe(6);
      expect(cmds[0].length).toBe(5);
      expect(cmds[0][0]).toBe(0x01);
      expect(cmds[0].readUInt32BE(1)).toBe(100_000_000);
      expect(cmds[1][0]).toBe(0x02);
      expect(cmds[1].readUInt32BE(1)).toBe(2_048_000);
      expect(cmds[2][0]).toBe(0x03);
      expect(cmds[2].readUInt32BE(1)).toBe(1); // manual
      expect(cmds[3][0]).toBe(0x04);
      expect(cmds[3].readUInt32BE(1)).toBe(430); // 43.0 dB
      expect(cmds[4][0]).toBe(0x05);
      expect(cmds[4].readUInt32BE(1)).toBe(0xfffffffb); // -5 ppm
      expect(cmds[5][0]).toBe(0x0e);
      expect(cmds[5].readUInt32BE(1)).toBe(1);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it('decodes streamed IQ samples', async () => {
    const server = new MockRtlTcpServer();
    const port = await server.start();
    const client = new RtlSdrClient({ port, chunkSize: 8 });
    try {
      const samplesP = nextEvent<Int16Array>(client, 'samples');
      await client.connect();
      const iq = new Int16Array(16);
      for (let i = 0; i < 16; i++) iq[i] = i - 8;
      server.sendIq(encodeIq(iq));
      const got = await samplesP;
      expect(Array.from(got)).toEqual(Array.from(iq));
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it('reassembles IQ split across arbitrary chunk boundaries', async () => {
    const server = new MockRtlTcpServer();
    const port = await server.start();
    const client = new RtlSdrClient({ port, chunkSize: 4 });
    const collected: number[] = [];
    client.on('samples', (iq: Int16Array) => { for (let i = 0; i < iq.length; i++) collected.push(iq[i]); });
    try {
      await client.connect();
      const iq = new Int16Array(16);
      for (let i = 0; i < 16; i++) iq[i] = i;
      const b = encodeIq(iq); // 32 bytes
      server.sendIq(b.subarray(0, 5));
      await tick(20);
      server.sendIq(b.subarray(5, 13));
      await tick(20);
      server.sendIq(b.subarray(13));
      await tick(80);
      expect(collected).toEqual(Array.from(iq));
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it('configure() applies settings in order', async () => {
    const server = new MockRtlTcpServer();
    const port = await server.start();
    const client = new RtlSdrClient({ port });
    try {
      await client.connect();
      await client.configure({ centerFrequency: 146_520_000, sampleRate: 1_024_000, autoGain: false, gainDb: 30, freqCorrectionPpm: 12 });
      await tick(50); // let the in-process mock server process the received frames
      const cmds = server.receivedCommands;
      // freq, rate, gainMode(manual=1), gain(300), ppm
      expect(cmds.length).toBe(5);
      expect(cmds[0][0]).toBe(0x01);
      expect(cmds[0].readUInt32BE(1)).toBe(146_520_000);
      expect(cmds[1][0]).toBe(0x02);
      expect(cmds[1].readUInt32BE(1)).toBe(1_024_000);
      expect(cmds[2][0]).toBe(0x03);
      expect(cmds[2].readUInt32BE(1)).toBe(1);
      expect(cmds[3][0]).toBe(0x04);
      expect(cmds[3].readUInt32BE(1)).toBe(300);
      expect(cmds[4][0]).toBe(0x05);
      expect(cmds[4].readUInt32BE(1)).toBe(12);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it('rejects commands when not connected', async () => {
    const client = new RtlSdrClient({ port: 1 });
    await expect(client.setCenterFrequency(1_000_000)).rejects.toThrow(/Not connected/);
  });

  it('emits disconnect when the server closes the socket', async () => {
    const server = new MockRtlTcpServer();
    const port = await server.start();
    const client = new RtlSdrClient({ port });
    client.on('error', () => {});
    const disconnectP = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));
    await client.connect();
    server.close();
    await disconnectP;
    expect(client.connected).toBe(false);
  });
});