"use strict";
/**
 * rtl_tcp protocol constants and defaults.
 *
 * Protocol overview:
 * - the server sends a 12-byte "RTL0" handshake on connect;
 * - the client sends 5-byte commands: [cmdId:1][param:UInt32BE];
 * - the server then streams int16 little-endian IQ samples (I,Q interleaved).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TUNER_NAMES = exports.PARAM_MAX = exports.PARAM_MIN = exports.MASK_WORD = exports.MASK_BYTE = exports.COMMAND_SIZE = exports.HANDSHAKE_SIZE = exports.HANDSHAKE_MAGIC = exports.COMMANDS = exports.DEFAULT_PORT = exports.DEFAULT_HOST = void 0;
/** Default host for a locally running rtl_tcp server. */
exports.DEFAULT_HOST = '127.0.0.1';
/** Default rtl_tcp server port. */
exports.DEFAULT_PORT = 1234;
/**
 * Control command ids (client -> server).
 * Each command is a 5-byte frame: [cmdId:1][param:UInt32BE].
 * The comment on each key describes the command parameter.
 */
exports.COMMANDS = {
    /** Set center frequency (param: Hz). */
    CENTER_FREQUENCY: 0x01,
    /** Set sample rate (param: Hz). */
    SAMPLE_RATE: 0x02,
    /** Gain mode: 0 = auto (AGC), 1 = manual. */
    GAIN_MODE: 0x03,
    /** Set manual gain (param: 0.1 dB steps, e.g. 30 = 3.0 dB). */
    GAIN: 0x04,
    /** Frequency correction (param: PPM, parts per million). */
    FREQ_CORRECTION: 0x05,
    /** Tuner IF gain (param: [UInt16BE ifGain][UInt16BE gain]). */
    TUNER_IF_GAIN: 0x06,
    /** Test mode (internal signal generator): 0/1. */
    TEST_MODE: 0x07,
    /** AFC (auto frequency control): 0/1. */
    AFC_MODE: 0x08,
    /** Direct sampling: 0 = off, 1 = I only, 2 = Q only. */
    DIRECT_SAMPLING: 0x09,
    /** Offset tuning (IF offset): 0/1. */
    OFFSET_TUNING: 0x0a,
    /** RTL-SDR crystal frequency (param: Hz). */
    RTL_XTAL: 0x0b,
    /** Tuner crystal frequency (param: Hz). */
    TUNER_XTAL: 0x0c,
    /** Set gain by step index (param: 0..tuner_gain_count-1). */
    GAIN_BY_INDEX: 0x0d,
    /** Bias-tee (LNA power over the antenna line): 0/1. */
    BIAS_TEE: 0x0e
};
/** Magic bytes expected at the start of the handshake: "RTL0". */
exports.HANDSHAKE_MAGIC = 'RTL0';
/** Handshake size in bytes: magic(4) + tuner_type(4) + tuner_gain_count(4). */
exports.HANDSHAKE_SIZE = 12;
/** Command frame size in bytes: cmdId(1) + param(4). */
exports.COMMAND_SIZE = 5;
/** Low 8 bits (one byte) of a value. */
exports.MASK_BYTE = 0xff;
/** Low 16 bits (one word) of a value. */
exports.MASK_WORD = 0xffff;
/** Minimum value accepted for a 32-bit command parameter. */
exports.PARAM_MIN = -0x7fffffff;
/** Maximum value accepted for a 32-bit command parameter. */
exports.PARAM_MAX = 0xffffffff;
/**
 * Tuner type names from the handshake.
 * Key = tuner_type value sent by the server.
 */
exports.TUNER_NAMES = {
    0: 'UNKNOWN',
    1: 'E4000',
    2: 'FC0012',
    3: 'FC0013',
    4: 'FC2580',
    5: 'R820T',
    6: 'R828D'
};
//# sourceMappingURL=constants.js.map