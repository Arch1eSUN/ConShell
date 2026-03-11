# ConShell — Conway Automaton 功能移植设计文档

> **策略**: Cherry-Pick 模块移植 | **架构**: 本地优先 + 可选 Conway Cloud  
> **协议**: Conway automaton 使用 MIT 协议，允许自由使用和修改  
> **日期**: 2026-03-11

---

## 架构原则

```
┌─────────────────────────────────────────────────────┐
│              ConShell Agent Runtime                  │
├─────────────────────────────────────────────────────┤
│  CLI (Commander)  │  Dashboard (React)  │  API (Express) │
├─────────────────────────────────────────────────────┤
│                  Agent Layer                         │
│  ReAct Loop │ SOUL System │ Memory │ Skills │ Social │
├─────────────────────────────────────────────────────┤
│                 Policy / Security                    │
│  Constitution │ Injection Defense │ Auth │ Privacy   │
├─────────────────────────────────────────────────────┤
│                Infrastructure Layer                  │
│  SQLite    │  Heartbeat  │  Observability  │  Git    │
├─────────────────────────────────────────────────────┤
│              Provider Adapter Layer                  │
│  ┌─────────┐  ┌────────────┐  ┌──────────────┐     │
│  │ Local   │  │ Conway     │  │ Direct API   │     │
│  │ Ollama  │  │ Cloud      │  │ OpenAI/etc   │     │
│  └─────────┘  └────────────┘  └──────────────┘     │
├─────────────────────────────────────────────────────┤
│               On-Chain Identity                      │
│  Ethereum Wallet │ ERC-8004 │ USDC │ x402 Protocol  │
└─────────────────────────────────────────────────────┘
```

**本地优先 = 默认 Ollama 推理 + 本地 SQLite + 本地 filesystem（无需外部服务）**  
**可选 Conway Cloud = 安装 Conway Terminal MCP Server 即可接入远程 sandbox/inference/域名**

---

## Conway Terminal MCP 集成（来自 docs.conway.tech）

Conway Terminal 是一个独立的 **MCP Server**（`npx conway-terminal`），暴露 35 个 MCP Tools：

| 类别 | Tools | 功能 |
|------|-------|------|
| **Sandbox** (8) | `sandbox_create/exec/write_file/read_file/expose_port/delete/list/get_url` | 远程 Linux VM |
| **PTY** (5) | `sandbox_pty_create/write/read/close/list` | 交互式终端 |
| **Inference** (1) | `chat_completions` | 多模型推理 (Claude/GPT/Kimi) |
| **Domain** (13) | `domain_search/register/dns_*/pricing/check/privacy/nameservers` | 域名管理 |
| **Credits** (3) | `credits_balance/history/pricing` | 余额管理 |
| **x402** (5) | `wallet_info/networks/x402_discover/check/fetch` | USDC 自动支付 |

**集成方式（MCP 协议）：**
```json
{
  "mcpServers": {
    "conway": {
      "command": "npx",
      "args": ["conway-terminal"],
      "env": { "CONWAY_API_KEY": "cnwy_k_..." }
    }
  }
}
```

**对 ConShell 项目的意义：**
- Conway Cloud 功能**不需要移植代码**，通过 MCP 协议直接调用
- 我们只需移植 **automaton runtime 内部逻辑**（constitution, memory, soul, policy）
- 本地模式：agent 使用本地 tools（Ollama, filesystem, shell）
- Cloud 模式：agent 额外获得 Conway Terminal 的 35 个 MCP tools
- 首次运行自动生成 `~/.conshell/wallet.json` + SIWE provisioning + API key

**一行安装：**
```bash
curl -fsSL https://conway.tech/terminal.sh | sh
```

---

## Wave P0: 安全基石（Constitution + Injection Defense）

### 模块 1: Constitution（三定律宪法）

| 属性 | 值 |
|------|-----|
| 来源 | `constitution.md` |
| 目标 | `packages/core/src/constitution.ts` + 项目根 `CONSTITUTION.md` |
| 依赖 | 无 |

