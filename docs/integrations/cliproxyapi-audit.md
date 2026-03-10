# CLIProxyAPI Integration — Phase 1: Web4.0 Architecture Audit

> **Date**: 2026-03-10 | **Status**: Complete | **Author**: Agent

---

## 1. Provider Abstraction

### 1.1 Interface

```typescript
// packages/core/src/types/providers.ts:99
interface InferenceProviderAdapter {
    readonly name: InferenceProviderName;   // union: 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openclaw' | 'nvidia'
    readonly authType: InferenceAuthType;   // 'apiKey' | 'local' | 'oauth'
    readonly available: boolean;
    complete(request: InferenceRequest): Promise<InferenceResponse>;
}
```

All adapters in `packages/app/src/adapters/` implement this interface. Pattern is clean — each ~80 lines, maps to a single API.

### 1.2 Provider Registration

Providers are registered in **kernel.ts L209-247** via switch-case:

```typescript
for (const provider of config.providers) {
    if (!provider.available) continue;
    switch (provider.name) {
        case 'ollama':    adapters.push(new OllamaAdapter(...));    break;
        case 'openai':    adapters.push(new OpenAIAdapter(...));    break;
        case 'anthropic': adapters.push(new AnthropicAdapter(...)); break;
        // ... etc
    }
}
```

Adapters are then passed to `DefaultInferenceRouter` constructor → stored in a `Map<InferenceProviderName, InferenceProviderAdapter>`.

### 1.3 Provider Invocation

`DefaultInferenceRouter.route()` flow:
1. Get ordered model preferences from `ROUTING_MATRIX[tier][taskType]`
2. For each preference: check model registry → check provider availability → budget check → `provider.complete(request)`
3. On success: calculate cost, record to `InferenceCostsRepository`, return response
4. On failure: `continue` to next preference (graceful fallback)

### 1.4 Unified Router

Yes — `DefaultInferenceRouter` is the single unified router. It handles:
- Tier-based model selection
- Provider failover (iterate through preferences)
- Budget enforcement
- Cost tracking

---

## 2. Cost & Budget

### 2.1 Budget Implementation

`dailyBudgetCents` (env: `DAILY_BUDGET_CENTS`, default: 5000) is checked in `router.ts L78-91`:

```typescript
const dailySpent = this.inferenceCosts.getDailyCost(dayStart, dayEnd);
if (dailySpent >= this.options.dailyBudgetCents) {
    throw new Error(`Daily inference budget exceeded: spent ${dailySpent} of ${this.options.dailyBudgetCents} cents`);
}
```

**This is a HARD LIMIT** — throws exception, blocks further inference.

### 2.2 Provider-Level Cost Tracking

Yes — `InferenceCostsRepository.insert()` records:
- `model`, `provider`, `inputTokens`, `outputTokens`, `costCents`, `latencyMs`, `taskType`

### 2.3 Cost Differentiation

Model-level pricing is in `seed.ts` (microcents per million tokens):
- **Zero cost**: ollama (local), openclaw (subscription-billed)
- **Cheap**: gemini-2.0-flash ($0.10/$0.40), openai:gpt-4o-mini ($0.15/$0.60)
- **Mid**: nvidia:mistral-nemo-12b ($0.30/$1.00), anthropic:haiku ($0.80/$4.00)
- **Expensive**: openai:gpt-4o ($2.50/$10.00), anthropic:sonnet-4 ($3.00/$15.00)

> **Critical insight for CLIProxyAPI**: The `openclaw` provider is already seeded with `inputCostMicro: 0, outputCostMicro: 0` because it's "billed via OAuth/subscription". CLIProxyAPI models should follow this exact pattern — set cost=0 in seed data since actual billing happens outside the system.

---

## 3. Configuration & Startup

### 3.1 .env Loading

`config.ts` → `dotenv.config()` → reads `.env` from CWD. Provider detection is a simple function checking env vars:

