import { COMMAND_SIZE, HANDSHAKE_MAGIC, HANDSHAKE_SIZE } from './constants';

export interface Handshake {
	tunerType: number;
	tunerGainCount: number;
}

export class ProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProtocolError';
	}
}

/** Encode a 5-byte command frame: [cmdId:1][param:UInt32BE]. */
export function encodeCommand(cmd: number, param: number): Buffer {
	const buf = Buffer.allocUnsafe(COMMAND_SIZE);
	buf.writeUInt8(cmd & 0xff, 0);
	buf.writeUInt32BE(param >>> 0, 1);
	return buf;
}

/** Parse and validate the 12-byte server handshake header. */
export function parseHandshake(buf: Buffer): Handshake {
	if (buf.length < HANDSHAKE_SIZE) {
		throw new ProtocolError(`Handshake too short: ${buf.length} < ${HANDSHAKE_SIZE} bytes`);
	}
	const magic = buf.toString('ascii', 0, 4);
	if (magic !== HANDSHAKE_MAGIC) {
		throw new ProtocolError(
			`Invalid handshake magic: expected "${HANDSHAKE_MAGIC}", got "${magic}"`
		);
	}
	return {
		tunerType: buf.readUInt32BE(4),
		tunerGainCount: buf.readUInt32BE(8)
	};
}

/**
 * Decode interleaved int16 little-endian IQ samples.
 * Trailing odd byte (if any) is ignored. Returns [I0,Q0,I1,Q1,...].
 */
export function decodeIq(buffer: Buffer): Int16Array {
	const usable = buffer.length & ~1; // round down to even
	const n = usable >> 1;
	const out = new Int16Array(n);
	if (n === 0) {
		return out;
	}
	const dv = new DataView(buffer.buffer, buffer.byteOffset, usable);
	for (let i = 0; i < n; i++) {
		out[i] = dv.getInt16(i * 2, true);
	}
	return out;
}

/** Encode an Int16Array of interleaved IQ samples to little-endian bytes. */
export function encodeIq(int16: Int16Array): Buffer {
	const buf = Buffer.allocUnsafe(int16.length * 2);
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
	for (let i = 0; i < int16.length; i++) {
		dv.setInt16(i * 2, int16[i], true);
	}
	return buf;
}
