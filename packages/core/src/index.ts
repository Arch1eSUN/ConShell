/**
 * @web4-agent/core — Public API
 *
 * Shared types, config, money primitives, logger, errors, and constants.
 * This package has ZERO external runtime dependencies beyond zod.
 */

// Types — all shared vocabulary
export * from './types/index.js';

// Money — integer-only financial arithmetic
export * from './money/index.js';

// Config — loader and validation
export * from './config/index.js';

// Logger — structured JSON logging
export * from './logger/index.js';

// Errors — full error hierarchy
export * from './errors/index.js';

// Constants — runtime limits, protected patterns, timings
export * from './constants.js';
