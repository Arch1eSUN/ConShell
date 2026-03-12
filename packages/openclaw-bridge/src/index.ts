/**
 * @conshell/openclaw-bridge — Public API
 *
 * Bridges ConShell's sovereign agent runtime with OpenClaw's ecosystem:
 * - ClawHub skill registry (search, install, audit)
 * - Browser automation (Playwright + Chrome DevTools Protocol)
 * - Multi-channel messaging (Telegram, Discord, Slack, Webhook)
 * - Three-layer tool matrix (Agent / CLI / MCP)
 * - CDP network interception & anti-detection (Wave 3)
 * - Namespace isolation for WsGateway (Wave 4)
 */

// Types
export type {
    BrowserProvider,
    BrowserLaunchOptions,
    BrowserSession,
    NavigateOptions,
    PageInfo,
    ScreenshotOptions,
    ScreenshotResult,
    ElementInfo,
    ClawHubAdapter,
    ClawHubSearchOptions,
    ClawHubSearchResult,
    RemoteSkillManifest,
    InstalledSkillInfo,
    SkillAuditReport,
    SkillAuditIssue,
    ChannelRouter,
    ChannelConfig,
    ChannelMessage,
    ChannelInfo,
    IsolatedInstance,
} from './types.js';

// Implementations
export { PlaywrightBrowserProvider } from './playwright-browser-provider.js';
export { CdpBrowserProvider } from './cdp-browser-provider.js';
export { ClawHubAdapterImpl } from './clawhub-adapter.js';
export { ChannelRouterImpl } from './channel-router.js';

// CDP Extensions (Wave 3)
export {
    NetworkInterceptor,
    AntiDetectMiddleware,
    ANTI_DETECT_PROFILES,
    type NetworkInterceptRule,
    type InterceptedRequest,
    type NetworkInterceptorConfig,
    type AntiDetectProfile,
    type AntiDetectConfig,
} from './cdp-extensions.js';

// Tool Factory
export {
    createBrowserAgentTools,
    createClawHubAgentTools,
    createChannelAgentTools,
    createCdpNetworkAgentTools,
    createNamespaceAgentTools,
    createAllBridgeTools,
} from './tool-factory.js';
export type {
    BridgeToolHandler,
    BridgeToolBundle,
    BridgeToolFactoryOptions,
} from './tool-factory.js';

