import { createRequire } from 'node:module';

// TypeScript 7 Go compiler does not provide the JS programmatic AST API.
// Forward typescript-eslint, sonarjs, and other ESLint plugins to @typescript/typescript6.
const require = createRequire(import.meta.url);
try {
  const tsPath = require.resolve('typescript');
  const ts6 = require('@typescript/typescript6');
  require.cache[tsPath] = {
    id: tsPath,
    filename: tsPath,
    loaded: true,
    exports: ts6,
  };
} catch {
  // Fallback if @typescript/typescript6 is not present
}

const js = (await import('@eslint/js')).default;
const tseslint = (await import('typescript-eslint')).default;
const importX = (await import('eslint-plugin-import-x')).default;
const vitest = (await import('@vitest/eslint-plugin')).default;
const n = (await import('eslint-plugin-n')).default;
const security = (await import('eslint-plugin-security')).default;
const json = (await import('eslint-plugin-json')).default;
const sonarjs = (await import('eslint-plugin-sonarjs')).default;
const unicorn = (await import('eslint-plugin-unicorn')).default;
const promise = (await import('eslint-plugin-promise')).default;
const globals = (await import('globals')).default;

// Take the SonarJS recommended ruleset but downgrade every rule to 'warn'
// (preserving any per-rule options) so it surfaces issues without failing CI.
const sonarjsWarn = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules).map(([name, val]) => [
    name, Array.isArray(val) ? ['warn', ...val.slice(1)] : 'warn',
  ]),
);

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
  {
    files: ['**/*.ts'],
    plugins: { sonarjs },
    rules: sonarjsWarn,
  },
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
      unicorn,
      promise,
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
      ...promise.configs['flat/recommended'].rules,
      'promise/catch-or-return': ['error', { allowFinally: true, terminationMethod: ['catch', 'finally'] }],
      ...(unicorn.configs['flat/recommended']?.rules ?? unicorn.configs.recommended?.rules ?? {}),
      'unicorn/prefer-combined-guards': 'off',
      'unicorn/prefer-escaped-irregular-whitespace': 'off',
      'unicorn/prefer-minimal-ternary': 'off',
      'unicorn/no-unnecessary-array-flat-map': 'off',
      'unicorn/prefer-early-return': 'off',
      'unicorn/prefer-continue': 'off',
      'unicorn/prefer-logical-operator-over-ternary': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/name-replacements': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-global-this': 'off',
      'unicorn/no-empty-file': 'off',
      'unicorn/no-top-level-side-effects': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/no-global-object-property-assignment': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-await': 'off',
      'unicorn/no-declarations-before-early-exit': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/prefer-node-protocol': 'off',
      'unicorn/explicit-length-check': 'off',
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/no-this-outside-of-class': 'off',
      'unicorn/prefer-promise-with-resolvers': 'off',
      'unicorn/prefer-query-selector': 'off',
      'unicorn/no-incorrect-query-selector': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/prefer-global-number-constants': 'off',
      'unicorn/prefer-dom-node-text-content': 'off',
      'unicorn/prefer-dom-node-append': 'off',
      'unicorn/prefer-dom-node-remove': 'off',
      'unicorn/prefer-dom-node-dataset': 'off',
      'unicorn/prefer-modern-dom-apis': 'off',
      'unicorn/prefer-single-call': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/prefer-switch': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/no-for-each': 'off',
      'unicorn/prefer-split-limit': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'off',
      'unicorn/prefer-includes': 'off',
      'unicorn/prefer-observer-apis': 'off',
      'unicorn/prefer-includes-over-repeated-comparisons': 'off',
      'unicorn/default-export-style': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/prefer-regexp-test': 'off',
      'unicorn/no-unreadable-array-destructuring': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/prefer-dom-node-replace-children': 'off',
      'unicorn/switch-case-braces': 'off',
      'unicorn/empty-brace-spaces': 'off',
      'unicorn/no-unnecessary-string-trim': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/prefer-default-parameters': 'off',
      'unicorn/no-negated-array-predicate': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/prefer-at': 'off',
      'unicorn/consistent-class-member-order': 'off',
      'unicorn/prefer-else-if': 'off',
      'unicorn/class-reference-in-static-methods': 'off',
      'unicorn/max-nested-calls': 'off',
      'unicorn/prefer-url-href': 'off',
      'unicorn/no-lonely-if': 'off',
      'unicorn/prefer-type-literal-last': 'off',
      'unicorn/no-useless-promise-resolve-reject': 'off',
      'unicorn/no-array-method-this-argument': 'off',
      'unicorn/prefer-string-raw': 'off',
      'unicorn/prefer-number-is-safe-integer': 'off',
      'unicorn/require-array-sort-compare': 'off',
      'unicorn/consistent-conditional-object-spread': 'off',
      'unicorn/prefer-export-from': 'off',
      'unicorn/no-unreadable-for-of-expression': 'off',
      'unicorn/no-immediate-mutation': 'off',
      'unicorn/prefer-number-coercion': 'off',
      'unicorn/prefer-boolean-return': 'off',
      'promise/always-return': 'off',
      'promise/no-callback-in-promise': 'off',
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
      'promise/param-names': 'off',
      'sonarjs/no-skipped-tests': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/no-dead-store': 'off',
      'unicorn/no-thenable': 'off',
      'unicorn/prefer-then-catch': 'off',
      'unicorn/no-unnecessary-global-this': 'off',
      'unicorn/prefer-string-repeat': 'off',
      'unicorn/prefer-https': 'off',
      'max-len': 'off',
    },
  },
  {
    files: ['**/*.json'],
    plugins: { json },
    processor: 'json/json',
  },
];
