# 🐚 ConShell

**Sovereign AI Agent Runtime** — a local-first, privacy-preserving AI agent that runs entirely on your machine.

[![Node.js](https://img.shields.io/badge/Node.js-≥20-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://typescriptlang.org)

## What is ConShell?

ConShell is a sovereign AI agent runtime built on the Conway Automaton architecture. It provides:

- 🧠 **Multi-model inference** — Ollama (local), OpenAI, Anthropic, Google, DeepSeek
- 🛡️ **Constitution-enforced safety** — Three Laws of Sovereign AI
- 💳 **x402 payments** — Machine-to-machine micropayments
- 🔌 **MCP gateway** — Expose tools to external LLMs
- 📡 **Multi-channel** — Discord, Telegram, Slack, Matrix, Email
- 🧬 **Self-modification** — Supervised code evolution with git safety
- 🌐 **WebUI dashboard** — Rich browser-based management interface
- 🐚 **Interactive REPL** — Chat directly in your terminal

## Quick Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Arch1eSUN/WEB4.0/main/scripts/install.sh)
```

Or manually:

```bash
git clone https://github.com/Arch1eSUN/WEB4.0.git
cd WEB4.0
pnpm install && pnpm build
cd packages/app && npm link
```

## Getting Started

```bash
# First-time setup wizard (interactive)
conshell onboard

# Start interactive REPL
conshell

# Start server + WebUI
conshell start

# Start as background daemon
conshell start --daemon

# Health diagnostics
conshell doctor

# Edit configuration
conshell configure

# Self-update from GitHub
conshell update
```

## Commands

| Command | Description |
|---|---|
| `conshell` | Interactive REPL chat mode |
| `conshell onboard` | First-time setup wizard (6 steps) |
| `conshell start` | Start agent + HTTP/WS server |
| `conshell start -d` | Start as background daemon |
| `conshell stop` | Stop running agent |
| `conshell status` | Show agent status |
| `conshell doctor` | Run health diagnostics |
| `conshell configure` | Interactive config editor |
| `conshell update` | Pull latest code and rebuild |
| `conshell gateway run` | Start MCP gateway |
| `conshell gateway status` | Check gateway health |
| `conshell ui` | Open WebUI dashboard |
| `conshell chat` | Send a single message |
| `conshell soul show` | Display agent soul document |
| `conshell memory stats` | Show memory statistics |
| `conshell skills list` | List installed skills |
| `conshell wallet show` | Display wallet info |

## Architecture

```
packages/
├── app/         # CLI entry point (conshell binary)
├── cli/         # Onboard wizard, doctor, admin
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
├── x402/        # Payment protocol
├── compute/     # Docker sandbox
└── dashboard/   # React WebUI
```

## Configuration

Config is stored at `~/.conshell/config.json`. Key settings:

```bash
# Environment variables
OLLAMA_URL=http://localhost:11434
CONSHELL_AUTH_MODE=token          # none | token | password
CONSHELL_AUTH_SECRET=your-secret
PORT=4200
LOG_LEVEL=info
DAILY_BUDGET_CENTS=5000
```

## Requirements

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- **Ollama** (recommended for local inference)
- **C++ build tools** (for better-sqlite3)
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential`

## License

MIT
