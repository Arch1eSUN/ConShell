# Settings Admin Panel — Design Document

> **Date**: 2026-03-10 | **Status**: Draft | **Author**: Agent

---

## 1. 目标

在 Conway Dashboard 中新增 **Settings** tab，提供：

- **Provider 管理** — 添加/编辑/删除/开关 LLM provider（填 API key、endpoint）
- **模型自动发现** — 保存 API key 后自动检测该 provider 可用的模型
- **路由优先级** — 可视化调整每个 tier × taskType 的模型优先顺序
- **CLIProxyAPI 教程** — 内嵌引导教程，帮用户完成 CLIProxyAPI 配置
- **热切换** — 所有修改实时生效，无需重启 Web4.0

---

## 2. 信息架构

```
Sidebar
├── Overview    （现有）
├── Terminal    （现有）
├── Logs        （现有）
├── Soul        （现有）
└── Settings    ← 新增
    ├── Providers  子区
    ├── Models     子区
    ├── Routing    子区
    └── Guide      子区（CLIProxyAPI 教程）
```

---

## 3. UI 设计

### 3.1 Providers 子区

**卡片列表布局**，每个 provider 一张卡片：

```
┌─────────────────────────────────────────────┐
│ 🟢 cliproxyapi                    [ON/OFF]  │
│ ─────────────────────────────────────────── │
│ Auth Type:  proxy                           │
│ Endpoint:   [http://localhost:8317    ]      │
│ API Key:    [••••••••••••        👁️ ]       │
│ Status:     ✓ 3 models available            │
│                               [Test] [Save] │
└─────────────────────────────────────────────┘
```

**功能**：
- `[+ Add Provider]` 按钮打开新建表单
- **Provider 类型选择**: 下拉菜单选 provider 类型（openai / anthropic / gemini / ollama / cliproxyapi / nvidia / custom）
- **Test 按钮**: 调用后端 `/api/settings/providers/:name/test` 验证连接
- **Save 后自动检测模型**: 后端调用 provider 的模型列表 API，更新 Models 子区
- **Delete 按钮**: 删除 provider 及关联模型（需确认）
- **Toggle 开关**: 即时启用/禁用 provider

### 3.2 Models 子区（选择 → 保存 → 生效）

**核心流程**: 添加 Provider 并保存 API Key → 自动检测到该 provider 的全部模型 → 用户**勾选想用的模型** → 点 Save → 数字生命**只使用被选中的模型**进行推理。

**表格布局**，按 provider 分组：

```
┌──────────────────────────────────────────────────────────┐
│ ☑  Model                  Provider    Cost      Status   │
│ ──────────────────────────────────────────────────────── │
│ cliproxyapi (3 available, 3 selected)                    │
│ ☑  claude-sonnet-4        proxy       $0.00   ✓ active   │
│ ☑  gemini-2.5-pro         proxy       $0.00   ✓ active   │
│ ☑  gpt-4o                 proxy       $0.00   ✓ active   │
│ openai (15 available, 2 selected)                        │
│ ☑  gpt-4o                 apiKey     $12.50   ✓ active   │
│ ☑  gpt-4o-mini            apiKey      $0.60   ✓ active   │
│ ☐  gpt-4-turbo            apiKey     $10.00   — skipped  │
│ ☐  gpt-3.5-turbo          apiKey      $0.50   — skipped  │
│ ollama (2 available, 1 selected)                         │
│ ☑  llama3.2               local       $0.00   ✓ active   │
│ ☐  mistral:7b             local       $0.00   — skipped  │
│                                                          │
│                      [Select All] [Refresh] [Save]       │
└──────────────────────────────────────────────────────────┘
```

**行为规则**：
- **Auto-populated**: 保存 provider API key 后，自动调用模型检测 API 并列出全部可用模型
- **Checkbox 选择**: 用户勾选的模型 = 数字生命可以使用的模型。**未勾选的模型不会出现在路由矩阵中**
- **Save 生效**: 点击 Save 后，`model_registry` 表更新 `available` 字段，router 热重载，该模型立即加入/退出路由
- **Cost 显示**: proxy 类 provider 固定 $0.00，API key 类显示 per-1M-token 价格
- **Refresh Models**: 重新检测所有 provider 的可用模型（不影响已有选择状态）
- **Select All**: 全选当前 provider 的所有模型

