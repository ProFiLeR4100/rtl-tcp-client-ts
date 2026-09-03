/** Data obtained from the server handshake. */
export interface Handshake {
    /** Tuner type; human-readable name is in TUNER_NAMES. */
    tunerType: number;
    /** Number of gain steps (used when setting gain by index). */
    tunerGainCount: number;
}
/** Protocol-level error (bad handshake, etc.). */
export declare class ProtocolError extends Error {
    constructor(message: string);
}
/**
 * Encodes a 5-byte command frame: [cmdId:1][param:UInt32BE].
 * @param cmd - command id (one of COMMANDS).
 * @param param - command parameter, sent as unsigned UInt32 big-endian.
 */
export declare function encodeCommand(cmd: number, param: number): Buffer;
/**
 * Parses and validates the 12-byte server handshake:
 * "RTL0" | tuner_type (UInt32BE) | tuner_gain_count (UInt32BE).
 */
export declare function parseHandshake(buf: Buffer): Handshake;
/**
 * Decodes interleaved int16 little-endian IQ samples.
 * A trailing odd byte (if any) is dropped. Returns [I0,Q0,I1,Q1,...].
 */
export declare function decodeIq(buffer: Buffer): Int16Array;
/**
 * Encodes an Int16Array of interleaved IQ samples
 * into little-endian bytes (inverse of decodeIq).
 */
export declare function encodeIq(int16: Int16Array): Buffer;
//# sourceMappingURL=protocol.d.ts.map