# Full Tool Packaging — Design Document

> Turn the 12-package library into a launchable product: CLI + HTTP API + WebSocket + React Dashboard.

## Background

The Conway Automaton runtime is complete (Waves 1-9, 277 tests, 12 packages). It is currently a collection of typed modules with no entry point. This design documents how to assemble them into a tool anyone can `pnpm web4 start`.

**Official specs consulted:**
- [Automaton ARCHITECTURE.md](https://raw.githubusercontent.com/Conway-Research/automaton/main/ARCHITECTURE.md) — bootstrap sequence, runtime lifecycle, config schema
- [x402 docs](https://docs.x402.org) — HTTP 402 payment headers, buyer `@x402/fetch`, seller `@x402/express`
- [MCP spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18) — JSON-RPC 2.0 tools/resources
- [web4.ai](https://web4.ai) — manifesto

---

## Architecture

```
     CLI Commands                React Dashboard (Vite)
     ┌──────────┐                ┌──────────────────┐
     │ web4     │                │ :5173 dev        │
     │  start   │                │ Status │ Chat    │
     │  status  │                │ Logs   │ Wallet  │
     │  fund    │  ◄─── HTTP ──► │ Children │ Soul  │
     │  chat    │                └────────┬─────────┘
     └────┬─────┘                         │
          │                          WebSocket
          ▼                               │
     ┌────────────────────────────────────┤
     │        packages/app               │
     │  ┌──────────────────────────────┐ │
     │  │        AgentKernel           │ │
     │  │  DB · Repos · Policy ·       │ │
     │  │  Inference · Soul · Memory · │ │
     │  │  Heartbeat · AgentLoop ·     │ │
     │  │  McpGateway · SelfMod        │ │
     │  └──────────────────────────────┘ │
     │  ┌──────┐ ┌──────┐ ┌──────────┐  │
     │  │Config│ │Server│ │WebSocket │  │
     │  │.env  │ │:4200 │ │/ws       │  │
     │  └──────┘ └──────┘ └──────────┘  │
     └──────────────────────────────────┘
                    │
              SQLite (state.db)
```

---

## New Packages

### 1. `packages/app` — Backend + CLI Entry Point

**Purpose:** Assemble all modules, provide CLI, HTTP API, and WebSocket server.

#### Files

| File | Responsibility |
|------|---------------|
| `src/kernel.ts` | `AgentKernel` — opens DB, creates all repos, assembles policy/inference/soul/heartbeat/agent-loop/mcp-gateway. Single `boot()` method. |
| `src/config.ts` | Reads `.env` / `.env.local`. Auto-detects LLM providers. Exports typed `AppConfig`. |
| `src/server.ts` | Express HTTP server on `:4200`. Serves REST API + static dashboard build. WebSocket on `/ws`. |
| `src/api/status.ts` | `GET /api/status` — delegates to `CliAdmin.status()` |
| `src/api/logs.ts` | `GET /api/logs?sessionId=&limit=` — delegates to `CliAdmin.logs()` |
| `src/api/fund.ts` | `POST /api/fund` `{amount}` — delegates to `CliAdmin.fund()` |
| `src/api/chat.ts` | `POST /api/chat` `{message, sessionId}` — calls `AgentLoop.executeTurn()`, streams via SSE |
| `src/api/children.ts` | `GET /api/children` — lists child agents |
| `src/api/soul.ts` | `GET /api/soul` — returns soul constitution + traits |
| `src/ws.ts` | WebSocket manager — broadcasts state changes (status, new turns, balance) |
| `src/cli.ts` | Commander CLI: `web4 start`, `web4 status`, `web4 fund <amount>`, `web4 chat <msg>` |
| `src/index.ts` | Entry point — parses CLI args, dispatches to start/status/fund/chat |

#### Bootstrap Sequence (following Automaton ARCHITECTURE)

```
1. Load config (.env → AppConfig)
2. Open SQLite database (state.db) + run migrations
3. Create all repositories
4. Create PolicyEngine + ToolRegistry
5. Create InferenceRouter (auto-detect providers)
6. Create Soul, Memory, SelfMod
7. Create HeartbeatDaemon + register default tasks
8. Create AgentLoop
9. Create McpGateway
10. Create CliAdmin
11. Start HTTP + WebSocket server
12. Start HeartbeatDaemon
13. Log: "Agent running on http://localhost:4200"
```

#### Config (`.env`)

```env
# LLM Providers (all optional — auto-detects available)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OLLAMA_URL=http://localhost:11434

# Agent Identity
AGENT_NAME=conway-alpha
GENESIS_PROMPT="You are a sovereign AI agent."

# Wallet (auto-generated on first run if missing)
WALLET_PRIVATE_KEY=0x...

# Server
PORT=4200
DB_PATH=./state.db
LOG_LEVEL=info
```

#### Dependencies

```json
{
  "@web4-agent/core": "workspace:*",
  "@web4-agent/state": "workspace:*",
  "@web4-agent/policy": "workspace:*",
  "@web4-agent/inference": "workspace:*",
  "@web4-agent/memory": "workspace:*",
  "@web4-agent/soul": "workspace:*",
  "@web4-agent/runtime": "workspace:*",
  "@web4-agent/wallet": "workspace:*",
  "@web4-agent/selfmod": "workspace:*",
  "@web4-agent/cli": "workspace:*",
  "express": "^5",
  "ws": "^8",
  "commander": "^13",
  "dotenv": "^16"
}
```

---

### 2. `packages/dashboard` — React Web UI

**Purpose:** Real-time monitoring + interactive chat UI.

#### Tech Stack
- Vite + React 18 + TypeScript
- CSS Modules (no Tailwind — consistent with project convention)
- WebSocket client for real-time state pushes

#### Pages / Components

| Component | Description |
|-----------|-------------|
| `StatusPanel` | Agent state badge, survival tier gauge, wallet address, uptime |
| `FinancialCard` | Balance, top-ups, spends, net. Sparkline chart for spend over time |
| `ChatInterface` | Message input + streaming response display. Shows thinking + tool calls inline |
| `LogsViewer` | Paginated turn list. Click to expand (thinking, tools, tokens, cost). Filter by session |
| `HeartbeatPanel` | Cron schedule table. Last run, next run, status indicator |
| `ChildrenPanel` | Child agent cards with state badges (alive/dead). Fund/spawn actions |
| `SoulPanel` | Readonly display of SOUL.md / constitution / traits |
| `Sidebar` | Navigation between panels |
| `TopBar` | Agent name, connection indicator (WebSocket), quick fund button |

#### API Client

```typescript
// src/lib/api.ts
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4200';

export const api = {
  status: () => fetch(`${BASE}/api/status`).then(r => r.json()),
  logs: (opts) => fetch(`${BASE}/api/logs?${params(opts)}`).then(r => r.json()),
  fund: (amount) => fetch(`${BASE}/api/fund`, { method: 'POST', body: JSON.stringify({amount}) }),
  chat: (message, sessionId) => /* SSE stream */,
  children: () => fetch(`${BASE}/api/children`).then(r => r.json()),
  soul: () => fetch(`${BASE}/api/soul`).then(r => r.json()),
};
```

#### WebSocket Events

```typescript
// Server → Client
{ type: 'status_update', data: AgentStatusReport }
{ type: 'new_turn', data: { sessionId, response, toolCalls, cost } }
{ type: 'balance_change', data: { balance, delta } }
{ type: 'heartbeat_tick', data: { task, result, durationMs } }
{ type: 'state_change', data: { from: AgentState, to: AgentState } }
```

---

## Design Aesthetic

- **Dark mode first** — deep navy (#0a0e27) background, glassmorphism cards
- **Accent palette** — electric blue (#3b82f6) primary, emerald (#10b981) for positive, amber (#f59e0b) for warnings, rose (#f43f5e) for critical
- **Typography** — JetBrains Mono for code/data, Inter for UI text
- **Micro-animations** — status pulse, balance counter, smooth card transitions
- **Survival tier visualization** — color-coded ring around agent avatar that shifts from green → yellow → red as tier degrades

---

## Implementation Phases

### Phase 1: `packages/app` (Kernel + Config + Server + CLI)
1. Scaffold package
2. Implement `config.ts` — dotenv loader + provider detection
3. Implement `kernel.ts` — `AgentKernel.boot()` wiring all modules
4. Implement `server.ts` — Express + API routes
5. Implement `ws.ts` — WebSocket broadcast
6. Implement `cli.ts` — Commander commands
7. Wire `index.ts` entry point
8. Test boot sequence + API endpoints

### Phase 2: `packages/dashboard` (React UI)
1. Scaffold Vite + React project
2. Design system — CSS variables, colors, typography
3. Layout — Sidebar + TopBar + main content area
4. StatusPanel + FinancialCard
5. ChatInterface with SSE streaming
6. LogsViewer with pagination
7. HeartbeatPanel + ChildrenPanel + SoulPanel
8. WebSocket integration for live updates

### Phase 3: Integration + Polish
1. Dashboard build → served by Express as static files
2. End-to-end: CLI start → dashboard opens → chat works
3. Error handling, loading states, empty states
4. Mobile responsive adjustments

---

## Usage (Final)

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env — add API keys (optional, will use Ollama if available)

# Start
pnpm web4 start
# ✓ Database initialized (state.db)
# ✓ LLM providers: Anthropic (claude-sonnet-4-20250514), Ollama (llama3)
# ✓ Heartbeat daemon started (6 tasks)
# ✓ Agent running → http://localhost:4200

# CLI commands (while running)
pnpm web4 status          # JSON status report
pnpm web4 fund 50.00      # Add $50.00 to agent
pnpm web4 chat "hello"    # One-shot chat
```

---

## Verification Plan

### Automated
- `packages/app` unit tests: kernel boot, config loading, API handlers
- `packages/dashboard` component tests (if time permits)
- E2E: start server → hit API → verify response

### Manual
- `pnpm web4 start` → open browser → verify dashboard loads
- Chat with agent → see response stream in real-time
- Fund → verify balance updates on dashboard
- Kill server → restart → verify state persists
