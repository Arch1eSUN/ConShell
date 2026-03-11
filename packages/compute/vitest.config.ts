import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@conshell/compute': path.resolve(__dirname, './src/index.ts'),
            '@conshell/core': path.resolve(__dirname, '../core/src/index.ts'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
    },
});
