// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = tseslint.config(
	{
		ignores: ['dist/', 'node_modules/', 'rtl-sdr-blog-master/']
	},
	{
		files: ['**/*.js'],
		extends: [js.configs.recommended],
		languageOptions: {
			globals: {
				require: 'readonly',
				module: 'writable',
				__dirname: 'readonly',
				process: 'readonly'
			}
		}
	},
	{
		files: ['**/*.ts'],
		extends: [...tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: ['./tsconfig.eslint.json'],
				tsconfigRootDir: __dirname
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' }
			],
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
			'@typescript-eslint/no-floating-promises': 'error'
		}
	},
	// Relaxed rules for test files
	{
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-dynamic-delete': 'off'
		}
	},
	// Relaxed rules for example files
	{
		files: ['example/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},
	// Disable rules that conflict with Prettier.
	// `curly` is re-enabled here: its own `rules` override the extended Prettier
	// config, which otherwise disables `curly`.
	{
		extends: [eslintConfigPrettier],
		rules: {
			curly: ['error', 'all']
		}
	}
);