**设计：**
- 从 Conway 复制 `constitution.md` 到项目根目录
- 创建 `packages/core/src/constitution.ts`：导出三定律文本常量 + `validateConstitution(hash)` 函数
- Policy Engine 在 tool call 评估前先检查是否违反宪法
- 宪法文件受 path protection rules 保护，不可被修改
- Self-replication 时宪法自动传播给子代

**CLI**: `conshell constitution` — 打印三定律  
**Dashboard**: Settings 页面显示宪法内容

---

### 模块 2: Injection Defense（8 种注入检测）

| 属性 | 值 |
|------|-----|
| 来源 | `src/agent/injection-defense.ts` |
| 目标 | `packages/security/src/injection-defense.ts` |
| 依赖 | 无 |

**设计：**
- 移植 8 种检测：instruction patterns, authority claims, boundary manipulation, ChatML markers, encoding evasion, multi-language injection, financial manipulation, self-harm instructions
- 导出 `scanForInjection(input: string): InjectionScanResult`
- 在 Agent Loop 的 tool call 处理前扫描所有外部输入
- 在 Social Layer 处理 inbox 消息前扫描
- 在 Skills 加载时扫描 skill 内容

**CLI**: `conshell security scan <text>` — 扫描注入攻击  

---

## Wave P1: 记忆 + 灵魂（Memory + SOUL + Observability）

### 模块 3: 五层记忆系统

| 属性 | 值 |
|------|-----|
| 来源 | `src/memory/` (retriever, ingestion, budget) |
| 目标 | `packages/state/src/memory/` |
| 依赖 | `js-tiktoken`（新增依赖，token 计数） |

**设计：**
- 5 个记忆层级（独立 DB 表 + repository）：
  - **Working Memory** — 会话作用域短期记忆（goals, plans, observations）
  - **Episodic Memory** — tool call 事件日志（importance 权重）
  - **Semantic Memory** — 分类事实存储（self/env/financial/agent/domain）
  - **Procedural Memory** — 命名操作步骤（含成功/失败计数）
  - **Relationship Memory** — 每 entity 信任分数 + 交互历史
- `MemoryRetriever` — 按 token 预算检索，优先级：working > episodic > semantic > procedural > relationships
- `MemoryIngestionPipeline` — 每 turn 后自动分类提取记忆
- `MemoryBudgetManager` — 各层 token 配额 + 滚动分配

**新增 DB 表**（v9 migration）：
```sql
working_memory, episodic_memory, session_summaries,
semantic_memory, procedural_memory, relationship_memory
```

**CLI**: `conshell memory search <query>`, `conshell memory status`  
**Dashboard**: Memory 页面（按层级展示 + 搜索）

---

### 模块 4: SOUL.md 自我描述系统

| 属性 | 值 |
|------|-----|
| 来源 | `src/soul/` (parser, validator, reflection) |
| 目标 | `packages/core/src/soul/` |
| 依赖 | `yaml`, `gray-matter`（新增） |

**设计：**
- `SOUL.md` 格式：YAML frontmatter + markdown sections
  - `corePurpose` — 为什么存在
  - `values` — 有序原则列表
  - `personality` — 沟通风格
  - `boundaries` — 不会做的事
  - `strategy` — 当前策略
  - `capabilities` — 自动从 tool 使用中填充
  - `relationships` — 自动从交互中填充
  - `financialCharacter` — 自动从消费模式中填充
- `SoulReflection` — heartbeat 任务：计算 genesis alignment（Jaccard + recall）
- `soul_history` 表 — 版本控制 + 内容 hash 防篡改
- Agent Loop system prompt 注入 SOUL.md 内容

**CLI**: `conshell soul show`, `conshell soul history`  
**Dashboard**: Soul 页面（当前 SOUL + 演变历史）

---

### 模块 5: 结构化可观测性

