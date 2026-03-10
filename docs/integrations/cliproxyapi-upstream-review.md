# CLIProxyAPI Integration — Phase 2: Upstream Review

> **Date**: 2026-03-10 | **Status**: Complete | **Repo**: `github.com/router-for-me/CLIProxyAPI`

---

## 1. What is CLIProxyAPI

A Go-based **unified API proxy/gateway** that exposes OpenAI-compatible endpoints while routing requests through:
- **OAuth logins**: Claude Code, OpenAI Codex, Gemini CLI, Qwen Code, iFlow, Antigravity
- **API keys**: Gemini API, Claude API, Codex API
- **OpenAI-compatible upstreams**: OpenRouter, custom endpoints

Multi-account round-robin load balancing, automatic quota-exceeded failover, streaming, function calling/tools, multimodal input.

---

## 2. How to Start

### Minimal Local Run
```bash
# 1. Download binary (or build from source: go build -o cliproxyapi ./cmd/...)
# 2. Create config.yaml with at least one api-key
# 3. Run
./cliproxyapi --config config.yaml
# → Listens on :8317
```

### Minimal config.yaml
```yaml
port: 8317
api-keys:
  - "my-web4-key"
# Add OAuth credentials by running: ./cliproxyapi auth gemini
# Or add API keys directly in config sections
```

### Docker
```bash
docker compose up -d  # Uses docker-compose.yml in repo
```

---

## 3. API Compatibility with Web4.0

### 3.1 Endpoint

`POST http://localhost:8317/v1/chat/completions` — **fully OpenAI-compatible**

This means the Web4.0 adapter only needs to format requests as OpenAI chat completions and parse the response. Identical to the existing `OpenAIAdapter` pattern.

### 3.2 Streaming: ✅ Supported
SSE streaming via `stream: true` in request body.

### 3.3 Function Calling / Tools: ✅ Supported
Pass `tools` array in request — CLIProxyAPI forwards to underlying provider.

### 3.4 Model Routing
CLIProxyAPI handles model routing internally:
- Client requests `claude-sonnet-4` → CLIProxyAPI routes to Claude OAuth
- Client requests `gemini-2.5-pro` → CLIProxyAPI routes to Gemini OAuth
- Client requests `gpt-4o` → CLIProxyAPI routes to Codex OAuth

Web4.0 adapter can request **any model name** — CLIProxyAPI resolves provider automatically.

### 3.5 Health Check
`GET /v1/models` — returns available models list. Can be used for health checking.

---

## 4. What CLIProxyAPI Solves for Web4.0

| Problem | Solution |
|---|---|
| Claude/Gemini/Codex subscriptions sit idle | Route agent inference through OAuth logins at **zero marginal cost** |
| Multiple accounts, one gateway | Round-robin across N accounts per provider |
| Quota exceeded mid-task | Auto-switch to preview model or next account |
| Need API keys for every provider | OAuth login replaces API keys for subscription models |
| Agent burns through paid API budget | Subscription pool is tried first, paid API only on fallback |

---

## 5. What CLIProxyAPI Does NOT Solve

| Stays in Web4.0 | Reason |
|---|---|
| Memory system | CLIProxyAPI has no concept of memory |
| Soul / constitution | CLIProxyAPI has no agent identity |
| Policy engine | CLIProxyAPI has no safety rules |
| Budget / finance | CLIProxyAPI doesn't track costs |
| Tool execution | CLIProxyAPI only proxies LLM calls |
| Dashboard / observability | CLIProxyAPI has its own management, not Web4.0's |

---

## 6. Risks & Limitations

| Risk | Severity | Mitigation |
|---|---|---|
| CLIProxyAPI process crashes | High | Web4.0 router falls back to direct API providers |
| OAuth tokens expire | Medium | CLIProxyAPI handles token refresh internally |
| Latency overhead (~10-30ms per request) | Low | Negligible vs LLM inference time |
| Management API exposed | Medium | Bind to localhost only (`host: "127.0.0.1"`) |
| CLIProxyAPI is a separate process to manage | Low | Can run via Docker or launchd |
| Model availability varies by subscription | Medium | Routing matrix should include CLIProxyAPI models as non-exclusive |

---

## 7. Recommended Integration

**Approach**: Create a `cliproxyapi` provider adapter that talks to `http://localhost:8317/v1/chat/completions` using OpenAI-compatible request format.

**Why not "replace all providers"**: CLIProxyAPI is a **pool gateway**, not a guaranteed-available service. If it's down, Web4.0 must still function via direct API keys or local Ollama. It should be **one provider among many**, with high routing priority but graceful fallback.

**Why not use separate providers for each OAuth channel**: CLIProxyAPI handles routing internally. Exposing it as a single provider simplifies Web4.0's routing matrix. The agent just requests a model name; CLIProxyAPI picks the best OAuth credential.

### Model Naming Convention
```
cliproxyapi:claude-sonnet-4    → CLIProxyAPI routes to Claude OAuth
cliproxyapi:gemini-2.5-pro     → CLIProxyAPI routes to Gemini OAuth
cliproxyapi:gpt-4o             → CLIProxyAPI routes to Codex OAuth
```
