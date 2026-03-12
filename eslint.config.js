// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    // ── Global settings ──────────────────────────────────────────────────
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            // ── TypeScript ───────────────────────────────────────────────
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-require-imports': 'error',
            '@typescript-eslint/consistent-type-imports': ['error', {
                prefer: 'type-imports',
                fixStyle: 'inline-type-imports',
            }],
            '@typescript-eslint/no-empty-interface': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',

            // ── General ──────────────────────────────────────────────────
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-debugger': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
            'eqeqeq': ['error', 'always'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
        },
    },

    // ── Test files — relaxed rules ───────────────────────────────────────
    {
        files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
        },
    },

    // ── Dashboard (Vite/React) — ignore for now ─────────────────────────
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/packages/dashboard/**',
            '**/coverage/**',
            '**/*.js',
            '**/*.cjs',
            '**/*.mjs',
        ],
    },
);
