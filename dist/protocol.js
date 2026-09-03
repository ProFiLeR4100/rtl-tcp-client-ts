"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolError = void 0;
exports.encodeCommand = encodeCommand;
exports.parseHandshake = parseHandshake;
exports.decodeIq = decodeIq;
exports.encodeIq = encodeIq;
/**
 * Encoding and parsing of rtl_tcp protocol frames.
 *
 * Byte order (by protocol design):
 * - command parameters are big-endian (network order);
 * - IQ samples are little-endian (server order).
 */
const constants_1 = require("./constants");
/** Protocol-level error (bad handshake, etc.). */
class ProtocolError extends Error {
    constructor(message) {
        super(message);
        // So the type can be identified via instanceof in catch blocks.
        this.name = 'ProtocolError';
    }
}
exports.ProtocolError = ProtocolError;
/**
 * Encodes a 5-byte command frame: [cmdId:1][param:UInt32BE].
 * @param cmd - command id (one of COMMANDS).
 * @param param - command parameter, sent as unsigned UInt32 big-endian.
 */
function encodeCommand(cmd, param) {
    const buf = Buffer.allocUnsafe(constants_1.COMMAND_SIZE);
    // cmdId always fits a byte; MASK_BYTE just clears the upper bits.
    buf.writeUInt8(cmd & constants_1.MASK_BYTE, 0);
    // `>>> 0` converts the parameter to an unsigned 32-bit value.
    buf.writeUInt32BE(param >>> 0, 1);
    return buf;
}
/**
 * Parses and validates the 12-byte server handshake:
 * "RTL0" | tuner_type (UInt32BE) | tuner_gain_count (UInt32BE).
 */
function parseHandshake(buf) {
    if (buf.length < constants_1.HANDSHAKE_SIZE) {
        throw new ProtocolError(`Handshake too short: ${buf.length} < ${constants_1.HANDSHAKE_SIZE} bytes`);
    }
    // First 4 bytes are the "RTL0" magic signature.
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== constants_1.HANDSHAKE_MAGIC) {
        throw new ProtocolError(`Invalid handshake magic: expected "${constants_1.HANDSHAKE_MAGIC}", got "${magic}"`);
    }
    return {
        tunerType: buf.readUInt32BE(4),
        tunerGainCount: buf.readUInt32BE(8)
    };
}
/**
 * Decodes interleaved int16 little-endian IQ samples.
 * A trailing odd byte (if any) is dropped. Returns [I0,Q0,I1,Q1,...].
 */
function decodeIq(buffer) {
    // One IQ sample is 2 bytes, so the length is rounded down to even.
    const usable = buffer.length & ~1;
    const n = usable >> 1;
    const out = new Int16Array(n);
    if (n === 0) {
        return out;
    }
    // DataView allows an explicit little-endian byte order.
    const dv = new DataView(buffer.buffer, buffer.byteOffset, usable);
    for (let i = 0; i < n; i++) {
        out[i] = dv.getInt16(i * 2, true);
    }
    return out;
}
/**
 * Encodes an Int16Array of interleaved IQ samples
 * into little-endian bytes (inverse of decodeIq).
 */
function encodeIq(int16) {
    const buf = Buffer.allocUnsafe(int16.length * 2);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
    for (let i = 0; i < int16.length; i++) {
        // `true` = little-endian.
        dv.setInt16(i * 2, int16[i], true);
    }
    return buf;
}
//# sourceMappingURL=protocol.js.map