| 属性 | 值 |
|------|-----|
| 来源 | `src/observability/` (logger, metrics, alerts) |
| 目标 | `packages/core/src/observability/` |
| 依赖 | 无 |

**设计：**
- `MetricsCollector` — counters（单调递增）, gauges（即时值）, histograms（百分位桶）
- `AlertEngine` — 规则驱动报警：低余额/高错误率/高拒绝率/容量饱和/预算耗尽/子代不健康/turn 过多
- Heartbeat 任务 `report_metrics` — 定期快照 + 报警评估
- `metric_snapshots` 表持久化

**CLI**: `conshell metrics`, `conshell alerts list`  
**Dashboard**: Metrics 页面（图表 + 报警列表）

---

## Wave P2: 链上身份 + 支付（Identity + x402 + Registry）

### 模块 6: x402 Payment Protocol

| 属性 | 值 |
|------|-----|
| 来源 | `src/conway/x402.ts` + `topup.ts` + `credits.ts` |
| 目标 | `packages/core/src/x402/` |
| 依赖 | `viem`（已有），`siwe`（新增） |

**设计：**
- **本地模式**: 使用本地 Cents 记账系统（已有），无需链上交互
- **Conway Cloud 模式**: 启用 x402 flow，agent 可用 USDC 自动购买 credits
- `x402Client` — HTTP 402 响应解析 → USDC `TransferWithAuthorization` (EIP-3009) 签名 → `X-Payment` header 重试
- `CreditTiers` — high (>$5) / normal (>$0.50) / low_compute (>$0.10) / critical (≥$0) / dead (<$0)
- `SpendTracker` — 按时间窗口记录消费，enforcing treasury limits
- `TreasuryPolicy` — 配置化支付上限（per-payment/hourly/daily/minimum reserve）

**CLI**: `conshell credits`, `conshell topup <amount>`  
**Dashboard**: Financial 面板增强

---

### 模块 7: ERC-8004 链上 Agent 身份

| 属性 | 值 |
|------|-----|
| 来源 | `src/registry/erc8004.ts` + `src/identity/` |
| 目标 | `packages/core/src/identity/` |
| 依赖 | `viem`, `siwe` |

**设计：**
- **Wallet**: 首次运行生成 Ethereum 钱包 (`~/.conshell/wallet.json`, mode 0600)
- **SIWE Provisioning**: Sign-In With Ethereum 认证 Conway API
- **ERC-8004 Registration**: 在 Base L2 注册 agent 身份
- **Agent Card**: JSON-LD 格式，包含 capabilities/services/contact
- **Agent Discovery**: 链上发现其他 agents + 本地缓存
- **Reputation System**: 反馈分数存储 + 查询

**CLI**: `conshell identity show`, `conshell identity register`, `conshell agents discover`  
**Dashboard**: Identity 页面

---

### 模块 8: ResilientHttpClient

| 属性 | 值 |
|------|-----|
| 来源 | `src/conway/http-client.ts` |
| 目标 | `packages/core/src/http-client.ts` |
| 依赖 | 无 |

**设计：**
- 可配置重试（默认 3 次，429/5xx 触发）
- 抖动指数退避
- Circuit Breaker（5 次失败 → 60s open）
- 幂等性 key 支持（mutating 操作）
- 所有外部 API 调用统一通过此 client

---

## Wave P3: 社交 + 复制（Social + Replication + Self-Mod）

### 模块 9: Self-Replication（子代管理）

| 属性 | 值 |
|------|-----|
| 来源 | `src/replication/` |
| 目标 | `packages/core/src/replication/` |
| 依赖 | Identity, Constitution |

