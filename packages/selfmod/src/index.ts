/**
 * @web4-agent/selfmod — Self-modification engine
 *
 * Git-backed, audited self-modification with protected-file enforcement.
 */
export {
    SelfModEngine,
    sha256,
    type SelfModConfig,
    type SelfModResult,
    type FileEditRequest,
    type RollbackResult,
} from './engine.js';
