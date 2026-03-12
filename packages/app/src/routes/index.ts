/**
 * Route index — re-exports all route registrars.
 */
export { registerStatusRoutes } from './api-status.js';
export { registerChatRoutes } from './api-chat.js';
export { registerAdminRoutes } from './api-admin.js';
export { registerSettingsRoutes } from './api-settings.js';
export { registerProxyRoutes } from './api-proxy.js';
export { registerMcpRoutes } from './api-mcp.js';
export { registerWebhookRoutes } from './api-webhooks.js';
export { registerCronRoutes } from './api-cron.js';
export { registerSkillsMarketplaceRoutes } from './api-skills-marketplace.js';
export { registerOAuthRoutes } from './api-oauth.js';
export { registerSocialRoutes } from './api-social.js';
export { registerIdentityRoutes } from './api-identity.js';
export { registerBackupRoutes } from './api-backup.js';
export { registerPluginRoutes } from './api-plugins.js';
export { registerSecurityRoutes } from './api-security.js';
export { registerTaskRoutes } from './api-tasks.js';
export type { RouteContext, RouteRegistrar } from './context.js';

