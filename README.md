# 🐢 ConShell

**Sovereign AI Agent Runtime — Local-first, multi-provider, always-on.**

ConShell is a personal AI agent runtime you run on your own devices. It connects to multiple LLM providers (Ollama, OpenAI, Anthropic, Google, NVIDIA, DeepSeek), manages its own wallet for x402 payments, and operates autonomously via the Conway Automaton heartbeat.

---

## Install (recommended)

Runtime: **Node ≥ 20**.

```bash
npm install -g conshell@latest
conshell onboard --install-daemon
```

The wizard guides you through agent identity, inference setup, security, and installs a background daemon (launchd on macOS, systemd on Linux) so ConShell stays running.

## Quick Start (TL;DR)

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

## From Source (development)

Prefer `pnpm` for builds from source.

```bash
git clone https://github.com/Arch1eSUN/WEB4.0.git
cd WEB4.0
pnpm install
pnpm build
pnpm conshell onboard --install-daemon

# Dev loop
pnpm dev
```

Note: `pnpm conshell ...` runs via the built CLI. `pnpm build` produces `dist/` for running via Node.

---

## How It Works

```
   Ollama / OpenAI / Anthropic / Google / NVIDIA / DeepSeek
                      │
                      ▼
          ┌───────────────────────────┐
          │       ConShell            │
          │    (Agent Runtime)        │
          │   http://127.0.0.1:4200   │
          └────────────┬──────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    CLI / REPL     Dashboard      Channels
   (conshell)    (WebUI :4200)   (Telegram/
                                 Discord/
                                  Slack)
```

## Key Features

| Feature | Description |
|---------|-------------|
| 🧠 Multi-Provider Inference | Ollama, OpenAI, Anthropic, Google, NVIDIA, DeepSeek + failover |
| 🔄 Conway Automaton | Autonomous heartbeat loop with self-reflection and learning |
| 💳 x402 Payments | HTTP 402 micropayments with Base chain wallet |
| 🔌 MCP Server | Expose agent tools via Model Context Protocol |
| 📡 Multi-Channel | Telegram, Discord, Slack adapters with webhook support |
| 🎙️ Voice Pipeline | STT (Whisper/Deepgram) + TTS (OpenAI/ElevenLabs/Piper) |
| 🎨 Canvas/A2UI | Visual artifact workspace with versioning |
| 🛡️ Security | Constitution enforcement, plugin sandboxing, rate limiting |
| 🔐 OAuth Login | Connect GitHub, Google, Claude, OpenAI from terminal |
| 👥 Agent Federation | Agent discovery, capability search, swarm coordination |

## CLI Commands

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

## Configuration

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
WEB4_AUTH_MODE=token
WEB4_AUTH_TOKEN=your-secret-token
```

See [.env.example](.env.example) for the complete reference.

## Architecture

```
packages/
├── app/         # CLI entry point (conshell binary)
├── cli/         # Onboard wizard, doctor, admin, daemon
├── core/        # Types, errors, money, logger, config
├── state/       # SQLite persistence (WAL mode)
├── policy/      # 24-rule policy engine
├── inference/   # Multi-provider inference router
├── runtime/     # Agent loop, heartbeat, tools
├── security/    # Vault, sanitizer, rate limiter
├── memory/      # Tiered memory (hot/warm/cold)
├── soul/        # Identity & alignment management
├── selfmod/     # Self-modification engine
├── skills/      # Skill loader & registry
├── wallet/      # Ethereum wallet (ERC-8004)
├── proxy/       # CLIProxy-compatible API + OAuth
├── x402/        # Payment protocol
├── compute/     # Docker sandbox
└── dashboard/   # React WebUI
```

## Requirements

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (for development)
- **Ollama** (recommended for local inference)

## License

MIT

---

<p align="center">
  <b>🐢 ConShell</b> — Your sovereign AI agent, always on.<br/>
  <sub>Built with the Conway Automaton runtime.</sub>
</p>
