import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@conshell/core': path.resolve(__dirname, '../core/src/index.ts'),
            '@conshell/policy': path.resolve(__dirname, './src/index.ts'),
            '@conshell/state': path.resolve(__dirname, '../state/src/index.ts'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        globals: false,
    },
});
