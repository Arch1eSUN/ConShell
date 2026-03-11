/**
 * @conshell/proxy — Public API
 *
 * Provides an OpenAI v1/chat/completions compatible proxy layer
 * for the ConShell inference router. Supports CLIProxyAPI-style
 * keys, multi-account round-robin, and model name mapping.
 */
export { ProxyHandler, type ProxyConfig } from './server.js';
export {
    ModelMapper,
} from './model-mapping.js';
export {
    AccountPool,
    parseCLIProxyKey,
    type ProxyAccount,
} from './account-pool.js';
export {
    toInferenceRequest,
    toOpenAIResponse,
    toStreamChunks,
    type OpenAIChatRequest,
    type OpenAIChatResponse,
    type OpenAIMessage,
    type OpenAIModelList,
    type OpenAIModelObject,
    type OpenAIStreamChunk,
    type OpenAIUsage,
} from './translator.js';
export {
    OAuthManager,
    type OAuthProvider,
    type OAuthFlowType,
    type OAuthFlowStatus,
    type OAuthFlowState,
    type OAuthCredential,
    type OAuthProviderConfig,
} from './oauth.js';
