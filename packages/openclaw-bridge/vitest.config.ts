import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    cacheDir: '/tmp/.vite-bridge-cache',
    resolve: {
        alias: {
            '@conshell/core': path.resolve(__dirname, '../core/src/index.ts'),
            '@conshell/skills': path.resolve(__dirname, '../skills/src/index.ts'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
    },
});