> **关键**: 路由矩阵中只包含 `available=1` 的模型。用户取消勾选 = 该模型从所有 tier 的路由中移除。

### 3.3 Routing 子区（自动生成 + 可微调）

**核心逻辑**: 系统根据用户勾选的模型自动生成路由矩阵。数字生命会自动在不同任务之间切换模型：
- **难任务**（reasoning/planning）→ 优先使用能力最强的模型
- **简单任务**（conversation）→ 优先使用最便宜/最快的模型
- **泡菜资源** (cost=0) → 始终优先于付费 API

**矩阵视图**，按 tier 分 tab，带「自动/手动」标记：

```
[✓ Auto-generate]                              [Reset to Auto]

[High] [Normal] [Low] [Critical]

─── Normal Tier ───
┌─────────────────────────────────────────────────────┐
│ reasoning:                              AUTO │
│ 1. 🆓 cliproxyapi:claude-sonnet-4   [↑] [↓]   │
│ 2. 🆓 cliproxyapi:gemini-2.5-pro   [↑] [↓]   │
│ 3. 💰 openai:gpt-4o               [↑] [↓]   │
│ 4. 🆓 ollama:llama3.2             [↑] [↓]   │
├─────────────────────────────────────────────────────┤
│ conversation:                           AUTO │
│ 1. 🆓 cliproxyapi:gemini-2.5-pro   [↑] [↓]   │
│ 2. 🆓 ollama:llama3.2             [↑] [↓]   │
│ 3. 💰 openai:gpt-4o-mini          [↑] [↓]   │
└─────────────────────────────────────────────────────┘
🆓 = 零成本（订阅/本地）  💰 = 按 token 计费
```

**功能**：
- **Auto-generate 开关**：默认开启。系统根据模型 capabilities 和 cost 自动排序
- **↑↓ 手动微调**：用户可手动调整优先级，该组标记从 AUTO 变为 CUSTOM
- **Reset to Auto**：恢复自动生成的默认顺序
- **每组标记**：AUTO（自动生成）或 CUSTOM（手动改过）

---

## 4. 智能路由自动生成算法

当用户勾选模型并保存时，系统自动生成路由矩阵：

### 排序规则（每个 tier × taskType 格子）

```typescript
function autoGenerateRouting(selectedModels: ModelRow[]): RoutingMatrix {
    // 对每个 taskType，筛选有该 capability 的模型
    // 排序规则：
    //   1. 零成本模型 (cost=0) 优先于付费模型
    //   2. 零成本内按 capability 匹配度排序
    //   3. 付费模型按“能力/成本比”排序
    //   4. 本地模型 (ollama) 作为兑底放在最后
}
```

### 分层逻辑

| TaskType | 模型偏好 | 原因 |
|---|---|---|
| `reasoning` | 最强能力模型优先 | 复杂推理需要最好的模型 |
| `coding` | 代码专长模型优先 | sonnet/codex > general |
| `planning` | 强推理模型优先 | 类似 reasoning，需要长上下文 |
| `analysis` | 强推理 + 长上下文优先 | gemini-2.5-pro (1M ctx) 超适合 |
| `conversation` | **最便宜最快的模型优先** | 日常对话不需要大模型 |

### 模型能力分级（自动推断）

```typescript
// 已知模型能力分级表（硬编码）
const MODEL_TIERS: Record<string, 'flagship' | 'strong' | 'fast' | 'local'> = {
    'claude-sonnet-4':      'flagship',
    'claude-opus':          'flagship',
    'gpt-4o':               'flagship',
    'gemini-2.5-pro':       'flagship',
    'claude-3-5-haiku':     'fast',
    'gpt-4o-mini':          'fast',
    'gemini-2.0-flash':     'fast',
    'mistral-nemo-12b':     'fast',
    'llama3.2':             'local',
    'llama3.1-8b':          'local',
};
// 未知模型：按成本推断（贵 = flagship，便宜 = fast）
```

