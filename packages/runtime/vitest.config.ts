import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@conshell/compute': path.resolve(__dirname, '../compute/src/index.ts'),
            '@conshell/core': path.resolve(__dirname, '../core/src/index.ts'),
            '@conshell/policy': path.resolve(__dirname, '../policy/src/index.ts'),
            '@conshell/runtime': path.resolve(__dirname, './src/index.ts'),
            '@conshell/state': path.resolve(__dirname, '../state/src/index.ts'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        globals: false,
    },
});