| Env Var | Provider |
|---|---|
| `OLLAMA_URL` | ollama (always available) |
| `OPENAI_API_KEY` | openai |
| `ANTHROPIC_API_KEY` | anthropic |
| `GEMINI_API_KEY` | gemini |
| `OPENCLAW_OAUTH_TOKEN` | openclaw |
| `NVIDIA_API_KEY` | nvidia |

### 3.2 Adding New Provider

Requires changes in 4 files:
1. `packages/core/src/types/common.ts` — extend `InferenceProvider` union type
2. `packages/app/src/config.ts` — add env var detection in `detectProviders()`
3. `packages/app/src/adapters/` — new adapter class
4. `packages/app/src/kernel.ts` — add switch case

Optionally:
5. `packages/inference/src/seed.ts` — add model definitions
6. `packages/inference/src/routing.ts` — add models to routing matrix

### 3.3 Startup Chain

`index.ts` → `loadConfig()` → `bootKernel(config)` → `createAppServer(agent)` → `httpServer.listen(port)`

### 3.4 Chat Request Path

`POST /api/chat` → `agent.agentLoop.executeTurn()` → `agentLoop.routeWithRetry()` → `inferenceRouter.route()` → `provider.complete()`

---

## 4. Observability

### 4.1 Dashboard Provider Status

`GET /api/providers` returns `{name, available, authType, endpoint}` for each configured provider. Dashboard's `ProviderPanel` renders this.

### 4.2 Logging

Each inference call logs: `model`, `inputTokens`, `outputTokens`, `costCents`, `latencyMs`. Provider failures log: `model`, `error`. Budget exceedance logs warning.

### 4.3 Fallback Visibility

The router iterates through `ROUTING_MATRIX` preferences and logs `'Provider error, trying next model'` on each failure. Fallback is observable in logs.

---

## 5. Recommended Integration Point

### 5.1 Best Approach: New Provider

**Insert CLIProxyAPI as a new `InferenceProviderAdapter`** named `'cliproxyapi'`, following the exact same pattern as `OllamaAdapter` and `OpenClawAdapter`.

Justification:
- CLIProxyAPI exposes OpenAI-compatible `/v1/chat/completions` endpoint
- It can be wrapped in the existing adapter pattern (80-line class)
- Models proxied through it can be seeded with `inputCostMicro: 0, outputCostMicro: 0` (subscription/prepaid)
- The routing matrix can prioritize CLIProxyAPI models in `high` and `normal` tiers

### 5.2 Injection Points (Minimal Set)

| File | Change |
|---|---|
| `core/src/types/common.ts` | Add `'cliproxyapi'` to `InferenceProvider` union |
| `app/src/config.ts` | Add `CLIPROXYAPI_*` env detection |
| `app/src/adapters/cliproxyapi-adapter.ts` | New adapter (OpenAI-compatible) |
| `app/src/kernel.ts` | Add `case 'cliproxyapi'` |
| `inference/src/seed.ts` | Add CLIProxyAPI model entries (cost=0) |
| `inference/src/routing.ts` | Insert CLIProxyAPI models at priority positions |

### 5.3 What NOT to Touch

- `packages/runtime/*` — AgentLoop, heartbeat, tools (purely downstream of inference)
- `packages/policy/*` — PolicyEngine rules
- `packages/soul/*` — Constitution
- `packages/memory/*` — Memory tiers
- `packages/state/*` — SQLite repos (already generic enough)
- `packages/wallet/*` — Wallet
- `packages/x402/*` — Payment protocol
- `packages/dashboard/*` — Only add visibility, don't restructure

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| CLIProxyAPI down → all subscription models unavailable | Agent falls back to next viable provider (built-in) | Routing matrix includes fallbacks; adapter sets `available=false` on health-check failure |
| CLIProxyAPI latency spike | Slow chat responses | Add timeout config (`CLIPROXYAPI_TIMEOUT_MS`) |
| `InferenceProvider` union type change = breaking for downstream | Build-time error if missed | TypeScript compiler will catch exhaustiveness issues |
| Cost=0 models skew budget tracking | Budget appears underutilized | Document that CLIProxyAPI costs are external; optionally add `billingMode` field later |
