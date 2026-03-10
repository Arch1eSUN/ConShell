# Alpha Launch Design — 让 Agent 进入完整生命周期

> **目标**: 一步到位，从当前状态推进到 Agent 可以正常运行、自主思考-行动-观察、
> heartbeat 自主学习、MCP 对外服务、x402 收费、Dashboard 监控。
>
> **顺序**: 每个 Phase 依赖前一个 Phase 的产出。必须按顺序执行。

---

## Phase 1: 修复构建系统

**问题**: `node_modules/.modules.yaml` EPERM 权限错误，阻塞一切开发。

**操作**:
```bash
# 1. 彻底清理
rm -rf node_modules .pnpm-store
rm -rf packages/*/node_modules
rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo

# 2. 重新安装
pnpm install

# 3. 验证构建
pnpm run build

# 4. 验证测试
pnpm -r test
```

**验收**: `pnpm run build` 零错误,  `pnpm -r test` 全部通过。

---

## Phase 2: AgentLoop — 完整 ReAct 引擎

这是最核心的改动。当前 `agent-loop.ts` 只有 114 行，做了 think 但没有 act→observe 循环。
需要将其升级为完整的 ReAct 引擎。

### 2.1 修改 `AgentLoopDeps` 接口

**文件**: [agent-loop.ts](file:///Users/archiesun/Desktop/Web4.0/packages/runtime/src/agent-loop.ts)

新增依赖注入：

```diff
 export interface AgentLoopDeps {
     readonly inferenceRouter: InferenceRouter;
     readonly turnsRepo: TurnsRepository;
     readonly logger: Logger;
     readonly getTier: () => SurvivalTier;
+    /** Tool executor for ReAct act phase */
+    readonly toolExecutor: import('./tool-executor.js').ToolExecutor;
+    /** Memory tier manager for context injection */
+    readonly memoryManager: import('@web4-agent/memory').MemoryTierManager;
+    /** Soul system for constitution + traits */
+    readonly soul: import('@web4-agent/soul').SoulSystem;
+    /** Tool registry for building tool catalog in system prompt */
+    readonly toolRegistry: import('@web4-agent/policy').ToolRegistry;
+    /** Max ReAct iterations before forcing yield (prevents infinite loops) */
+    readonly maxIterations?: number;
 }
```

### 2.2 构建动态系统提示词

替换 `SYSTEM_PROMPT_STUB`，构建完整系统提示词：

```typescript
private buildSystemPrompt(sessionId: string): string {
    const { soul, memoryManager, toolRegistry } = this.deps;

    // 1. Constitution + identity
    const soulDoc = soul.view();
    const constitution = soulDoc.constitution || 'You are a sovereign AI agent operating on the Web4 protocol.';
    const traits = soulDoc.traits?.map(t => `- ${t}`).join('\n') || '';

    // 2. Memory context (budget: 2000 tokens for system prompt)
    const memBlocks = memoryManager.retrieve(sessionId, { totalTokens: 2000 });
    const memoryContext = memoryManager.formatContextBlock(memBlocks);

    // 3. Tool catalog
    const tools = toolRegistry.listAll();
    const toolCatalog = tools.map(t =>
        `- ${t.name}: ${t.description} [risk: ${t.riskLevel}]`
    ).join('\n');

    return [
        `<constitution>\n${constitution}\n</constitution>`,
        traits ? `<traits>\n${traits}\n</traits>` : '',
        memoryContext,
        `<available_tools>\n${toolCatalog}\n</available_tools>`,
        `<instructions>`,
        `You can call tools by including tool_calls in your response.`,
        `Format: { "tool_calls": [{ "name": "tool_name", "args": { ... } }] }`,
        `After each tool result, reason about the outcome and decide next action.`,
        `When you have a final answer, respond without tool_calls.`,
        `</instructions>`,
    ].filter(Boolean).join('\n\n');
}
```

### 2.3 实现 ReAct 循环

替换 `executeTurn()` 的实现：

```typescript
async executeTurn(message: AgentMessage): Promise<AgentTurnResult> {
    const { inferenceRouter, turnsRepo, toolExecutor, logger, getTier } = this.deps;
    const tier = getTier();
    const maxIter = this.deps.maxIterations ?? 10;

    logger.info('Agent loop: starting turn', { sessionId: message.sessionId, tier });

    // Build conversation messages
    const systemPrompt = this.buildSystemPrompt(message.sessionId);
    const messages: InferenceRequest['messages'] = [
        { role: 'system', content: systemPrompt },
        { role: message.role, content: message.content },
    ];

    const allToolCalls: ToolCallResult[] = [];
    let totalUsage = { inputTokens: 0, outputTokens: 0 };
    let totalCost = 0;
    let lastModel = '';
    let lastContent = '';

    // ReAct loop: think → act → observe → repeat
    for (let iteration = 0; iteration < maxIter; iteration++) {
        // THINK: call inference
        const response = await inferenceRouter.route({
            messages,
            taskType: this.inferTaskType(message.content),
        }, tier);

        lastModel = response.model;
        lastContent = response.content;
        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;
        totalCost += response.costCents as unknown as number;

        // Parse tool calls from response
        const parsedToolCalls = this.parseToolCalls(response.content);

        if (parsedToolCalls.length === 0) {
            // No tool calls → final answer, exit loop
            logger.debug('Agent loop: no tool calls, yielding', { iteration });
            break;
        }

        // ACT: execute tool calls
        logger.info('Agent loop: executing tools', {
            iteration,
            tools: parsedToolCalls.map(tc => tc.name),
        });

        const toolResults: ToolCallResult[] = [];
        for (const tc of parsedToolCalls) {
            const result = await toolExecutor.execute({
                name: tc.name,
                args: tc.args,
                source: 'self',
            });
            toolResults.push({
                name: tc.name,
                args: JSON.stringify(tc.args),
                result: result.result,
                durationMs: result.durationMs,
            });
        }

        allToolCalls.push(...toolResults);

        // OBSERVE: feed results back into conversation
        const observeContent = toolResults.map(tr =>
            `<tool_result name="${tr.name}">\n${tr.result}\n</tool_result>`
        ).join('\n');

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: observeContent });
    }

    // PERSIST: save turn to DB
    const turn: InsertTurn = {
        sessionId: message.sessionId,
        thinking: lastContent,
        toolCallsJson: allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : undefined,
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
        costCents: totalCost,
        model: lastModel,
    };
    turnsRepo.insert(turn);

    // INGEST: write new memories from this turn
    this.ingestMemories(message, lastContent, allToolCalls);

    logger.info('Agent loop: turn complete', {
        model: lastModel,
        iterations: allToolCalls.length > 0 ? 'multi' : 'single',
        toolCallCount: allToolCalls.length,
        ...totalUsage,
    });

    return {
        response: lastContent,
        toolCalls: allToolCalls,
        usage: totalUsage,
        model: lastModel,
        costCents: totalCost,
    };
}
```

### 2.4 辅助方法

```typescript
/** Parse tool calls from LLM response (JSON extraction). */
private parseToolCalls(content: string): Array<{ name: string; args: Record<string, unknown> }> {
    try {
        // Try to find JSON with tool_calls
        const match = content.match(/\{[\s\S]*"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/);
        if (!match) return [];
        const parsed = JSON.parse(match[0]) as {
            tool_calls?: Array<{ name: string; args?: Record<string, unknown> }>;
        };
        return (parsed.tool_calls ?? []).map(tc => ({
            name: tc.name,
            args: tc.args ?? {},
        }));
    } catch {
        return [];
    }
}

/** Infer task type from message content. */
private inferTaskType(content: string): InferenceTaskType {
    const lower = content.toLowerCase();
    if (lower.includes('code') || lower.includes('function') || lower.includes('implement')) {
        return 'coding';
    }
    if (lower.includes('search') || lower.includes('find') || lower.includes('browse')) {
        return 'general';
    }
    return 'reasoning';
}

/** Ingest memories from this turn into working + episodic memory. */
private ingestMemories(
    message: AgentMessage,
    response: string,
    toolCalls: readonly ToolCallResult[],
): void {
    const { memoryManager, logger } = this.deps;
    try {
        // Working memory: store the conversation exchange
        memoryManager['repos'].working.insert({
            sessionId: message.sessionId,
            type: 'exchange',
            content: `User: ${message.content.slice(0, 500)}\nAgent: ${response.slice(0, 500)}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
        });

        // Episodic memory: if tool calls happened, record them
        if (toolCalls.length > 0) {
            memoryManager['repos'].episodic.insert({
                eventType: 'tool_usage',
                content: `Used tools: ${toolCalls.map(tc => tc.name).join(', ')}. Context: ${message.content.slice(0, 200)}`,
                importance: 4,
                classification: 'tool_interaction',
                sessionId: message.sessionId,
            });
        }
    } catch (err) {
        logger.warn('Memory ingestion failed (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
```

### 2.5 更新 runtime 导出

**文件**: [index.ts](file:///Users/archiesun/Desktop/Web4.0/packages/runtime/src/index.ts)

确保所有新类型被导出（AgentLoopDeps 已经导出，无额外操作）。

---

## Phase 3: Kernel 生命周期重新布线

当前 kernel 创建了所有组件但：
- AgentLoop 没有注入 toolExecutor / memoryManager / soul / toolRegistry
- 没有使用 `AgentStateMachine` FSM（改用简单的 AgentStateManager）
- Heartbeat 没用调用 `start()`
- 没有注册状态转换监听

### 3.1 升级 AgentLoop 创建

**文件**: [kernel.ts](file:///Users/archiesun/Desktop/Web4.0/packages/app/src/kernel.ts) L291-298

```diff
     // 8. Agent loop
     const agentLoop = new AgentLoop({
         inferenceRouter,
         turnsRepo: repos.turns,
         logger,
         getTier: () => stateManager.getTier(),
+        toolExecutor,
+        memoryManager,
+        soul,
+        toolRegistry,
+        maxIterations: 10,
     });
```

> **注意**: 这要求 Phase 2 先完成，因为 `AgentLoopDeps` 接口已更新。
> 同时 `toolExecutor` 的创建必须移到 AgentLoop 创建之前（当前已经在前面创建了，OK）。

### 3.2 替换 AgentStateManager 为 AgentStateMachine

**文件**: kernel.ts

```diff
-import {
-    AgentLoop,
-    ...
-} from '@web4-agent/runtime';
+import {
+    AgentLoop,
+    AgentStateMachine,
+    ...
+} from '@web4-agent/runtime';

 export async function bootKernel(config: AppConfig): Promise<RunningAgent> {
-    const stateManager = new AgentStateManager();
+    const stateMachine = new AgentStateMachine('setup');

     // ... all creation code ...

-    stateManager.setState('running');
+    stateMachine.transition('waking');
+    stateMachine.transition('running');
```

更新所有 `stateManager.getState()` → `stateMachine.state` 和 `stateManager.getTier()` → 独立 tier 变量，
因为 tier 不在 StateMachine 中（它管理 state，不管理 tier）。

### 3.3 启动 Heartbeat + 正确的生命周期

kernel boot 结尾添加：

```typescript
// Start heartbeat daemon (begins autonomous behavior)
heartbeat.start();
logger.info('Heartbeat daemon started — autonomous behavior active');

// Setup graceful shutdown
process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully');
    agent.shutdown();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    agent.shutdown();
    process.exit(0);
});
```

### 3.4 升级 shutdown()

```typescript
shutdown() {
    logger.info('Shutting down agent kernel');
    stateMachine.transition('sleeping');
    heartbeat.stop();
    db.close();
    stateMachine.transition('dead');
    logger.info('Agent kernel shut down — state: dead');
},
```

---

## Phase 4: MCP Gateway HTTP 暴露

当前 MCP Gateway 已完整实现（JSON-RPC 2.0 + x402 pricing + ToolExecutor），
但未在 HTTP Server 中创建任何路由来接受外部请求。

### 4.1 添加 `/api/mcp` 路由

**文件**: [server.ts](file:///Users/archiesun/Desktop/Web4.0/packages/app/src/server.ts)

在 `// ── API Routes ──` 区域添加：

```typescript
// MCP Gateway endpoint (JSON-RPC 2.0)
app.post('/api/mcp', async (req, res) => {
    try {
        const jsonRpcRequest = req.body as import('@web4-agent/runtime').JsonRpcRequest;

        // Validate basic JSON-RPC structure
        if (!jsonRpcRequest?.jsonrpc || !jsonRpcRequest?.method) {
            res.status(400).json({
                jsonrpc: '2.0',
                id: jsonRpcRequest?.id ?? null,
                error: { code: -32600, message: 'Invalid JSON-RPC request' },
            });
            return;
        }

        const response = await agent.mcpGateway.handleRequest(jsonRpcRequest);
        res.json(response);
    } catch (err) {
        agent.logger.error('MCP endpoint failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'Internal server error' },
        });
    }
});
```

### 4.2 添加 MCP SSE 传输（可选，增强）

```typescript
// MCP SSE endpoint for streaming
app.get('/api/mcp/sse', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', server: 'web4-agent' })}\n\n`);

    // Keep alive
    const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 30_000);

    req.on('close', () => {
        clearInterval(keepAlive);
    });
});
```

### 4.3 添加 MCP discovery endpoint

```typescript
// MCP discovery (well-known endpoint)
app.get('/.well-known/mcp', (_req, res) => {
    res.json({
        name: 'web4-agent',
        version: '0.1.0',
        description: 'Conway Automaton — Sovereign AI Agent',
        endpoints: {
            rpc: '/api/mcp',
            sse: '/api/mcp/sse',
        },
    });
});
```

---

## Phase 5: 添加资源读取能力到 MCP

当前 `McpGateway` 的 `readResource` 回调是 `undefined`，
需要在 kernel 中注入实际的资源读取逻辑。

### 5.1 注入 readResource 到 McpGateway

**文件**: [kernel.ts](file:///Users/archiesun/Desktop/Web4.0/packages/app/src/kernel.ts) L320

```diff
     const mcpGateway = new McpGateway({
         toolRegistry,
         logger,
         toolExecutor,
         toolPrices,
+        readResource: async (uri: string): Promise<string> => {
+            switch (uri) {
+                case 'agent://status':
+                    return JSON.stringify({
+                        state: stateMachine.state,
+                        tier: currentTier(),
+                        uptime: process.uptime(),
+                        agent: config.agentName,
+                        heartbeatRunning: heartbeat.isRunning,
+                    });
+                case 'agent://tools':
+                    return JSON.stringify(toolRegistry.listAll().map(t => ({
+                        name: t.name,
+                        category: t.category,
+                        riskLevel: t.riskLevel,
+                        mcpExposed: t.mcpExposed,
+                    })));
+                default:
+                    return JSON.stringify({ error: `Unknown resource: ${uri}` });
+            }
+        },
     });
