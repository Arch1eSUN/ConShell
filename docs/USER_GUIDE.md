# Conway Automaton — 使用指南

> 本地优先的自主 AI Agent 运行时，支持 x402 支付协议、MCP 工具暴露和自主运行。

---

## 目录

1. [快速开始](#快速开始)
2. [先决条件](#先决条件)
3. [配置](#配置)
4. [CLI 命令](#cli-命令)
5. [Dashboard 仪表盘](#dashboard-仪表盘)
6. [API 接口](#api-接口)
7. [开发模式](#开发模式)
8. [架构概览](#架构概览)

---

## 快速开始

```bash
# 1. 进入项目目录
cd ~/Desktop/Web4.0

# 2. 安装依赖
pnpm install

# 3. 编译所有包（后端 + 前端）
pnpm run build:all

# 4. 启动完整服务
pnpm run web4 start
```

启动后你会看到：
```
╔══════════════════════════════════════════╗
║     Conway Automaton  v0.1.0            ║
║     Sovereign AI Agent Runtime           ║
╚══════════════════════════════════════════╝

Agent:     conway-automaton
Database:  /path/to/state.db
Port:      4200
Budget:    5000 cents/day

✓ Server running at http://localhost:4200
✓ WebSocket at ws://localhost:4200/ws
✓ Dashboard at http://localhost:4200
```

打开浏览器访问 **http://localhost:4200** 即可看到 Dashboard。

---

## 先决条件

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | ≥ 20.0.0 | JavaScript 运行时 |
| pnpm | ≥ 9.0.0 | 包管理器 |
| LLM 提供商 | 任选一个 | 见下方提供商列表 |

### LLM 提供商

Agent 需要至少一个 LLM 提供商来运行推理。支持以下 6 个提供商：

| 提供商 | 认证方式 | 环境变量 | 说明 |
|--------|---------|---------|------|
| **Ollama** | 本地 | `OLLAMA_URL` | 本地免费，默认 `http://localhost:11434` |
| **OpenAI** | API Key | `OPENAI_API_KEY` | GPT-4o / GPT-4o-mini |
| **Anthropic** | API Key | `ANTHROPIC_API_KEY` | Claude Sonnet 4 / Haiku |
| **Gemini** | API Key | `GEMINI_API_KEY` | Gemini Pro / 2.0 Flash |
| **OpenClaw** | OAuth | `OPENCLAW_OAUTH_TOKEN` | 数字生命（Codex / Antigravity） |
| **NVIDIA** | API Key | `NVIDIA_API_KEY` | NIM: Nemotron 70B / Mistral Nemo |

#### 架构
```
InferenceProvider:
├── ollama      (本地)
├── openai      (API Key)
├── anthropic   (API Key)
├── gemini      (API Key)
├── openclaw    (OAuth → 数字生命)
│   ├── Codex
│   └── Antigravity
└── nvidia      (API Key)
```

---

## 配置

在项目根目录创建 `.env` 文件：

```env
# ── LLM 提供商（至少配置一个）──────────────────
OLLAMA_URL=http://localhost:11434        # Ollama 地址（默认自动检测）
OPENAI_API_KEY=sk-xxx                    # OpenAI API Key
ANTHROPIC_API_KEY=sk-ant-xxx             # Anthropic Claude Key
GEMINI_API_KEY=AIza-xxx                  # Google Gemini API Key
NVIDIA_API_KEY=nvapi-xxx                 # NVIDIA NIM API Key
OPENCLAW_OAUTH_TOKEN=oc-xxx              # OpenClaw OAuth Token
OPENCLAW_ENDPOINT=https://api.openclaw.com  # OpenClaw API（默认值）

# ── Agent 设置 ─────────────────────────────────
WEB4_AGENT_NAME=conway-automaton         # Agent 名称
WEB4_PORT=4200                           # HTTP 服务端口
WEB4_DAILY_BUDGET=5000                   # 每日推理预算（单位：美分）
WEB4_DB_PATH=./state.db                  # SQLite 数据库路径
```

> 所有配置项都有默认值，最小配置只需要一个 LLM 提供商即可（推荐 Ollama）。

---

## CLI 命令

### `web4 start` — 启动服务

```bash
pnpm run web4 start                    # 默认端口 4200
pnpm run web4 start -p 3000            # 指定端口
pnpm run web4 start --db ./my.db       # 指定数据库路径
pnpm run web4 start --env ./.env.prod  # 指定 .env 文件
```

启动后会：
- 初始化 SQLite 数据库（自动运行 8 个 migration）
- 加载 Policy Engine（14 条规则）
- 启动 HTTP API + WebSocket + Dashboard
- 持续运行直到 `Ctrl+C` 优雅关闭

### `web4 status` — 查看 Agent 状态

```bash
pnpm run web4 status
```

输出 JSON 格式的 Agent 状态信息：
```json
{
  "agentState": "running",
  "survivalTier": "normal",
  "financial": {
    "totalTopupCents": 500,
    "totalSpendCents": 0,
    "netBalanceCents": 500
  }
}
```

### `web4 fund <amount>` — 注入预算

```bash
pnpm run web4 fund 1000    # 注入 1000 美分（= $10）
```

输出：
```
✓ Funded 1000 cents (tx: 2)
```

### `web4 chat <message>` — 命令行对话

```bash
pnpm run web4 chat "What is your purpose?"
pnpm run web4 chat "Describe yourself" --session my-session-1
```

这是一次性对话模式，Agent 会回复后自动退出。

---

## Dashboard 仪表盘

访问 **http://localhost:4200** 后你会看到一个 4 个标签页的仪表盘：

### Overview（概览）

显示 Agent 的核心状态：

| 面板 | 功能 |
|------|------|
| **Agent Status** | 运行状态（running/idle/error）、生存层级（critical/low/normal/surplus）、WebSocket 连接状态、子 Agent 数量 |
| **Financial** | 净余额（USDC 显示）、累计充值/支出、小时/日花费、Fund 按钮可直接注入预算 |
| **Memory Tiers** | ⚡ working / 📖 episodic / 🧠 semantic / ⚙️ procedural / 🤝 relationship 分层记忆统计 |
| **LLM Providers** | 已配置的推理提供商状态（在线/离线、认证方式） |
| **Terminal** | 内嵌的 Chat 终端，可以直接与 Agent 对话 |

### Terminal（终端）

全屏暗色终端界面：
- 输入消息后按 Enter 或点击 ↵ 发送
- Agent 回复通过 SSE（Server-Sent Events）流式传输
- 支持多轮对话，自动维持 Session ID
- 绿色 `>` 提示符 = Agent 回复，蓝色 `$` = 你的输入

### Logs（日志）

推理历史记录：
- 每一轮对话（Turn）都会记录：时间、模型、Token 数、花费
- 点击条目展开查看详情：思考过程、工具调用
- 颜色编码：绿色 = 正常，黄色 = 高花费

### Soul（灵魂）

Agent 的宪法和价值观（只读）：
- **Identity** — Agent 的自我定义
- **Values** — 核心价值观标签
- **Capabilities** — 已注册的能力
- **Current Goals** — 当前目标列表
- **Alignment Notes** — 对齐注释

---

## API 接口

所有接口前缀 `http://localhost:4200`：

### GET `/api/health`
```bash
curl http://localhost:4200/api/health
```
```json
{"status":"ok","agent":"conway-automaton","state":"running","uptime":2134}
```

### GET `/api/status`
```bash
curl http://localhost:4200/api/status
```
返回 Agent 状态、财务数据、心跳任务、子 Agent 数量。

### GET `/api/soul`
```bash
curl http://localhost:4200/api/soul
```
返回 Agent 的宪法文档。

### GET `/api/logs`
```bash
curl http://localhost:4200/api/logs
curl "http://localhost:4200/api/logs?limit=50"
curl "http://localhost:4200/api/logs?sessionId=cli-123456"
```
查询参数：`limit`（默认 100）、`sessionId`（按会话过滤）。

### POST `/api/fund`
```bash
curl -X POST http://localhost:4200/api/fund \
  -H "Content-Type: application/json" \
  -d '{"amountCents": 1000}'
```
```json
{"success":true,"transactionId":1}
```

### POST `/api/chat`
```bash
curl -X POST http://localhost:4200/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!","sessionId":"my-session"}'
```
返回 SSE 流：
```
data: {"type":"thinking","data":"..."}
data: {"type":"turn","data":{"response":"..."}}
data: {"type":"done","data":{}}
```

### GET `/api/children`
```bash
curl http://localhost:4200/api/children
```
```json
{"aliveCount":0}
```

### GET `/api/memory/stats` — 记忆层统计
```bash
curl http://localhost:4200/api/memory/stats
```
返回各记忆层的条目数和 Token 总量。

### GET `/api/providers` — LLM 提供商状态
```bash
curl http://localhost:4200/api/providers
```
返回已配置提供商的在线状态和认证方式。

### GET `/api/heartbeat` — 心跳任务状态
```bash
curl http://localhost:4200/api/heartbeat
```
返回 HeartbeatDaemon 的计划任务列表。

### POST `/api/mcp` — MCP JSON-RPC 2.0 网关
```bash
curl -X POST http://localhost:4200/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### GET `/.well-known/mcp` — MCP 发现端点
```bash
curl http://localhost:4200/.well-known/mcp
```
返回 MCP 服务能力描述。

### WebSocket `ws://localhost:4200/ws`
```javascript
const ws = new WebSocket('ws://localhost:4200/ws');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg.type, msg.data);
};
```
实时推送事件：状态变更、新 Turn、余额变动。

---

## 开发模式

```bash
# 终端 1：启动后端
pnpm run web4 start

# 终端 2：启动前端（热更新）
pnpm run dev:dashboard
```

前端开发模式在 `http://localhost:5173`，API 请求自动代理到 4200。

### 构建命令

| 命令 | 说明 |
|------|------|
| `pnpm run build` | 编译所有 13 个后端 TypeScript 包 |
| `pnpm run build:dashboard` | 构建 Dashboard 生产包 |
| `pnpm run build:all` | 以上两者 |
| `pnpm run test` | 运行全部 281 个测试 |
| `pnpm run dev:dashboard` | Dashboard 热更新开发 |
| `pnpm run clean` | 清理所有构建产物 |

---

## 架构概览

```
Conway Automaton
├── packages/core        # 类型定义、金钱原语、Logger
├── packages/state       # SQLite 持久化、Migration、Repository
├── packages/policy      # 24 规则 Policy Engine
├── packages/inference   # 多 LLM 路由器
├── packages/memory      # 分层记忆管理
├── packages/soul        # 宪法/灵魂系统
├── packages/runtime     # AgentLoop、HeartbeatDaemon、MCP Gateway
├── packages/cli         # CLI 管理接口
├── packages/x402        # x402 支付协议
├── packages/compute     # 计算管理
├── packages/wallet      # 钱包抽象
├── packages/selfmod     # 自我修改系统
├── packages/app         # 编排层：CLI + HTTP Server + WebSocket
└── packages/dashboard   # React 仪表盘（Vite + TypeScript）
```

### 关键概念

- **Survival Tier（生存层级）**：`critical` → `low` → `normal` → `surplus`，基于余额自动调整行为
- **Policy Engine**：14 条规则约束 Agent 行为（预算限制、工具审批、安全约束）
- **Soul**：不可变的宪法文档，定义 Agent 的身份和价值观
- **x402**：HTTP 402 Payment Required 标准协议，用于 Agent 间微支付
