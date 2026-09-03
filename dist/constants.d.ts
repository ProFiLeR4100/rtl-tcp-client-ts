/**
 * rtl_tcp protocol constants and defaults.
 *
 * Protocol overview:
 * - the server sends a 12-byte "RTL0" handshake on connect;
 * - the client sends 5-byte commands: [cmdId:1][param:UInt32BE];
 * - the server then streams int16 little-endian IQ samples (I,Q interleaved).
 */
/** Default host for a locally running rtl_tcp server. */
export declare const DEFAULT_HOST = "127.0.0.1";
/** Default rtl_tcp server port. */
export declare const DEFAULT_PORT = 1234;
/**
 * Control command ids (client -> server).
 * Each command is a 5-byte frame: [cmdId:1][param:UInt32BE].
 * The comment on each key describes the command parameter.
 */
export declare const COMMANDS: {
    /** Set center frequency (param: Hz). */
    readonly CENTER_FREQUENCY: 1;
    /** Set sample rate (param: Hz). */
    readonly SAMPLE_RATE: 2;
    /** Gain mode: 0 = auto (AGC), 1 = manual. */
    readonly GAIN_MODE: 3;
    /** Set manual gain (param: 0.1 dB steps, e.g. 30 = 3.0 dB). */
    readonly GAIN: 4;
    /** Frequency correction (param: PPM, parts per million). */
    readonly FREQ_CORRECTION: 5;
    /** Tuner IF gain (param: [UInt16BE ifGain][UInt16BE gain]). */
    readonly TUNER_IF_GAIN: 6;
    /** Test mode (internal signal generator): 0/1. */
    readonly TEST_MODE: 7;
    /** AFC (auto frequency control): 0/1. */
    readonly AFC_MODE: 8;
    /** Direct sampling: 0 = off, 1 = I only, 2 = Q only. */
    readonly DIRECT_SAMPLING: 9;
    /** Offset tuning (IF offset): 0/1. */
    readonly OFFSET_TUNING: 10;
    /** RTL-SDR crystal frequency (param: Hz). */
    readonly RTL_XTAL: 11;
    /** Tuner crystal frequency (param: Hz). */
    readonly TUNER_XTAL: 12;
    /** Set gain by step index (param: 0..tuner_gain_count-1). */
    readonly GAIN_BY_INDEX: 13;
    /** Bias-tee (LNA power over the antenna line): 0/1. */
    readonly BIAS_TEE: 14;
};
/** Union of all valid command ids. */
export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];
/** Magic bytes expected at the start of the handshake: "RTL0". */
export declare const HANDSHAKE_MAGIC = "RTL0";
/** Handshake size in bytes: magic(4) + tuner_type(4) + tuner_gain_count(4). */
export declare const HANDSHAKE_SIZE = 12;
/** Command frame size in bytes: cmdId(1) + param(4). */
export declare const COMMAND_SIZE = 5;
/** Low 8 bits (one byte) of a value. */
export declare const MASK_BYTE = 255;
/** Low 16 bits (one word) of a value. */
export declare const MASK_WORD = 65535;
/** Minimum value accepted for a 32-bit command parameter. */
export declare const PARAM_MIN = -2147483647;
/** Maximum value accepted for a 32-bit command parameter. */
export declare const PARAM_MAX = 4294967295;
/**
 * Tuner type names from the handshake.
 * Key = tuner_type value sent by the server.
 */
export declare const TUNER_NAMES: Record<number, string>;
//# sourceMappingURL=constants.d.ts.map