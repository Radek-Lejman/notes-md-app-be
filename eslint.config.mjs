// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import boundaries from 'eslint-plugin-boundaries';
import jest from 'eslint-plugin-jest';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** What every feature module may use. */
const SHARED = ['core', 'common', 'infrastructure'];

/** An element may import itself and the given element types, nothing else. */
const allowFrom = (type, uses) => ({
  from: { element: { type } },
  allow: { to: { element: { types: { anyOf: [type, ...uses] } } } },
});

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error'
    },
  },
  // Architecture: which part of src/ may import which (docs/adr/0004-module-boundaries.md).
  // Layers, lowest first: core <- common <- infrastructure <- modules; src/*.ts wires them.
  // A feature module imports another only along the allowed edges below; never in a cycle.
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/include': ['src/**/*.ts'],
      // The composition root (main.ts, app.module.ts, …) wires everything; global type
      // augmentations and jest's module mocks are not part of any layer.
      'boundaries/ignore': ['src/*.ts', 'src/types/**', 'src/__mocks__/**'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/**', partialMatch: false },
        { type: 'common', pattern: 'src/common/**', partialMatch: false },
        { type: 'infrastructure', pattern: 'src/infrastructure/**', partialMatch: false },
        { type: 'users', pattern: 'src/modules/users/**', partialMatch: false },
        { type: 'notes', pattern: 'src/modules/notes/**', partialMatch: false },
        { type: 'auth', pattern: 'src/modules/auth/**', partialMatch: false },
        { type: 'ai', pattern: 'src/modules/ai/**', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            allowFrom('core', []),
            allowFrom('common', ['core']),
            allowFrom('infrastructure', ['core', 'common']),
            allowFrom('users', SHARED),
            allowFrom('notes', [...SHARED, 'users']),
            allowFrom('auth', [...SHARED, 'users']),
            allowFrom('ai', [...SHARED, 'notes']),
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    plugins: { jest },
    rules: {
      // AI agents tend to silence failing tests instead of fixing them
      'jest/no-focused-tests': 'error',
      'jest/no-disabled-tests': 'error',
    },
  },
);