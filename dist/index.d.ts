/**
 * Public API of the library: single entry point for all exports.
 */
export { RtlSdrClient } from './client';
export type { RtlSdrClientOptions, ConfigureOptions } from './client';
export { COMMANDS, DEFAULT_HOST, DEFAULT_PORT, HANDSHAKE_MAGIC, HANDSHAKE_SIZE, COMMAND_SIZE, MASK_BYTE, MASK_WORD, PARAM_MIN, PARAM_MAX, TUNER_NAMES } from './constants';
export type { CommandId } from './constants';
export { ProtocolError, encodeCommand, parseHandshake, decodeIq, encodeIq } from './protocol';
export type { Handshake } from './protocol';
//# sourceMappingURL=index.d.ts.map