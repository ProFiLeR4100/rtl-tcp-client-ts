export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 1234;

export const COMMANDS = {
	CENTER_FREQUENCY: 0x01,
	SAMPLE_RATE: 0x02,
	GAIN_MODE: 0x03,
	GAIN: 0x04,
	FREQ_CORRECTION: 0x05,
	TUNER_IF_GAIN: 0x06,
	TEST_MODE: 0x07,
	AFC_MODE: 0x08,
	DIRECT_SAMPLING: 0x09,
	OFFSET_TUNING: 0x0a,
	RTL_XTAL: 0x0b,
	TUNER_XTAL: 0x0c,
	GAIN_BY_INDEX: 0x0d,
	BIAS_TEE: 0x0e
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

export const HANDSHAKE_MAGIC = 'RTL0';
export const HANDSHAKE_SIZE = 12;
export const COMMAND_SIZE = 5;

export const TUNER_NAMES: Record<number, string> = {
	0: 'UNKNOWN',
	1: 'E4000',
	2: 'FC0012',
	3: 'FC0013',
	4: 'FC2580',
	5: 'R820T',
	6: 'R828D'
};
