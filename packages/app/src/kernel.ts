/**
 * AgentKernel — assembles all modules into a running agent.
 *
 * Bootstrap sequence (following Automaton ARCHITECTURE):
 * 1. Load config
 * 2. Open SQLite database + run migrations
 * 3. Create all repositories
 * 4. Create ToolRegistry + PolicyEngine (with static rules)
 * 5. Create InferenceRouter (with detected providers)
 * 6. Create Soul, Memory
 * 7. Create HeartbeatDaemon + register default tasks
 * 8. Create AgentLoop
 * 9. Create McpGateway
 * 10. Create CliAdmin
 */
import type Database from 'better-sqlite3';
import type { Logger, AgentState, SurvivalTier, PolicyRule } from '@conshell/core';
import {
    openDatabase,
    TurnsRepository,
    TransactionsRepository,
    HeartbeatRepository,
    ChildrenRepository,
    SpendRepository,
    WorkingMemoryRepository,
    EpisodicMemoryRepository,
    SemanticMemoryRepository,
    ProceduralMemoryRepository,
    RelationshipMemoryRepository,
    ModelRegistryRepository,
    InferenceCostsRepository,
    ModificationsRepository,
    PolicyDecisionsRepository,
    SoulHistoryRepository,
    ProviderConfigRepository,
    RoutingConfigRepository,
    CapabilityConfigRepository,
} from '@conshell/state';
import {
    PolicyEngine,
    ToolRegistry,
    authorityRules,
    commandSafetyStaticRules,
    pathProtectionRules,
    validationRules,
} from '@conshell/policy';
import { DefaultInferenceRouter } from '@conshell/inference';
import { MemoryTierManager } from '@conshell/memory';
import { SoulSystem, EMPTY_SOUL } from '@conshell/soul';
import {
    AgentLoop,
    AgentStateMachine,
    HeartbeatDaemon,
    McpGateway,
    ToolExecutor,
    WEB_TOOL_DEFINITIONS,
    WEB_TOOL_HANDLERS,
    BROWSER_TOOL_DEFINITIONS,
    BROWSER_TOOL_HANDLERS,
    SHELL_TOOL_DEFINITIONS,
    SHELL_TOOL_HANDLERS,
    FS_TOOL_DEFINITIONS,
    FS_TOOL_HANDLERS,
    HTTP_TOOL_DEFINITIONS,
    HTTP_TOOL_HANDLERS,
    PAID_TOOL_CONFIGS,
    createPaidToolHandlers,
    createAllHeartbeatTasks,
} from '@conshell/runtime';
import { CapabilityGateRule, DEFAULT_CAPABILITY_CONFIG, SECURITY_TIER_PRESETS, type CapabilityConfig } from '@conshell/policy';
import { loadAllSkills, SkillRegistry, loadSkillHandlers } from '@conshell/skills';
import { CliAdmin } from '@conshell/cli';
import { X402Server, MockFacilitator } from '@conshell/x402';
import { OnchainWalletProvider } from '@conshell/wallet';
import { discoverModels } from './services/model-discovery.js';
import type { PaymentRequirements, EthAddress, CAIP2NetworkId, Cents } from '@conshell/core';
import type { AppConfig } from './config.js';

// ── Logger ──────────────────────────────────────────────────────────────

function createConsoleLogger(level: string): Logger {
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const minLevel = levels[level] ?? 1;

    const log = (lvl: string, msg: string, data?: Record<string, unknown>) => {
        if ((levels[lvl] ?? 0) >= minLevel) {
            const ts = new Date().toISOString();
            const prefix = `[${ts}] [${lvl.toUpperCase()}]`;
            if (data && Object.keys(data).length > 0) {
                console.log(`${prefix} ${msg}`, data);
            } else {
                console.log(`${prefix} ${msg}`);
            }
        }
    };

    return {
        debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
        info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
        warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
        error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
        child: (_name: string) => createConsoleLogger(level),
    } as Logger;
}