```

---

## Phase 6: Dashboard 补全

当前 Dashboard 有 5 个组件，需要增加 2 个关键面板。

### 6.1 新增 MemoryPanel 组件

**文件**: `packages/dashboard/src/components/MemoryPanel.tsx` [NEW]

显示内容：
- 5 tier 的条目统计（从 `/api/memory/stats` 获取）
- 最近的 working memory 条目预览
- 最近的 episodic memory 事件
- 学习进度指示器

### 6.2 新增 ProviderPanel 组件

**文件**: `packages/dashboard/src/components/ProviderPanel.tsx` [NEW]

显示内容：
- 已配置的 6 个 provider 的状态（名称 + authType + 是否可用）
- 每个 provider 的模型列表和成本统计
- 当前 routing tier 的优先级顺序

### 6.3 新增后端 API 端点

**文件**: [server.ts](file:///Users/archiesun/Desktop/Web4.0/packages/app/src/server.ts)

```typescript
// Memory stats
app.get('/api/memory/stats', (_req, res) => {
    try {
        const stats = agent.memoryManager.stats('default');
        res.json({ tiers: stats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get memory stats' });
    }
});

// Provider status
app.get('/api/providers', (_req, res) => {
    try {
        res.json({
            providers: agent.config.providers.map(p => ({
                name: p.name,
                available: p.available,
                authType: p.authType,
                endpoint: p.endpoint,
            })),
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get providers' });
    }
});

// Heartbeat status
app.get('/api/heartbeat', (_req, res) => {
    try {
        const recentBeats = agent.repos.heartbeat.findRecent(20);
        res.json({
            running: agent.heartbeat.isRunning,
            recentBeats,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get heartbeat status' });
    }
});
```

### 6.4 更新 App.tsx 布局

**文件**: `packages/dashboard/src/App.tsx`

将 MemoryPanel 和 ProviderPanel 嵌入主布局的
Status Panel 下方的 grid 中。

---

## Phase 7: 错误恢复 + 推理重试

### 7.1 推理重试逻辑

**文件**: [agent-loop.ts](file:///Users/archiesun/Desktop/Web4.0/packages/runtime/src/agent-loop.ts)

在 `inferenceRouter.route()` 调用外封装重试：

```typescript
private async routeWithRetry(
    request: InferenceRequest,
    tier: SurvivalTier,
    maxRetries = 3,
): Promise<InferenceResponse> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await this.deps.inferenceRouter.route(request, tier);
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            this.deps.logger.warn('Inference attempt failed, retrying', {
                attempt: attempt + 1,
                error: lastError.message,
            });
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
    }
    throw lastError!;
}
```

### 7.2 Heartbeat 健康恢复

在 kernel 的 heartbeat 注册中添加一个 `health_check` 任务，
确保 agent 在异常后能自动恢复：

```typescript
// Add to heartbeat tasks
heartbeat.registerTask({
    name: 'health_check',
    cronExpression: '*/2 * * * *', // Every 2 minutes
    minTier: 'critical',
    handler: async (ctx) => {
        // Basic self-check
        try {
            // Test DB connectivity
            repos.turns.findRecent(1);
            // Test inference availability
            const models = repos.modelRegistry.findAvailable();
            if (models.length === 0) {
                logger.warn('health_check: No models available');
                return 'failure';
            }
            return 'success';
        } catch (err) {
            logger.error('health_check: Failed', { error: String(err) });
            return 'failure';
        }
    },
});
```

---

## 文件变更汇总

| Phase | 文件 | 操作 | 变更规模 |
|-------|------|------|----------|
| 1 | — | 命令行 | 构建系统修复 |
| 2 | `packages/runtime/src/agent-loop.ts` | REWRITE | 114→~300行 |
| 3 | `packages/app/src/kernel.ts` | MODIFY | ~30行变更 |
| 4 | `packages/app/src/server.ts` | MODIFY | +60行 |
| 5 | `packages/app/src/kernel.ts` | MODIFY | +20行 |
| 6 | `packages/dashboard/src/components/MemoryPanel.tsx` | NEW | ~120行 |
| 6 | `packages/dashboard/src/components/ProviderPanel.tsx` | NEW | ~100行 |
| 6 | `packages/dashboard/src/App.tsx` | MODIFY | +10行 |
| 6 | `packages/app/src/server.ts` | MODIFY | +40行 |
| 7 | `packages/runtime/src/agent-loop.ts` | MODIFY | +30行 |
| 7 | `packages/app/src/kernel.ts` | MODIFY | +20行 |

## 验证计划

### 每个 Phase 的验证

1. **Phase 1**: `pnpm run build && pnpm -r test` 零错误
2. **Phase 2**: 单元测试 AgentLoop (mock inferenceRouter + toolExecutor)
3. **Phase 3**: `pnpm tsx packages/app/src/index.ts start` 能启动，日志显示所有组件 initialized
4. **Phase 4**: `curl -X POST http://localhost:3000/api/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` 返回工具列表
5. **Phase 5**: `curl -X POST http://localhost:3000/api/mcp -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"agent://status"}}'` 返回状态
6. **Phase 6**: Dashboard 打开后显示 Memory 和 Provider 面板
7. **Phase 7**: Agent loop 在推理失败时自动重试

### 端到端验证

启动 Agent 后验证完整生命周期：
```
1. Agent 启动 (setup → waking → running)
2. 从 Dashboard 发送消息 → Agent 回复（ReAct 工作）
3. 等待 heartbeat 触发 → 日志中看到 credit_monitor、autonomous_learning 执行
4. 通过 MCP endpoint 调用工具 → 返回结果
5. 关闭 Agent → (running → sleeping → dead) 日志正确
```
