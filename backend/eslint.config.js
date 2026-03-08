import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      parser: tsParser,
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:crypto',
              message: 'Decrypt or sign in CustodialWalletService only',
            },
            {
              name: 'crypto',
              message: 'Decrypt or sign in CustodialWalletService only',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'examples/**', 'node_modules/**'],
  },
]
