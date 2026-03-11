import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@conshell/app': path.resolve(__dirname, './src/index.ts'),
            '@conshell/cli': path.resolve(__dirname, '../cli/src/index.ts'),
            '@conshell/core': path.resolve(__dirname, '../core/src/index.ts'),
            '@conshell/inference': path.resolve(__dirname, '../inference/src/index.ts'),
            '@conshell/memory': path.resolve(__dirname, '../memory/src/index.ts'),
            '@conshell/policy': path.resolve(__dirname, '../policy/src/index.ts'),
            '@conshell/proxy': path.resolve(__dirname, '../proxy/src/index.ts'),
            '@conshell/runtime': path.resolve(__dirname, '../runtime/src/index.ts'),
            '@conshell/security': path.resolve(__dirname, '../security/src/index.ts'),
            '@conshell/skills': path.resolve(__dirname, '../skills/src/index.ts'),
            '@conshell/soul': path.resolve(__dirname, '../soul/src/index.ts'),
            '@conshell/state': path.resolve(__dirname, '../state/src/index.ts'),
            '@conshell/wallet': path.resolve(__dirname, '../wallet/src/index.ts'),
            '@conshell/x402': path.resolve(__dirname, '../x402/src/index.ts'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        globals: false,
        testTimeout: 10_000,
    },
});
