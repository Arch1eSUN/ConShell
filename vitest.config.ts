import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        exclude: [
            'node_modules/**',
            'node_modules_locked/**',
            '**/node_modules/**',
            '**/node_modules_locked/**',
            'dist/**',
        ],
    },
});
