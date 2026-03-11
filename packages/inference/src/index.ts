/**
 * @conshell/inference — Public API
 */
export { DEFAULT_MODEL_SEED } from './seed.js';
export { getModelPreferences, type ModelPreference } from './routing.js';
export { DefaultInferenceRouter, type InferenceRouterOptions } from './router.js';
export { autoGenerateRouting, getRoutingDimensions, getModelClassification, type ModelTier } from './auto-routing.js';
export { FailoverRouter, type FailoverConfig, type RouteFunction } from './failover.js';
export {
    SmartRouter,
    ModelQualityMonitor,
    analyzeComplexity,
    type TaskComplexity,
    type ComplexityAnalysis,
    type SmartRouteResult,
    type ModelQualityScore,
} from './smart-router.js';
