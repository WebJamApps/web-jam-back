import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import vitest from '@vitest/eslint-plugin';
import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import json from 'eslint-plugin-json';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'coverage/**',
      'JaMmusic/**',
      'frontend/**',
      'eslint.config.mjs',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      'import-x': importX,
      n,
      security,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-underscore-dangle': 'off',
      'no-console': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'max-len': ['error', { code: 150 }],
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1 }],
    },
  },
  {
    files: ['test/**/*.ts', '**/*.spec.ts', '**/*.test.ts'],
    plugins: { vitest },
    languageOptions: {
      globals: { ...vitest.environments.env.globals },
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-conditional-expect': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.json'],
    plugins: { json },
    processor: 'json/json',
  },
];
