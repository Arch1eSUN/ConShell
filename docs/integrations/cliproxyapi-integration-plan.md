# CLIProxyAPI Integration — Phase 3: Integration Design

> **Date**: 2026-03-10 | **Status**: Complete

---

## 1. Architecture Overview

```
User → POST /api/chat → AgentLoop.executeTurn()
  → inferenceRouter.route(request, tier)
    → ROUTING_MATRIX[tier][taskType] → ordered model list
      → for each model:
          → modelRegistry.getById(modelId) → check available
          → providers.get(modelRow.provider) → get adapter
          → budgetCheck() → provider.complete(request)
```

**CLIProxyAPI inserts as**: A new `InferenceProviderAdapter` named `'cliproxyapi'` that routes to `http://localhost:8317/v1/chat/completions`.

**Integration surface**: 6 files modified, 1 file added. Zero structural changes.

---

## 2. Files to Modify

### 2.1 `packages/core/src/types/common.ts`
Add `'cliproxyapi'` to the `InferenceProvider` union type and `'proxy'` to `InferenceAuthType`.

```diff
- export type InferenceProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openclaw' | 'nvidia';
+ export type InferenceProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openclaw' | 'nvidia' | 'cliproxyapi';

- export type InferenceAuthType = 'apiKey' | 'local' | 'oauth';
+ export type InferenceAuthType = 'apiKey' | 'local' | 'oauth' | 'proxy';
```

### 2.2 `packages/app/src/adapters/cliproxyapi-adapter.ts` [NEW]
New adapter (~90 lines) implementing `InferenceProviderAdapter`:

```typescript
export class CliProxyApiAdapter implements InferenceProviderAdapter {
    readonly name: InferenceProviderName = 'cliproxyapi';
    readonly authType: InferenceAuthType = 'proxy';
    readonly available: boolean = true;

    constructor(
        private readonly endpoint: string,
        private readonly apiKey: string,
        private readonly timeoutMs: number = 120000,
    ) {}

    async complete(request: InferenceRequest): Promise<InferenceResponse> {
        // Format as OpenAI chat completion
        // POST to endpoint/v1/chat/completions
        // Parse OpenAI-format response
    }
}
```

### 2.3 `packages/app/src/config.ts`
Add CLIProxyAPI provider detection:

```diff
+ // CLIProxyAPI (proxy gateway)
+ const cliproxyapiKey = process.env['CLIPROXYAPI_API_KEY'];
+ const cliproxyapiUrl = process.env['CLIPROXYAPI_BASE_URL'] || 'http://localhost:8317';
+ const cliproxyapiEnabled = process.env['CLIPROXYAPI_ENABLED'] !== 'false';
+ providers.push({
+     name: 'cliproxyapi',
+     authType: 'proxy',
+     available: !!cliproxyapiKey && cliproxyapiEnabled,
+     endpoint: cliproxyapiUrl,
+     apiKey: cliproxyapiKey,
+ });
```

### 2.4 `packages/app/src/kernel.ts`
Add switch case in provider instantiation:

```diff
+ case 'cliproxyapi': {
+     const { CliProxyApiAdapter } = await import('./adapters/cliproxyapi-adapter.js');
+     const timeoutMs = parseInt(process.env['CLIPROXYAPI_TIMEOUT_MS'] || '120000', 10);
+     adapters.push(new CliProxyApiAdapter(provider.endpoint!, provider.apiKey!, timeoutMs));
+     break;
+ }
```

### 2.5 `packages/inference/src/seed.ts`
Add CLIProxyAPI model definitions (cost=0, subscription-billed):

```typescript
// ── CLIProxyAPI (subscription/OAuth pool, zero marginal cost) ──
{ id: 'cliproxyapi:claude-sonnet-4', provider: 'cliproxyapi', name: 'Claude Sonnet 4 (via Proxy)', inputCostMicro: 0, outputCostMicro: 0, maxTokens: 200_000, capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'], available: true },
{ id: 'cliproxyapi:gemini-2.5-pro', provider: 'cliproxyapi', name: 'Gemini 2.5 Pro (via Proxy)', inputCostMicro: 0, outputCostMicro: 0, maxTokens: 1_000_000, capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'], available: true },
{ id: 'cliproxyapi:gpt-4o', provider: 'cliproxyapi', name: 'GPT-4o (via Proxy)', inputCostMicro: 0, outputCostMicro: 0, maxTokens: 128_000, capabilities: ['reasoning', 'coding', 'analysis', 'conversation', 'planning'], available: true },
```

### 2.6 `packages/inference/src/routing.ts`
Insert CLIProxyAPI models at **top of each tier** (highest priority = lowest cost):

For `high` and `normal` tiers: prepend `cliproxyapi:claude-sonnet-4` and `cliproxyapi:gemini-2.5-pro` before existing models.
For `low` tier: prepend `cliproxyapi:gemini-2.5-pro`.
For `critical` tier: **no change** (only local ollama models).

---

## 3. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLIPROXYAPI_ENABLED` | No | `true` | Enable/disable CLIProxyAPI provider |
| `CLIPROXYAPI_BASE_URL` | No | `http://localhost:8317` | CLIProxyAPI endpoint |
| `CLIPROXYAPI_API_KEY` | **Yes** (if enabled) | — | API key matching config.yaml `api-keys` |
| `CLIPROXYAPI_TIMEOUT_MS` | No | `120000` | Request timeout |

---

## 4. Cost Strategy

CLIProxyAPI models are seeded with `inputCostMicro: 0, outputCostMicro: 0` — same pattern as `openclaw` models. Rationale:
- Actual cost is subscription-based, not per-token
- Web4.0's budget system tracks per-token costs → these models won't consume budget
- This naturally prioritizes CLIProxyAPI: the router picks first viable model, and zero-cost models don't trigger budget limits

**Effect**: Daily budget is conserved for paid API fallback only.

---

## 5. Routing Strategy

### Priority Order (per tier)
```
high:    cliproxyapi → openclaw → anthropic → openai → nvidia → gemini → ollama
normal:  cliproxyapi → anthropic → openai → gemini → nvidia → ollama
low:     cliproxyapi → openai-mini → gemini-flash → nvidia → ollama
critical: ollama only (no network dependency)
```

### Fallback Chain
1. CLIProxyAPI model fails → router tries next model in preference list
2. All CLIProxyAPI models fail → falls through to direct API providers
3. All API providers fail → falls through to local Ollama
4. Budget exceeded → hard error

---

## 6. MVP Scope

### In Scope
- [x] `CliProxyApiAdapter` (OpenAI-compatible POST)
- [x] Config detection from env vars
- [x] Kernel integration (switch case)
- [x] Model seed data (3 models)
- [x] Routing matrix update (high/normal/low tiers)
- [x] Dashboard visibility (/api/providers automatically picks it up)

### Out of Scope (future)
- Health-check integration (probe /v1/models before marking available)
- Dynamic model discovery from CLIProxyAPI
- Usage statistics from CLIProxyAPI management API
- Dashboard enhanced view for proxy pool status
- Model auto-aliasing based on CLIProxyAPI config

---

## 7. Verification Plan

1. **Build**: `pnpm run build` passes without errors
2. **Unit test**: Existing `inference.test.ts` still passes
3. **Config test**: With/without `CLIPROXYAPI_API_KEY` — provider detected/not detected
4. **Integration test**: Start CLIProxyAPI + Web4.0, send chat → response comes through proxy
5. **Fallback test**: Stop CLIProxyAPI, send chat → falls back to next provider
6. **Dashboard test**: `/api/providers` shows CLIProxyAPI status