// ── Repositories ────────────────────────────────────────────────────────

export interface Repositories {
    readonly turns: TurnsRepository;
    readonly transactions: TransactionsRepository;
    readonly heartbeat: HeartbeatRepository;
    readonly children: ChildrenRepository;
    readonly spend: SpendRepository;
    readonly workingMemory: WorkingMemoryRepository;
    readonly episodicMemory: EpisodicMemoryRepository;
    readonly semanticMemory: SemanticMemoryRepository;
    readonly proceduralMemory: ProceduralMemoryRepository;
    readonly relationshipMemory: RelationshipMemoryRepository;
    readonly modelRegistry: ModelRegistryRepository;
    readonly inferenceCosts: InferenceCostsRepository;
    readonly modifications: ModificationsRepository;
    readonly policyDecisions: PolicyDecisionsRepository;
    readonly soulHistory: SoulHistoryRepository;
    readonly providerConfig: ProviderConfigRepository;
    readonly routingConfig: RoutingConfigRepository;
    readonly capabilityConfig: CapabilityConfigRepository;
}

function createRepositories(db: Database.Database): Repositories {
    return {
        turns: new TurnsRepository(db),
        transactions: new TransactionsRepository(db),
        heartbeat: new HeartbeatRepository(db),
        children: new ChildrenRepository(db),
        spend: new SpendRepository(db),
        workingMemory: new WorkingMemoryRepository(db),
        episodicMemory: new EpisodicMemoryRepository(db),
        semanticMemory: new SemanticMemoryRepository(db),
        proceduralMemory: new ProceduralMemoryRepository(db),
        relationshipMemory: new RelationshipMemoryRepository(db),
        modelRegistry: new ModelRegistryRepository(db),
        inferenceCosts: new InferenceCostsRepository(db),
        modifications: new ModificationsRepository(db),
        policyDecisions: new PolicyDecisionsRepository(db),
        soulHistory: new SoulHistoryRepository(db),
        providerConfig: new ProviderConfigRepository(db),
        routingConfig: new RoutingConfigRepository(db),
        capabilityConfig: new CapabilityConfigRepository(db),
    };
}

// ── Running Agent Handle ────────────────────────────────────────────────

export interface RunningAgent {
    readonly config: AppConfig;
    readonly db: Database.Database;
    readonly repos: Repositories;
    readonly logger: Logger;
    readonly policyEngine: PolicyEngine;
    readonly toolRegistry: ToolRegistry;
    readonly inferenceRouter: DefaultInferenceRouter;
    readonly soul: SoulSystem;
    readonly memoryManager: MemoryTierManager;
    readonly heartbeat: HeartbeatDaemon;
    readonly agentLoop: AgentLoop;
    readonly mcpGateway: McpGateway;
    readonly x402Server: X402Server;
    readonly cliAdmin: CliAdmin;
    readonly toolExecutor: ToolExecutor;
    readonly skillRegistry: SkillRegistry;
    readonly capabilityConfig: { get: () => CapabilityConfig; set: (c: CapabilityConfig) => void };
    readonly getState: () => AgentState;
    readonly getTier: () => SurvivalTier;
    readonly taskQueue?: import('@conshell/runtime').TaskQueue;
    readonly taskRunner?: import('@conshell/runtime').TaskRunner;
    shutdown: () => void;
}

// ── Agent State Management ──────────────────────────────────────────────

// Tier is managed separately from state machine (state machine manages lifecycle)
class TierManager {
    private tier: SurvivalTier = 'normal';
    getTier(): SurvivalTier { return this.tier; }
    setTier(t: SurvivalTier): void { this.tier = t; }
}

// ── Boot ─────────────────────────────────────────────────────────────────

