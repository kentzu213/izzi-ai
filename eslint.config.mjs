import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const javascriptFiles = [
  'apps/**/*.{js,cjs,mjs}',
  'packages/**/*.{js,cjs,mjs}',
  'tools/**/*.{js,cjs,mjs}',
  '*.config.{js,cjs,mjs}',
];
const typescriptFiles = [
  'apps/**/*.{ts,tsx,mts,cts}',
  'packages/**/*.{ts,tsx,mts,cts}',
  'tools/**/*.{ts,tsx,mts,cts}',
  '*.config.{ts,mts,cts}',
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/out/**',
    '**/release*/**',
    '**/coverage/**',
    '**/.artifacts/**',
    '**/.codegraph/**',
    '**/.gitnexus/**',
    '**/_private_clone/**',
  ]),
  {
    name: 'izzi/javascript',
    files: javascriptFiles,
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    name: 'izzi/typescript',
    files: typescriptFiles,
    extends: [tseslint.configs.recommended],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Existing SDK and IPC surfaces carry explicit-any debt; other recommended rules stay blocking.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'none',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    name: 'izzi/node',
    files: [
      'apps/desktop/src/main/**/*.{ts,tsx}',
      'apps/desktop/scripts/**/*.{js,cjs,mjs,ts}',
      'apps/desktop/*.config.ts',
      'apps/marketplace-api/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'tools/**/*.{js,cjs,mjs,ts,tsx}',
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    name: 'izzi/renderer',
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]);
