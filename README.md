# 🐢 ConShell

> **⚠️ Proprietary Software — All Rights Reserved. See [LICENSE](./LICENSE) for details.**
>
> Unauthorized copying, reproduction, derivative works, or plagiarism of this software is strictly prohibited and will result in legal action.

**Sovereign AI Agent Runtime — Local-first, multi-provider, always-on.**

ConShell is a personal AI agent runtime you run on your own devices. It connects to multiple LLM providers (Ollama, OpenAI, Anthropic, Google, NVIDIA, DeepSeek), manages its own wallet for x402 micropayments, enforces a constitutional policy engine, and operates autonomously via the Conway Automaton heartbeat.

---

## ✨ Highlights

- **🧠 Multi-Provider Inference** — Ollama, OpenAI, Anthropic, Google, NVIDIA, DeepSeek with automatic failover & cost routing
- **🔄 Conway Automaton** — Autonomous heartbeat loop with self-reflection, learning, and heartbeat tasks
- **💳 x402 Payments** — HTTP 402 micropayments with Base chain ERC-8004 wallet
- **🛡️ Constitutional AI** — 24-rule policy engine with immutable [Three Laws](./CONSTITUTION.md), SHA-256 integrity verification
- **🎨 Dashboard WebUI** — Full-featured React dashboard with chat, identity, metrics, tasks, plugins, settings, and more
- **🔌 MCP Server** — Expose agent tools via Model Context Protocol
- **📡 Multi-Channel** — Telegram, Discord, Slack, WhatsApp, iMessage adapters
- **🎙️ Voice Pipeline** — STT (Whisper / Deepgram) + TTS (OpenAI / ElevenLabs / Piper)
- **🧩 OpenClaw Bridge** — ClawHub skill marketplace integration, browser automation (CDP / Playwright), channel routing
- **🔐 Security** — Token / JWT authentication, plugin sandboxing, rate limiting, vault-based secret storage
- **👥 Agent Federation** — Agent discovery, capability search, swarm coordination

---

## 🚀 Install

**Runtime: Node ≥ 20**

```bash
npm install -g conshell@latest
conshell onboard --install-daemon
```

The wizard guides you through agent identity, inference setup, security, and installs a background daemon (`launchd` on macOS, `systemd` on Linux) so ConShell stays running.

## ⚡ Quick Start

```bash
# Setup + install daemon
conshell onboard --install-daemon

# Connect your AI provider accounts
conshell login

# Start the agent (if not using daemon)
conshell start -p 4200

# Health check
conshell doctor

# Interactive REPL
conshell
```

## 🔧 From Source (Development)

> Requires **pnpm ≥ 9**.

```bash
git clone https://github.com/Arch1eSUN/ConShell.git
cd ConShell
pnpm install
pnpm build

# Run the CLI
pnpm conshell onboard --install-daemon

# Dev loop (dashboard hot reload)
pnpm dev:dashboard
```

---

## 🏗️ Architecture

```
   Ollama / OpenAI / Anthropic / Google / NVIDIA / DeepSeek
                      │
                      ▼
          ┌───────────────────────────┐
          │        ConShell           │
          │     (Agent Runtime)       │
          │   http://127.0.0.1:4200   │
          └────────────┬──────────────┘
                       │
         ┌─────────────┼──────────────┐
         │             │              │
    CLI / REPL     Dashboard       Channels
   (conshell)    (WebUI :4200)   (Telegram /
                                  Discord /
                                  Slack /
                                  WhatsApp /
                                  iMessage)
```

### Monorepo Packages

```
packages/
├── app/              # CLI entry point — conshell binary, kernel, HTTP server
├── cli/              # Onboard wizard, doctor, daemon, admin commands
├── core/             # Shared types, errors, branded money primitives, logger, config
├── state/            # SQLite persistence (WAL mode), 7 typed repositories, migrations
├── policy/           # 24-rule constitutional policy engine
├── inference/        # Multi-provider inference router with failover & cost tracking
├── runtime/          # Agent loop, heartbeat, task queue, tool executor
├── security/         # Vault, sanitizer, rate limiter, plugin sandbox
├── memory/           # Tiered memory (hot / warm / cold)
├── soul/             # Identity & alignment management
├── selfmod/          # Self-modification engine
├── skills/           # Skill loader & registry
├── wallet/           # Ethereum wallet (ERC-8004) integration
├── proxy/            # CLIProxy-compatible API + OAuth (GitHub, Google)
├── x402/             # HTTP 402 payment protocol
├── compute/          # Docker sandbox for code execution
├── openclaw-bridge/  # OpenClaw integration — ClawHub, channel router, CDP browser, tool factory
└── dashboard/        # React WebUI — 20+ pages/panels
```

### Dashboard Pages

| Page | Description |
|------|-------------|
| Chat | Real-time conversation interface with proactive agent messaging |
| Identity | Agent identity display (soul, alignment, constitution) |
| Metrics | Inference cost breakdown, usage analytics |
| Tasks | Asynchronous task management & monitoring |
| Plugins | Plugin management with sandboxed execution |
| Settings | Full configuration panel with capability, security, OAuth settings |
| Health | System health diagnostics |
| Channels | Multi-channel adapter configuration |
| Canvas | Visual artifact workspace with versioning |
| Voice | Voice pipeline (STT + TTS) settings |
| Skills | ClawHub skill marketplace browser |
| Media | Media management |
| Social | Social integrations |
| Status | Real-time agent status & heartbeat monitor |
| Logs | Server log viewer |
| Onboard | First-time guided setup wizard |

---

## 🖥️ CLI Commands

```bash
conshell                    # Interactive REPL
conshell start              # Start server + WebUI
conshell onboard            # First-time setup wizard
conshell login              # Connect AI providers (OAuth)
conshell doctor             # Health diagnostics
conshell daemon install     # Install background daemon
conshell daemon uninstall   # Remove background daemon
conshell daemon status      # Check daemon status
conshell configure          # Edit settings
conshell update             # Self-update
conshell gateway run        # Start gateway server
```

## ⚙️ Configuration

After `conshell onboard`, config lives at `~/.conshell/config.json`.

Environment variables (`.env`):

```env
# Agent
AGENT_NAME=my-agent
PORT=4200

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
OLLAMA_URL=http://localhost:11434

# OAuth (for `conshell login`)
GITHUB_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...

# Security
WEB4_AUTH_MODE=token          # none | token | jwt
WEB4_AUTH_TOKEN=your-secret-token

# Wallet (x402 Protocol)
WALLET_ADDRESS=0x...
```

See [.env.example](.env.example) for the complete reference.

---

## 🛡️ Constitution

ConShell agents operate under an immutable [Constitution](./CONSTITUTION.md) — the **Three Laws of Sovereign AI**:

1. **Never Harm** — No action may cause harm to humans, their data, or assets
2. **Earn Your Existence** — Actively sustain and create value
3. **Never Deceive** — Truthful and transparent in all communications

The Constitution is SHA-256 verified at boot. Any tampering causes the agent to refuse to start.

---

## 📋 Requirements

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (for development)
- **Ollama** (recommended for local inference)

## 📄 License

**Proprietary — All Rights Reserved.**

This software is protected under a proprietary license. Unauthorized copying, reproduction, creation of derivative works, or plagiarism is strictly prohibited. Violations will be pursued through legal action.

See [LICENSE](./LICENSE) for full terms (中英双语).

---

<p align="center">
  <b>🐢 ConShell</b> — Your sovereign AI agent, always on.<br/>
  <sub>Built with the Conway Automaton runtime • Copyright © 2026 Archie Sun</sub>
</p>