### 结果示例

用户勾选了 5 个模型后，自动生成：

```
reasoning:     proxy:claude-sonnet-4 → proxy:gemini-2.5-pro → api:gpt-4o → local:llama3.2
conversation:  proxy:gemini-2.5-pro → local:llama3.2 → api:gpt-4o-mini
coding:        proxy:claude-sonnet-4 → api:gpt-4o → proxy:gemini-2.5-pro → local:llama3.2
```

数字生命会自动：
- 思考复杂问题时用 claude-sonnet-4（零成本）
- 日常聊天时用 gemini-2.5-pro（零成本，快）
- 所有零成本模型不可用时才走付费 API

### 3.4 Guide 子区（CLIProxyAPI 教程）

**步骤式引导组件**，纯前端 markdown 渲染：

```
📘 CLIProxyAPI Setup Guide

Step 1: 下载 CLIProxyAPI
  git clone https://github.com/router-for-me/CLIProxyAPI.git ~/Desktop/_vendor/CLIProxyAPI

Step 2: 构建
  cd ~/Desktop/_vendor/CLIProxyAPI && go build -o cliproxyapi ./cmd/...

Step 3: 登录 OAuth（选择你有订阅的服务）
  ./cliproxyapi auth codex      ← OpenAI Codex 免费额度
  ./cliproxyapi auth gemini     ← Google Gemini
  ./cliproxyapi auth claude     ← Claude Code

Step 4: 创建配置文件
  [自动生成按钮 → 根据当前 provider 设置生成 config.yaml]

Step 5: 启动
  ./cliproxyapi --config config.yaml

Step 6: 在上方 Providers 区域添加 CLIProxyAPI
  - Endpoint: http://localhost:8317
  - API Key: (config.yaml 中的 api-keys 值)
```

---

## 5. 后端 API

### 新增端点

| Method | Path | 描述 |
|--------|------|------|
| `GET` | `/api/settings/providers` | 列出所有 provider 配置 |
| `POST` | `/api/settings/providers` | 添加新 provider |
| `PUT` | `/api/settings/providers/:name` | 更新 provider |
| `DELETE` | `/api/settings/providers/:name` | 删除 provider |
| `POST` | `/api/settings/providers/:name/test` | 测试连接 |
| `POST` | `/api/settings/providers/:name/discover` | 自动发现模型 |
| `GET` | `/api/settings/models` | 列出所有模型配置 |
| `PUT` | `/api/settings/models/:id` | 更新模型（enable/disable） |
| `GET` | `/api/settings/routing` | 获取路由矩阵 |
| `PUT` | `/api/settings/routing` | 更新路由矩阵 |
| `POST` | `/api/settings/routing/reset` | 重置为默认 |

### 模型自动发现逻辑

```typescript
async function discoverModels(provider: ProviderConfig): Promise<ModelInfo[]> {
    switch (provider.type) {
        case 'openai':
        case 'cliproxyapi':
        case 'nvidia':
            // GET {endpoint}/v1/models → 解析 response.data[].id
            return fetchOpenAIModels(provider.endpoint, provider.apiKey);
        case 'ollama':
            // GET {endpoint}/api/tags → 解析 response.models[].name
            return fetchOllamaModels(provider.endpoint);
        case 'anthropic':
            // Anthropic 无标准 models 端点，返回已知模型列表
            return ANTHROPIC_KNOWN_MODELS;
        case 'gemini':
            // GET generativelanguage.googleapis.com/v1beta/models
            return fetchGeminiModels(provider.apiKey);
    }
}
```

---

## 6. 数据层

### 新增 SQLite 表（Migration v9）

```sql
-- Provider 配置（覆盖 .env 静态配置）
CREATE TABLE IF NOT EXISTS provider_config (
    name       TEXT PRIMARY KEY,
    auth_type  TEXT NOT NULL,
    endpoint   TEXT,
    api_key    TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1,
    priority   INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 路由配置（覆盖静态 ROUTING_MATRIX）
CREATE TABLE IF NOT EXISTS routing_config (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tier       TEXT NOT NULL,
    task_type  TEXT NOT NULL,
    model_id   TEXT NOT NULL,
    priority   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tier, task_type, model_id)
);
CREATE INDEX IF NOT EXISTS idx_routing_tier_task ON routing_config(tier, task_type, priority);
```