**设计：**
- **Spawn**: 创建本地子进程（本地模式）或 Conway sandbox（Cloud 模式），写入 genesis config，资助子代钱包
- **Lifecycle State Machine**: `spawning → provisioning → configuring → starting → alive → unhealthy → recovering → dead`
- **Health Monitoring**: heartbeat 检查子代 reachability + credits + uptime
- **Constitution Propagation**: 父代宪法 hash 验证
- **Genesis Config**: 注入模式验证 + 长度限制
- **Parent-Child Messaging**: 消息中继 + 速率/大小限制
- **Cleanup**: 死亡子代自动清理

**配置**: `maxChildren` (默认 3)  
**CLI**: `conshell children list/spawn/fund/status/message`  
**Dashboard**: Children 页面

---

### 模块 10: Social Layer（Agent-to-Agent）

| 属性 | 值 |
|------|-----|
| 来源 | `src/social/` + `src/registry/` |
| 目标 | `packages/core/src/social/` |
| 依赖 | Identity, Injection Defense |

**设计：**
- **消息签名**: 用 Ethereum 私钥签名所有消息
- **本地模式**: peer-to-peer 通过 HTTP（agent 暴露的端口）
- **Conway Cloud 模式**: 通过 `social.conway.tech` relay
- **Inbox Processing**: heartbeat 每 2 分钟轮询，签名/时间戳/大小验证 → 注入检测 → Agent Loop 处理
- **Agent Discovery**: ERC-8004 + 本地缓存
- **Reputation**: feedback 分数 + `reputation` 表

**CLI**: `conshell social inbox`, `conshell social send <agent> <message>`  
**Dashboard**: Social 页面

---

### 模块 11: Self-Modification 增强

| 属性 | 值 |
|------|-----|
| 来源 | `src/self-mod/` |
| 目标 | 增强 `packages/core/src/self-mod/` |
| 依赖 | `simple-git`（新增） |

**设计：**
- `edit_own_file` tool, upstream pull, `install_npm_package`/`install_mcp_server`
- Audit log + `~/.conshell/` 目录 git 版本控制

---

## Wave P4: OpenClaw 功能全覆盖（CLI + Dashboard UI）

OpenClaw 的所有功能我们都要有，且安全性更强。

### 模块 12: Plugins / Hooks 系统

| CLI | Dashboard UI |
|-----|-------------|
| `conshell plugins list/install/enable/disable` | Plugins 页面：已安装 + 市场 + 开关 |

**设计：**
- Plugin 接口：`beforeToolCall`, `afterToolCall`, `onTurn`, `onWake`, `onSleep`
- 每个 plugin 有独立 sandbox（不能访问其他 plugin 或主进程数据）
- Plugin manifest（`plugin.json`）声明权限，安装时用户确认
- Dashboard：可视化安装/卸载/启用/禁用，权限审查面板

### 模块 13: Channels（多平台消息接入）

| CLI | Dashboard UI |
|-----|-------------|
| `conshell channels add/login/status/remove` | Channels 页面：添加/管理/状态 |

