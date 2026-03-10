/**
 * @web4-agent/runtime — Public API
 */
export { AgentStateMachine, type AgentState } from './state-machine.js';
export { AgentLoop, type AgentLoopDeps, type AgentMessage, type AgentTurnResult, type ToolCallResult } from './agent-loop.js';
export { HeartbeatDaemon, type HeartbeatTask, type HeartbeatContext, type HeartbeatDaemonDeps } from './heartbeat.js';
export {
    McpGateway,
    type McpGatewayDeps,
    type McpToolDefinition,
    type McpResource,
    type JsonRpcRequest,
    type JsonRpcResponse,
    type JsonRpcError,
} from './mcp-gateway.js';
export { ToolExecutor, type ToolExecutorDeps, MAX_TOOL_RESULT_SIZE } from './tool-executor.js';
export {
    WEB_TOOL_DEFINITIONS,
    WEB_TOOL_HANDLERS,
    webSearchDefinition,
    webBrowseDefinition,
    readRssDefinition,
    handleWebSearch,
    handleWebBrowse,
    handleReadRss,
    stripHtml,
    type SearchResult,
    type RssEntry,
    type ToolHandler,
} from './tools/web-tools.js';
export {
    PAID_TOOL_DEFINITIONS,
    PAID_TOOL_CONFIGS,
    createPaidToolHandlers,
    type PaidToolConfig,
    type PaidToolDeps,
} from './tools/paid-tools.js';
export {
    createAllHeartbeatTasks,
    createAutonomousLearningTask,
    createKnowledgeReviewTask,
    createCreditMonitorTask,
    type AllHeartbeatTaskDeps,
    type LearningTaskDeps,
    type CreditMonitorDeps,
} from './heartbeat-tasks.js';
export {
    SelfEvolutionEngine,
    createSelfEvolutionTask,
    type SelfEvolutionDeps,
    type EvolutionPatch,
} from './self-evolution.js';
export {
    ReplicationManager,
    type ReplicationConfig as ReplicationManagerConfig,
    type ReplicationDeps,
    type SpawnResult,
} from './replication.js';
export {
    BROWSER_TOOL_DEFINITIONS,
    BROWSER_TOOL_HANDLERS,
} from './tools/browser-tools.js';
export {
    SHELL_TOOL_DEFINITIONS,
    SHELL_TOOL_HANDLERS,
} from './tools/shell-tools.js';
export {
    FS_TOOL_DEFINITIONS,
    FS_TOOL_HANDLERS,
} from './tools/fs-tools.js';
export {
    HTTP_TOOL_DEFINITIONS,
    HTTP_TOOL_HANDLERS,
} from './tools/http-tools.js';