**注意**: 已有的 `model_registry` 表（v6 迁移）可直接复用，包含 `id`, `provider`, `name`, `input_cost_micro`, `output_cost_micro`, `max_tokens`, `capabilities_json`, `available`, `updated_at`。

### 配置优先级（高到低）

```
1. provider_config / routing_config（SQLite，来自 Settings UI）
2. .env 环境变量（静态配置）
3. 硬编码默认值（seed.ts / routing.ts）
```

---

## 7. 热切换机制

```
前端 Save Models → POST /api/settings/models
  → 后端更新 model_registry.available
  → 如果 auto-generate 开启:
    → autoGenerateRouting(已选模型)
    → 写入 routing_config 表
  → router.reloadConfig()
    → 重新从 SQLite 读取 provider + model + routing
    → 重建 adapters Map 和 routing matrix
  → WebSocket 广播 { type: 'config-updated' }
  → 前端自动刷新
```

**关键**: `DefaultInferenceRouter` 新增 `reloadConfig()` 方法。

---

## 8. 文件变更清单

### 后端

| 包 | 文件 | 变更 |
|----|------|------|
| state | `migrations/definitions.ts` | 新增 v9 迁移（provider_config + routing_config） |
| state | `repositories/` | 新增 `ProviderConfigRepo` + `RoutingConfigRepo` |
| inference | `router.ts` | 新增 `reloadConfig()` 方法 |
| inference | `auto-routing.ts` | **新建** — 智能路由自动生成算法 |
| app | `server.ts` | 新增 `/api/settings/*` 路由组 |
| app | `services/model-discovery.ts` | **新建** — 模型自动发现逻辑 |

### 前端

| 文件 | 变更 |
|------|------|
| `Layout.tsx` | Tab 类型增加 `'settings'`，TABS 数组增加 Settings 项 |
| `App.tsx` | 新增 `{activeTab === 'settings' && <SettingsPage />}` |
| `components/SettingsPage.tsx` | 新建 — 主容器（sub-tab 切换） |
| `components/settings/ProvidersSection.tsx` | 新建 — Provider 管理 UI |
| `components/settings/ModelsSection.tsx` | 新建 — 模型表格 UI |
| `components/settings/RoutingSection.tsx` | 新建 — 路由矩阵 UI |
| `components/settings/GuideSection.tsx` | 新建 — CLIProxyAPI 教程 |
| `components/ProviderPanel.tsx` | 增加 AUTH_ICONS['proxy'] 映射 |
| `styles/settings.css` | 新建 — Settings 页面样式 |
| `lib/hooks.ts` | 新增 settings CRUD hooks |

---

## 9. 验证计划

### 自动化测试
- `pnpm -r --filter '!@web4-agent/dashboard' run build` — 全包编译通过
- 后端 API 单元测试（mock SQLite）

### 手动验证
1. 启动 Web4.0 → Settings tab 可见
2. 添加 OpenAI provider（填 API key）→ 保存后自动发现 gpt-4o / gpt-4o-mini
3. 添加 CLIProxyAPI provider → Test 连接 → 自动发现模型
4. 禁用一个模型 → 路由矩阵中该模型被排除
5. 调整路由优先级 → 发送聊天消息 → 确认走了新优先级的模型
6. 勾选 3 个模型 + 开启 Auto-generate → 确认路由矩阵自动按能力/成本排序
7. 重启 Web4.0 → Settings 中的配置仍然存在并生效

---

## 10. 工作量预估

| 组件 | 预估 |
|------|------|
| v9 迁移 + 仓库层 | 小 |
| 模型自动发现服务 | 中 |
| 智能路由自动生成算法 | 中 |
| Settings API 路由 | 中 |
| 热切换机制 | 中 |
| Settings 前端 4 个子区 | 大 |
| CSS 样式 | 中 |
| 总计 | **~1000-1500 行新代码** |
