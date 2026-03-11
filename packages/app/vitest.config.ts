import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        globals: false,
        testTimeout: 10_000,
        pool: 'forks',
        exclude: [
            'node_modules/**',
            'node_modules_locked/**',
            'dist/**',
        ],
    },
});