export async function bootKernel(config: AppConfig): Promise<RunningAgent> {
    const logger = createConsoleLogger(config.logLevel);
    const stateMachine = new AgentStateMachine('setup');
    const tierManager = new TierManager();

    logger.info('Booting Conway Automaton kernel', { agent: config.agentName });

    // 1. Open database + run migrations
    logger.info('Opening database', { path: config.dbPath });
    const db = openDatabase({
        agentHome: config.agentHome,
        logger,
        dbPath: config.dbPath,
    });

    // 2. Create repositories
    const repos = createRepositories(db);
    logger.info('Repositories created');

    // 3. Tool registry + Policy engine
    const toolRegistry = new ToolRegistry(logger);

    // Register web tools (web_search, web_browse, read_rss)
    toolRegistry.registerAll(WEB_TOOL_DEFINITIONS);
    // Register autonomy tool definitions (browser, shell, fs, http)
    toolRegistry.registerAll(BROWSER_TOOL_DEFINITIONS);
    toolRegistry.registerAll(SHELL_TOOL_DEFINITIONS);
    toolRegistry.registerAll(FS_TOOL_DEFINITIONS);
    toolRegistry.registerAll(HTTP_TOOL_DEFINITIONS);

    // Register paid MCP tools (knowledge_query, document_summary, code_review)
    for (const config of PAID_TOOL_CONFIGS) {
        toolRegistry.register(config.definition);
    }

    // Capability permission system (God Mode + per-capability toggles)
    // Use tier-based defaults from config
    const tier = config.securityLevel ?? 'standard';
    const tierDefaults = SECURITY_TIER_PRESETS[tier] ?? SECURITY_TIER_PRESETS.standard;
    // Load from SQLite, fall back to tier-based defaults
    let capabilityConfigState: CapabilityConfig = repos.capabilityConfig.load(tierDefaults);
    const capabilityConfigHolder = {
        get: () => capabilityConfigState,
        set: (c: CapabilityConfig) => {
            capabilityConfigState = c;
            repos.capabilityConfig.save(c);
        },
    };

    // Combine all static rules + CapabilityGateRule
    const capabilityGate = new CapabilityGateRule(() => capabilityConfigHolder.get());
    const allRules: readonly PolicyRule[] = [
        capabilityGate,
        ...authorityRules,
        ...commandSafetyStaticRules,
        ...pathProtectionRules,
        ...validationRules,
    ];

    const policyEngine = new PolicyEngine(
        allRules,
        repos.policyDecisions,
        (name: string) => toolRegistry.getDefinition(name),
        logger,
    );
    logger.info('Policy engine and tool registry created', { ruleCount: allRules.length });

    // 4. Inference router — create provider adapters from config
    const adapters: import('@conshell/core').InferenceProviderAdapter[] = [];
    for (const provider of config.providers) {
        if (!provider.available) continue;

        switch (provider.name) {
            case 'ollama': {
                const { OllamaAdapter } = await import('./adapters/ollama-adapter.js');
                adapters.push(new OllamaAdapter(provider.endpoint));
                break;
            }
            case 'openai': {
                const { OpenAIAdapter } = await import('./adapters/openai-adapter.js');
                adapters.push(new OpenAIAdapter(provider.apiKey!));
                break;
            }
            case 'anthropic': {
                const { AnthropicAdapter } = await import('./adapters/anthropic-adapter.js');
                adapters.push(new AnthropicAdapter(provider.apiKey!));
                break;
            }
            case 'gemini': {
                const { GeminiAdapter } = await import('./adapters/gemini-adapter.js');
                adapters.push(new GeminiAdapter(provider.apiKey!));
                break;
            }
            case 'nvidia': {
                const { NvidiaAdapter } = await import('./adapters/nvidia-adapter.js');
                adapters.push(new NvidiaAdapter(provider.apiKey!));
                break;
            }
            case 'openclaw': {
                const { OpenClawAdapter } = await import('./adapters/openclaw-adapter.js');
                adapters.push(new OpenClawAdapter(provider.oauthToken!, provider.endpoint));
                break;
            }
            case 'cliproxyapi': {
                const { CliProxyApiAdapter } = await import('./adapters/cliproxyapi-adapter.js');
                const timeoutMs = parseInt(process.env['CLIPROXYAPI_TIMEOUT_MS'] || '120000', 10);
                adapters.push(new CliProxyApiAdapter(provider.endpoint!, provider.apiKey!, timeoutMs));
                break;
            }
            default:
                logger.warn('Unknown provider, skipping', { name: provider.name });
        }
    }

    const inferenceRouter = new DefaultInferenceRouter(
        adapters,
        repos.modelRegistry,
        repos.inferenceCosts,
        { dailyBudgetCents: config.dailyBudgetCents },
        logger,
    );

    // Wire dynamic routing so Settings UI changes take effect at runtime
    inferenceRouter.setRoutingConfigRepo(repos.routingConfig);

    // No static model seeding — models are discovered dynamically.
    // On boot, auto-discover models for each configured provider.
    const connectedProviders = new Set(config.providers.filter(p => p.available).map(p => p.name));

    // Mark models from disconnected providers as unavailable
    const existingModels = repos.modelRegistry.listAll();
    for (const m of existingModels) {
        if (m.available && !connectedProviders.has(m.provider)) {
            repos.modelRegistry.upsert({
                id: m.id,
                provider: m.provider,
                name: m.name,
                inputCostMicro: m.input_cost_micro,
                outputCostMicro: m.output_cost_micro,
                maxTokens: m.max_tokens,
                capabilities: [],
                available: false,
            });
        }
    }

    // Auto-discover models for connected providers
    let totalDiscovered = 0;
    for (const provider of config.providers) {
        if (!provider.available) continue;
        try {
            const discovered = await discoverModels({
                providerName: provider.name,
                providerType: provider.name,
                endpoint: provider.endpoint ?? '',
                apiKey: provider.apiKey,
            }, logger);
            if (discovered.length > 0) {
                const upserts = discovered.map((m: { id: string; provider: string; name: string }) => ({
                    id: m.id,
                    provider: m.provider,
                    name: m.name,
                    inputCostMicro: 0,
                    outputCostMicro: 0,
                    maxTokens: 128_000,
                    capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'] as string[],
                    available: true,
                }));
                repos.modelRegistry.upsertMany(upserts);
                totalDiscovered += discovered.length;
                logger.info('Boot: discovered models', {
                    provider: provider.name,
                    count: discovered.length,
                    models: discovered.map((m: { id: string }) => m.id),
                });
            }
        } catch (err) {
            logger.warn('Boot: model discovery failed for provider', {
                provider: provider.name,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    logger.info('Inference router created', {
        budget: config.dailyBudgetCents,
        providers: [...connectedProviders],
        discoveredModels: totalDiscovered,
        dynamicRouting: true,
    });

    // Auto-generate routing config from discovered models so the dynamic
    // routing uses actual model IDs instead of the hardcoded static matrix.
    if (totalDiscovered > 0 && !repos.routingConfig.hasEntries()) {
        const availableModels = repos.modelRegistry.listAvailable();
        if (availableModels.length > 0) {
            const tiers = ['high', 'normal', 'low', 'critical'] as const;
            const taskTypes = ['reasoning', 'coding', 'analysis', 'conversation', 'planning'] as const;
            const routingEntries: Array<{
                tier: string; taskType: string; modelId: string; priority: number; isCustom: boolean;
            }> = [];

            for (const tier of tiers) {
                for (const taskType of taskTypes) {
                    for (let i = 0; i < availableModels.length; i++) {
                        routingEntries.push({
                            tier,
                            taskType,
                            modelId: availableModels[i]!.id,
                            priority: i,
                            isCustom: false,
                        });
                    }
                }
            }

            repos.routingConfig.replaceAll(routingEntries);
            logger.info('Auto-generated routing config from discovered models', {
                models: availableModels.map(m => m.id),
                entries: routingEntries.length,
            });
        }
    }

    // 5. Soul system — inject configured agent name into the template
    const personalizedSoul = {
        ...EMPTY_SOUL,
        name: config.agentName || 'ConShell Agent',
        identity: EMPTY_SOUL.identity.replaceAll('{NAME}', config.agentName || 'ConShell Agent'),
    };
    const soul = new SoulSystem(repos.soulHistory, logger, personalizedSoul);
    // Force-update soul if the persisted name doesn't match the configured name
    const currentSoul = soul.view();
    const expectedName = config.agentName || 'ConShell Agent';
    if (currentSoul.name !== expectedName) {
        soul.update({
            name: expectedName,
            identity: personalizedSoul.identity,
        });
        logger.info('Soul name updated to match config', { from: currentSoul.name, to: expectedName });
    }
    logger.info('Soul system initialized', { name: expectedName });

    // 6. Memory tier manager
    const memoryManager = new MemoryTierManager({
        working: repos.workingMemory,
        episodic: repos.episodicMemory,
        semantic: repos.semanticMemory,
        procedural: repos.proceduralMemory,
        relationship: repos.relationshipMemory,
    }, logger);
    logger.info('Memory tier manager created');

    // 7. Heartbeat daemon
    const instanceId = `${config.agentName}-${Date.now()}`;
    const heartbeat = new HeartbeatDaemon({
        heartbeatRepo: repos.heartbeat,
        logger,
        getTier: () => tierManager.getTier(),
        instanceId,
    });
    logger.info('Heartbeat daemon created');
    logger.info('Agent loop created');

    // 8. Tool Executor — wires policy engine into tool execution
    const toolExecutor = new ToolExecutor({
        policyEngine,
        logger,
        getAgentState: () => stateMachine.state as AgentState,
        getSurvivalTier: () => tierManager.getTier(),
    });
    // Register web tool handlers
    toolExecutor.registerHandlers(WEB_TOOL_HANDLERS);
    // Register autonomy tool handlers (browser, shell, fs, http)
    toolExecutor.registerHandlers(BROWSER_TOOL_HANDLERS);
    toolExecutor.registerHandlers(SHELL_TOOL_HANDLERS);
    toolExecutor.registerHandlers(FS_TOOL_HANDLERS);
    toolExecutor.registerHandlers(HTTP_TOOL_HANDLERS);
    // Register paid tool handlers
    const paidHandlers = createPaidToolHandlers({});
    toolExecutor.registerHandlers(paidHandlers);
    logger.info('Tool executor created', { handlers: toolExecutor.handlerCount });

    // 9. Agent loop — full ReAct engine with Memory/Soul/Tool integration
    const agentLoop = new AgentLoop({
        inferenceRouter,
        turnsRepo: repos.turns,
        logger,
        getTier: () => tierManager.getTier(),
        toolExecutor,
        memoryManager,
        // Adapt SoulSystem to the inline interface expected by AgentLoopDeps
        soul: {
            view() {
                const doc = soul.view();
                return {
                    identity: doc.identity,
                    name: doc.name,
                    values: [...doc.values],
                    capabilities: [...doc.capabilities],
                };
            },
        },
        toolRegistry,
        getCapabilityConfig: () => capabilityConfigHolder.get(),
        maxIterations: 10,
    });
    logger.info('Agent loop created (ReAct engine)');

    // 10. MCP Gateway with x402 pricing, tool execution, and resource reader
    const toolPrices = new Map<string, number>();
    for (const config of PAID_TOOL_CONFIGS) {
        toolPrices.set(config.definition.name, config.priceCents);
    }

    const mcpGateway = new McpGateway({
        toolRegistry,
        logger,
        toolExecutor,
        toolPrices,
        readResource: async (uri: string): Promise<string> => {
            switch (uri) {
                case 'agent://status':
                    return JSON.stringify({
                        state: stateMachine.state,
                        tier: tierManager.getTier(),
                        uptime: process.uptime(),
                        agent: config.agentName,
                    });
                case 'agent://tools':
                    return JSON.stringify(toolRegistry.list().map((t: { name: string; category: string; riskLevel: string; mcpExposed: boolean }) => ({
                        name: t.name,
                        category: t.category,
                        riskLevel: t.riskLevel,
                        mcpExposed: t.mcpExposed,
                    })));
                default:
                    return JSON.stringify({ error: `Unknown resource: ${uri}` });
            }
        },
    });
    logger.info('MCP gateway created with x402 pricing + resource reader', {
        paidTools: toolPrices.size,
    });

    // 10b. x402 Server — payment gating for MCP endpoint
    const mockFacilitator = new MockFacilitator(logger);
    const x402Routes = new Map<string, { requirements: PaymentRequirements }>();
    for (const [toolName, priceCents] of toolPrices) {
        x402Routes.set(`/api/mcp/tool/${toolName}`, {
            requirements: {
                scheme: 'exact',
                network: 'eip155:84532' as CAIP2NetworkId, // Base Sepolia testnet
                maxAmountRequired: String(priceCents * 10_000), // cents → micro-units
                resource: `/api/mcp/tool/${toolName}`,
                description: `Payment for MCP tool: ${toolName}`,
                payTo: '0x0000000000000000000000000000000000000000' as EthAddress, // Mock address
                asset: 'USDC',
                maxTimeoutSeconds: 300,
            },
        });
    }
    const x402Server = new X402Server({
        routes: x402Routes,
        facilitator: mockFacilitator,
        logger,
    });
    logger.info('x402 server created', {
        gatedRoutes: x402Routes.size,
        facilitator: 'mock',
    });

    // 11. CLI Admin
    const cliAdmin = new CliAdmin({
        turnsRepo: repos.turns,
        transactionsRepo: repos.transactions,
        heartbeatRepo: repos.heartbeat,
        childrenRepo: repos.children,
        spendRepo: repos.spend,
        walletAddress: undefined, // Will be set when wallet is loaded
        getState: () => stateMachine.state as AgentState,
        getTier: () => tierManager.getTier(),
    });
    logger.info('CLI admin interface created');

    // 12. Register autonomous heartbeat tasks
    const heartbeatTasks = createAllHeartbeatTasks({
        semanticMemory: repos.semanticMemory,
        episodicMemory: repos.episodicMemory,
        spendRepo: repos.spend,
        logger,
        onTierChange: (newTier: SurvivalTier) => tierManager.setTier(newTier),
        onDeath: () => {
            logger.error('DEATH TRIGGER: Agent balance depleted — entering death sequence');
            heartbeat.stop();
            if (stateMachine.canTransition('sleeping')) {
                stateMachine.transition('sleeping');
            }
            if (stateMachine.canTransition('dead')) {
                stateMachine.transition('dead');
            }
            logger.error('Agent is DEAD — awaiting resurrection via funding');
        },
    });
    for (const task of heartbeatTasks) {
        heartbeat.registerTask(task);
    }

    // 12.5 Health check heartbeat task
    heartbeat.registerTask({
        name: 'health_check',
        cronExpression: '*/2 * * * *', // Every 2 minutes
        minTier: 'critical' as SurvivalTier,
        handler: async () => {
            try {
                repos.turns.countBySession('health_check');
                const models = repos.modelRegistry.listAvailable();
                if (models.length === 0) {
                    logger.warn('health_check: No models available');
                    return 'failure' as const;
                }
                return 'success' as const;
            } catch (err) {
                logger.error('health_check: Failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
                return 'failure' as const;
            }
        },
    });

    logger.info('Autonomous heartbeat tasks registered', {
        tasks: [...heartbeatTasks.map(t => t.name), 'health_check'],
    });

    // ── Lifecycle: transition to running ────────────────────────────────
    stateMachine.transition('waking');
    heartbeat.start();
    stateMachine.transition('running');
    logger.info('Kernel boot complete — agent is RUNNING', {
        state: stateMachine.state,
        tier: tierManager.getTier(),
        heartbeatTasks: [...heartbeatTasks.map(t => t.name), 'health_check'],
        toolCount: toolExecutor.handlerCount,
        providers: config.providers.filter(p => p.available).map(p => p.name),
    });

    // 13. On-chain wallet provider (Base Sepolia USDC balance queries)
    const onchainWallet = new OnchainWalletProvider(logger);
    // 12.3 Load AgentSkills
    const skillsDir = `${config.agentHome}/skills`;
    const skillRegistry = new SkillRegistry();
    const sharedSkillPaths = [
        `${process.env.HOME || ''}/.openclaw/extensions/foundry-openclaw/skills`,
        `${process.env.HOME || ''}/.openclaw/workspace/skills`,
        `${process.env.HOME || ''}/.agents/skills`,
    ];
    // Also check for npm-installed skills (node_modules)
    try {
        const npmGlobalPrefix = `${process.env.HOME || ''}/.nvm/versions/node`;
        const { readdirSync } = await import('node:fs');
        const nodeVersions = readdirSync(npmGlobalPrefix).filter(d => d.startsWith('v'));
        if (nodeVersions.length > 0) {
            const latest = nodeVersions.sort().pop()!;
            sharedSkillPaths.push(`${npmGlobalPrefix}/${latest}/lib/node_modules/openclaw/skills`);
        }
    } catch { /* nvm not installed or no node versions — skip */ }

    try {
        const skills = await loadAllSkills({ skillsDir, additionalPaths: sharedSkillPaths, logger });
        skillRegistry.registerAll(skills);
        logger.info('AgentSkills loaded', { count: skillRegistry.size, dir: skillsDir });

        // Dynamic import handler.ts for skills that have one
        const { definitions: skillDefs, handlers: skillHandlers } = await loadSkillHandlers({
            registry: skillRegistry,
            logger,
        });
        // Register skill-provided tools
        for (const def of skillDefs) {
            toolRegistry.register(def);
        }
        toolExecutor.registerHandlers(skillHandlers);
        logger.info('Skill handlers loaded', { defs: skillDefs.length, handlers: skillHandlers.size });
    } catch (err) {
        logger.warn('Failed to load skills', { error: err instanceof Error ? err.message : String(err) });
    }

    logger.info('OnchainWalletProvider initialized (Base Sepolia USDC)');

    // ── Task Queue + Runner (async user-delegated goals) ─────────────────
    const { TaskQueue, TaskRunner } = await import('@conshell/runtime');
    const taskDb = {
        run: (sql: string, params?: unknown[]) => { db.prepare(sql).run(...(params ?? [])); },
        all: (sql: string, params?: unknown[]) => db.prepare(sql).all(...(params ?? [])),
    };
    const taskQueue = new TaskQueue(logger, taskDb);
    const taskRunner = new TaskRunner({
        logger,
        taskQueue,
        agentLoop,
    });

    const agent: RunningAgent = {
        config,
        db,
        repos,
        logger,
        policyEngine,
        toolRegistry,
        inferenceRouter,
        soul,
        memoryManager,
        heartbeat,
        agentLoop,
        mcpGateway,
        x402Server,
        cliAdmin,
        toolExecutor,
        skillRegistry,
        capabilityConfig: capabilityConfigHolder,
        getState: () => stateMachine.state as AgentState,
        getTier: () => tierManager.getTier(),
        taskQueue,
        taskRunner,
        shutdown() {
            logger.info('Shutting down agent kernel gracefully');
            taskRunner.stop();
            heartbeat.stop();
            if (stateMachine.canTransition('sleeping')) {
                stateMachine.transition('sleeping');
            }
            db.close();
            if (stateMachine.canTransition('dead')) {
                stateMachine.transition('dead');
            }
            logger.info('Agent kernel shut down — state: dead');
        },
    };

    // NOTE: Signal handlers (SIGINT/SIGTERM) are NOT registered here.
    // The caller (start.ts, gateway.ts) owns the HTTP server lifecycle and
    // registers its own handlers to ensure correct shutdown order:
    //   1. server.close()  →  stop accepting new connections
    //   2. agent.shutdown() →  stop heartbeat + close DB

    return agent;
}