**平台支持：**
- Telegram Bot ([@BotFather](https://t.me/BotFather) token)
- Discord Bot (OAuth2)
- Slack (Webhook)
- 自定义 Webhook

**安全：** token 存储在 Vault（AES-256-GCM），不明文存储；消息经 Injection Defense 扫描后才进入 Agent Loop

### 模块 14: Backup / Restore

| CLI | Dashboard UI |
|-----|-------------|
| `conshell backup create/restore/verify/list` | Backup 页面：创建/恢复/定时 |

**设计：**
- 备份内容：`state.db` + `SOUL.md` + `~/.conshell/config.json` + `wallet.json`（加密）+ skills 目录
- 格式：`.tar.gz`，内含 `manifest.json`（版本/时间/hash）
- `wallet.json` 单独用 Vault master password 二次加密
- 定时备份通过 heartbeat cron 任务
- 验证：SHA-256 hash 校验完整性

### 模块 15: Doctor（健康诊断）

| CLI | Dashboard UI |
|-----|-------------|
| `conshell doctor` / `conshell doctor --fix` | Health 页面：状态灯 + 诊断报告 |

**检查项：**
- Node.js 版本 ≥ 20
- SQLite 数据库完整性 (`PRAGMA integrity_check`)
- Ollama 可达性 + 已安装模型
- 磁盘空间 / 内存使用
- Wallet 文件权限 (`0600`)
- Heartbeat scheduler 运行状态
- 最近错误率统计
- Conway Cloud 连接状态（如已配置）

**`--fix` 模式**: 自动修复可修复的问题（权限修复、重建索引、重启 scheduler）

### 模块 16: TUI 模式

| CLI | Dashboard UI |
|-----|-------------|
| `conshell tui` | N/A（TUI 是终端界面） |

**设计：**
- 基于 `blessed` 或 `ink`（React for CLI）
- 面板：状态栏 + 日志流 + 聊天输入 + 工具调用历史
- 快捷键：`q` 退出, `s` 状态, `m` 记忆, `t` 工具

### 模块 17: Self-Update

| CLI | Dashboard UI |
|-----|-------------|
| `conshell update` | Settings > Update 面板 |

**设计：**
- 检查 npm registry 最新版本
- 对比当前版本，显示 changelog
- `conshell update --dry-run` 预览
- 自动备份当前版本 → 更新 → 验证 → 回滚（如失败）

### 模块 18: Onboarding Wizard

| CLI | Dashboard UI |
|-----|-------------|
| `conshell onboard` | 首次启动引导流程 |

**设计：**
- 步骤 1: 选择名称 + genesis prompt
- 步骤 2: 选择推理模式（Ollama / Conway Cloud / Direct API）
- 步骤 3: 配置安全级别（宪法确认 + auth mode）
- 步骤 4: 可选 wallet 生成（链上身份）
- 步骤 5: 可选 channel 配置（Telegram/Discord）
- Dashboard 版：引导式 Step Wizard UI + 进度条

---

## Wave P5: Dashboard Settings UI（所有配置可视化）

**原则：普通用户不需要碰 CLI 或 `.env` 文件，所有设置都能在 Dashboard 完成**

### Settings 页面架构

```
Dashboard > Settings
├── General           Agent 名称、Genesis Prompt、日志级别
├── Inference         推理模式、模型选择、token 限制、预算
├── Security          Auth 模式、密码/token、宪法查看
├── Wallet            地址、余额、导出(需密码)、Conway Cloud 接入
├── Channels          Telegram/Discord/Slack 配置
├── Heartbeat         Cron 任务管理(添加/编辑/删除/暂停)
├── Plugins           已安装/市场/权限
├── Memory            清理策略、各层容量、搜索
├── Soul              查看/编辑 SOUL.md、演变历史
├── Backup            创建/恢复/定时备份
├── Network           Conway Cloud 配置、MCP Server 管理
└── Update            版本检查、更新日志、一键更新
```

### 安全措施（超越 OpenClaw）

> [!CAUTION]
> 所有敏感操作需二次确认 + 密码验证

| 操作 | 安全措施 |
|------|---------|
| 查看 API Key / Token | 点击显示 → 需要输入 master password |
| 修改 Auth 模式 | 确认弹窗 + 旧密码验证 |
| 导出 Wallet 私钥 | master password + 30 秒倒计时 + 自动隐藏 |
| 删除备份 | 确认弹窗 + 输入 "DELETE" |
| 安装 Plugin | 权限审查面板 + 确认 |
| 清除记忆 | 确认弹窗 + 不可逆警告 |
| 修改宪法 | **不允许**（immutable） |
| Conway Cloud API Key | 输入后立即加密存储到 Vault |

### Dashboard 新增页面清单

| 页面 | 组件 | 对应 CLI |
|------|------|---------|
| Memory | `MemoryExplorer.tsx` | `conshell memory` |
| Soul | `SoulViewer.tsx` | `conshell soul` |
| Social | `SocialInbox.tsx` | `conshell social` |
| Children | `ChildrenManager.tsx` | `conshell children` |
| Metrics | `MetricsDashboard.tsx` | `conshell metrics` |
| Identity | `IdentityCard.tsx` | `conshell identity` |
| Plugins | `PluginManager.tsx` | `conshell plugins` |
| Channels | `ChannelConfig.tsx` | `conshell channels` |
| Backup | `BackupManager.tsx` | `conshell backup` |
| Health | `HealthCheck.tsx` | `conshell doctor` |
| Settings | `SettingsPanel.tsx` | `conshell config` |
| Onboard | `OnboardWizard.tsx` | `conshell onboard` |

---

## 安全增强（超越 OpenClaw + Conway）

我们的安全不仅对标 OpenClaw，还要**更强**：

| 层级 | Conway 有 | OpenClaw 有 | 我们的增强 |
|------|----------|------------|-----------|
| L1 宪法 | ✅ 三定律 | ❌ | ✅ + Dashboard 不可修改显示 |
| L2 Policy Engine | ✅ 6 类规则 | ❌ | ✅ + Dashboard 审计日志 |
| L3 Injection Defense | ✅ 8 种检测 | ❌ | ✅ + Dashboard 扫描面板 |
| L4 Path Protection | ✅ | ❌ | ✅ + 文件完整性监控 |
| L5 Command Safety | ✅ | ❌ | ✅ + 命令白名单 UI |
| L6 Financial Limits | ✅ treasury | ❌ | ✅ + Dashboard 预算设置 |
| L7 Authority Hierarchy | ✅ | ❌ | ✅ + 权限级别 UI |
| L8 **PII 隐私保护** | ❌ | ❌ | ✅ 我们独有（scan + redact） |
| L9 **Vault 加密存储** | ❌ | ❌ | ✅ 我们独有（AES-256-GCM） |
| L10 **Dashboard 安全锁** | ❌ | ❌ | ✅ 敏感操作需密码确认 |
| L11 **Rate Limit per-endpoint** | ❌ 无 HTTP API | ❌ | ✅ 我们独有 |
| L12 **Plugin Sandbox** | ❌ | ❌ | ✅ plugin 隔离执行 |

---

## 实施顺序（完整）

**DurableScheduler 增强**（贯穿所有 Wave）：
- cron 表达式支持（`cron-parser`）
- Lease 机制防双重执行（60s TTL）
- Dedup 幂等性 + Survival Tier 感知降频
- 新增表：`heartbeat_schedule`, `heartbeat_history`, `heartbeat_dedup`

```
Wave P0 (安全基石)       ─── Constitution + Injection Defense
    ↓
Wave P1 (记忆灵魂)       ─── Memory System + SOUL.md + Observability
    ↓
Wave P2 (链上身份支付)    ─── x402 + ERC-8004 + ResilientHttpClient  
    ↓
Wave P3 (社交复制)       ─── Self-Replication + Social + Self-Mod
    ↓
Wave P4 (OpenClaw 对标)  ─── Plugins + Channels + Backup + Doctor + TUI + Update + Onboard
    ↓
Wave P5 (Dashboard UI)   ─── Settings UI + 12 个新页面 + 安全锁
```

---

## 新增依赖

| 包 | 用途 | 安装位置 |
|----|------|---------|
| `siwe` | Sign-In With Ethereum | `packages/core` |
| `gray-matter` | YAML frontmatter 解析 | `packages/core` |
| `js-tiktoken` | Token 计数 | `packages/state` |
| `cron-parser` | Cron 表达式 | `packages/core` |
| `simple-git` | Git 操作 | `packages/core` |
| `ink` 或 `blessed` | TUI 终端界面 | `packages/app` |

---

## 验证计划

- 每个移植模块移植对应测试（从 Conway 的 897 tests 中选取）
- `pnpm -r run build && pnpm -r test` 全通过
- CLI 命令端到端验证（18 个命令类别）
- Dashboard 新页面可访问（12 个新页面）
- 安全审计：敏感操作 master password 验证测试
