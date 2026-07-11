# popular-radar 架构详解

> 本文档详细梳理 popular-radar 项目的完整架构，涵盖每个功能模块的实现细节、核心逻辑与模块联动关系。
> 每个功能先以一句话总结，再分点展开具体功能、实现方式和模块联动。
> 项目架构移植自 agents-radar，但数据采集层和报告类型完全针对短视频/内容平台热点重写；
> LLM 后端已接入**火山方舟 Ark（doubao-seed-2.0-pro，思考模式默认关闭）**，通知渠道已打通到**飞书**（日报/周报/月报全覆盖）。
>
> **2026-07 重要变更**：① 全面移除英文报告与英文界面（数据源均为中文平台，砍掉约一半 LLM token 消耗）；
> ② 三层防线杜绝思考模型的推理过程泄漏进报告（volcano 请求关闭 thinking、删除 reasoning_content 回退、callLlm 统一剥离 think 标签）。

---

## 目录

- [一、项目总览](#一项目总览)
- [二、核心编排引擎](#二核心编排引擎-srcindexts)
- [三、配置系统](#三配置系统-srcconfigts--configyml)
- [四、数据采集层](#四数据采集层-srchotts)
- [五、LLM Provider 抽象层](#五llm-provider-抽象层-srcproviders)
- [六、LLM 调用基础设施](#六llm-调用基础设施-srcreportts)
- [七、Prompt 构建层](#七prompt-构建层-srcprompts-datats)
- [八、报告生成层](#八报告生成层-srcreport-saversts)
- [九、文案集中管理](#九文案集中管理-srci18nts)
- [十、周报月报汇总系统](#十周报月报汇总系统-srcrollupts)
- [十一、通知推送系统](#十一通知推送系统)
- [十二、Web UI 与 RSS](#十二web-ui-与-rss-srcgenerate-manifestts--indexhtml)
- [十三、GitHub Actions 工作流](#十三github-actions-工作流)
- [十四、辅助工具模块](#十四辅助工具模块)
- [十五、部署与运维](#十五部署与运维-deploymd--环境变量)
- [十六、项目文件全景](#十六项目文件全景)
- [十七、与 agents-radar 的差异对照](#十七与-agents-radar-的差异对照)
- [十八、关键设计约定总结](#十八关键设计约定总结)

---

## 一、项目总览

**popular-radar 是一个短视频/内容平台热点日报自动生成系统，通过 GitHub Actions 每天定时从抖音、B站等平台聚合热搜词和热门视频，经 LLM（默认火山方舟 doubao-seed-2.0-pro，思考模式关闭）分析后生成中文日报，以 GitHub Issues + Markdown 文件 + Web UI + RSS + 飞书/Telegram 通知等多种方式发布。**

### 核心功能

- **每日日报**：从抖音热搜、B站热门视频、B站热门音乐 3 类数据源采集数据，LLM 生成 3 份中文报告（数据源均为中文平台，不生成英文报告以节省 token）
- **周报月报**：基于日报自动汇总生成周报（每周一）和月报（每月1日）
- **多渠道分发**：GitHub Issues、飞书（Feishu）、Telegram、Web UI、RSS，日报/周报/月报三条流水线均已接入飞书与 Telegram
- **配置驱动**：通过 `config.yml` 控制跟踪的平台/分区列表，新增平台只需加一行配置
- **多 LLM 后端**：6 个 provider（anthropic / openai / github-copilot / openrouter / deepseek / **volcano 火山方舟**），通过 `LLM_PROVIDER` 环境变量切换，当前默认 `volcano`
- **思考过程零泄漏**：思考模型的推理文本绝不进入报告（源头关闭 + 删除回退 + 输出清洗三层防线）

### 技术栈

- **语言**：TypeScript（ESM，`"type": "module"`），Node 22，tsx 运行时（tsconfig：`module: ESNext` / `moduleResolution: bundler` / `allowImportingTsExtensions` / `strict` / `noEmit`）
- **包管理**：pnpm 9.15.9
- **LLM SDK**：`@anthropic-ai/sdk` + `openai`（OpenAI SDK 同时服务 openai/copilot/openrouter/deepseek/volcano）
- **其它依赖**：`js-yaml`（配置解析）、`marked`（Markdown→HTML，用于 RSS 与 Web UI）、`dotenv`
- **测试**：Vitest 4
- **代码质量**：ESLint 9 + Prettier 3 + Husky 9（pre-commit hook）
- **部署**：GitHub Actions + GitHub Pages
- **数据源**：imsyy/DailyHotApi 自部署实例（Vercel/Cloudflare），默认回退到公共演示实例

### 与 agents-radar 的关系

popular-radar **移植自 agents-radar** 的架构和约 70% 的代码（LLM provider 抽象层、调用基础设施、rollup、manifest、通知推送模块），但：

- 数据采集层从 9 个独立 fetcher 简化为 **1 个通用客户端**（`hot.ts`）
- 报告类型从 9 种 AI 报告替换为 **3 种短视频热点报告**
- 删除了 CLI/OpenClaw 复杂报告、推荐系统、MCP Server、社媒生成等非核心模块
- **双语系统整体移除**：agents-radar 为中英双语，popular-radar 为纯中文（数据源均为中文平台）
- **新增 `volcano` provider**（火山方舟 Ark，接入 doubao-seed 系列模型，thinking 默认关闭）
- 完全独立部署，与 agents-radar 互不干扰

### 三阶段流水线

整个日报生成流水线在 `src/index.ts` 的 `main()` 函数中编排，分为 3 个阶段：

1. **Phase 1 - 数据采集**（`fetchAllHotData`）：3 类数据源并行 fetch，每个都 `.catch()` 容错
2. **Phase 2 - 报告生成**：3 份中文报告并行生成（LLM 摘要 + 文件保存 + Issue 创建）
3. **Phase 3 - Highlights 生成**：从报告中提取要点，写入 `highlights.json`（扁平 `ReportHighlights` 结构），供飞书/Telegram 通知使用

> 相比 agents-radar 的 6 阶段，popular-radar 精简为 3 阶段：无独立的交叉对比阶段，无跨平台对比（数据源结构差异大），highlights 直接在主流程末尾生成。

---

## 二、核心编排引擎 (`src/index.ts`)

**`index.ts` 是整个日报流水线的编排中枢，定义了 3 个阶段和 `main()` 入口，协调数据采集、报告生成、highlights 提取的完整流程。**

### 具体功能与实现

#### `main()` - 主入口（第 47-91 行）

- **功能**：编排完整的日报生成流程
- **实现**：
  1. `requireEnv("GITHUB_TOKEN")` 强制校验 GitHub Token（缺失直接抛错退出）
  2. 计算 `dateStr`（CST 日期，如 `"2026-07-11"`）和 `utcStr`（紧凑 UTC，如 `"2026-07-11 00:00"`）
  3. 读取 `DIGEST_REPO` 环境变量（控制是否创建 Issue，缺省 `""`）
  4. 日志输出 provider 名称与跟踪的数据源 id 列表（**绝不记录 API key**）
  5. 依次调用三个阶段
- **联动模块**：`config.ts`（`loadConfig`）、`hot.ts`（`fetchAllHotData`）、`report-savers.ts`（`saveHotReport`）、`report.ts`（`callLlm`/`parseLlmJson`/`saveFile`/`autoGenFooter`）、`prompts-data.ts`（`buildHighlightsPrompt`）、`date.ts`（`toCstDateStr`/`toUtcStr`）

#### `requireEnv(name)` - 环境变量强校验（第 37-41 行）

- **功能**：读取必需环境变量，缺失时抛 `Missing required environment variable` 错误
- **当前唯一强制项**：`GITHUB_TOKEN`（GitHub Actions 自动注入）

#### Phase 1 - 并行数据采集（第 59-61 行）

```typescript
console.log("  Fetching hot data in parallel...");
const allHotData = await fetchAllHotData(HOT_SOURCES);
```

- **功能**：一次性并行采集所有配置的数据源
- **实现**：调用 `fetchAllHotData(sources)`，内部用 `Promise.all` 并行，每个源有 `.catch()` 兜底
- **容错设计**：单个源失败返回 `{ fetchSuccess: false, items: [] }`，不影响整体流程
- **联动模块**：`hot.ts`

#### Phase 2 - 报告并行生成（第 63-75 行）

```typescript
const reportContents: Record<string, string> = {};
const footer = autoGenFooter();
await Promise.all(
  allHotData.map(async (data) => {
    const content = await saveHotReport(data, utcStr, dateStr, digestRepo, footer);
    if (content) reportContents[`ai-${data.source.id}`] = content;
  }),
);
```

- **功能**：3 份中文报告**全部并行**生成
- **实现**：单层 map（数据源）生成 3 个 Promise，一次性 `Promise.all` 等待全部完成
- **内容收集**：成功生成的报告内容存入 `reportContents["ai-<id>"]`，供 Phase 3 的 highlights 使用（失败/跳过的返回 `null`，不写入）
- **联动模块**：`report-savers.ts`（`saveHotReport`）、`report.ts`（`autoGenFooter`）

> **设计亮点**：相比 agents-radar 分阶段先摘要再保存，popular-radar 将摘要+保存+Issue 创建合并到 `saveHotReport` 一步完成，因为报告结构更简单（无跨工具对比拼接）。

#### Phase 3 - Highlights 生成（第 77-88 行）

```typescript
let highlights: ReportHighlights = {};
try {
  const raw = await callLlm(buildHighlightsPrompt(reportContents), 2048);
  highlights = parseLlmJson<ReportHighlights>(raw);
} catch (err) {
  console.error(`  [highlights] generation failed: ${err}`);
}
```

- **功能**：从所有报告中提取要点，写入 `highlights.json`
- **实现**：
  - 单次 LLM 调用生成中文 highlights，`parseLlmJson` 容错解析（去 fence、替换控制字符、修复 JSON），失败只记日志不中断
  - 结果结构为扁平的 `ReportHighlights`（`reportId → string[]`），写入 `digests/<date>/highlights.json`
  - highlights token 预算显式传 `2048`
- **联动模块**：`prompts-data.ts`（`buildHighlightsPrompt`）、`report.ts`（`callLlm`/`parseLlmJson`/`saveFile`）

#### 模块级配置加载（第 31 行）

```typescript
const { hotSources: HOT_SOURCES } = loadConfig();
```

- **功能**：在模块加载时读取 `config.yml`，获取跟踪的平台列表
- **设计**：模块级单例，整个进程生命周期内复用

#### 入口执行（第 93-96 行）

```typescript
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- **功能**：直接调用 `main()`，无 direct-run guard（与 `notify.ts`/`feishu.ts` 不同）
- **原因**：`index.ts` 是纯入口脚本，不会被其他模块导入，不需要 guard

---

## 三、配置系统 (`src/config.ts` + `config.yml`)

**配置系统通过 `config.yml` 文件驱动所有可配置项，`loadConfig()` 在启动时读取配置并提供字段级 fallback 默认值，实现零代码改平台列表。**

### 具体功能与实现

#### `config.yml` - 配置文件

- **功能**：声明跟踪的平台/分区列表和推荐系统权重
- **可配置项**：
  - `hot_sources`：平台/分区列表，每项含：
    - `id`：报告文件名 slug（生成 `ai-<id>.md`）
    - `platform`：DailyHotApi 端点名（如 `douyin`、`bilibili`）
    - `name`：显示名（中文，如 `抖音热搜`）
    - `type`：可选分区参数（如 bilibili 的 `"3"` = 音乐分区）
    - `limit`：拉取条数上限
    - `contentType`：数据类型 `"keywords"`（热搜词）或 `"videos"`（视频/内容）
  - `recommend`：推荐系统配置（预留，Phase 2 启用，含 `top_k` 和三因子权重 popularity/recency/relevance）
- **当前配置**：3 个源——抖音热搜（keywords, limit 50）、B站热门视频（videos, limit 50）、B站热门音乐（videos, type "3", limit 30）

#### 类型体系（第 14-70 行）

- **`ContentType`**：`"keywords" | "videos"`
- **`HotSource`**：`{ id, platform, name, type?, limit, contentType }`——运行时使用的规范化数据源类型
- **`RawHotSource` / `RawRecommendConfig` / `RawConfig`**：YAML 原始解析类型（所有字段可选），与规范化类型分离，便于逐字段 fallback
- **`ScoreWeights` / `RecommendConfig` / `PopularRadarConfig`**：对外导出的配置结构

#### `toHotSource(raw)` - 单条规范化（第 98-109 行）

- **功能**：把 YAML 原始条目转成类型安全的 `HotSource`
- **实现**：
  - `contentType` 枚举校验：只有显式 `"videos"` 才是 videos，其余一律回退 `"keywords"`
  - `name` 缺失时回退到 `id`
  - `limit` 非 number 时回退 `50`
  - `type` 存在才附加，并 `String()` 强转（YAML 里 `"3"` 或 `3` 都能处理）

#### `loadConfig(configPath)` - 配置加载器（第 111-143 行）

- **功能**：读取并解析 `config.yml`，返回类型安全的 `PopularRadarConfig` 对象
- **实现**：
  - 用 `path.resolve` + `fs.existsSync` 判断文件是否存在
  - 文件缺失时打印日志并返回内置默认值（`DEFAULT_HOT_SOURCES` 3 源 + `DEFAULT_RECOMMEND`）
  - 用 `js-yaml` 解析；`hot_sources` 为空数组或缺失时回退默认
  - `recommend` 缺失时回退默认，存在时逐字段 `??` fallback（topK 与三权重各自兜底）
- **日志**：输出加载数据源数量和 recommend topK
- **联动模块**：被 `index.ts`（模块级加载）和 `rollup.ts`（动态派生 `ROLLUP_SOURCES`）调用

#### `contentType` 的关键作用

- 决定使用哪个 prompt builder（`buildKeywordsPrompt` vs `buildVideosPrompt`），是**数据层到报告层的唯一分流器**
- `keywords`：热搜词（抖音），无封面/作者，只有标题+热度+链接
- `videos`：视频/内容（B站），有封面/作者/播放量

---

## 四、数据采集层 (`src/hot.ts`)

**`hot.ts` 是一个通用 DailyHotApi 客户端，用一个 `fetchHotData(source)` 函数替代了 agents-radar 的 9 个独立 fetcher，因为 DailyHotApi 所有端点共享统一的响应结构。**

### 设计背景

DailyHotApi（imsyy/DailyHotApi）是一个多平台热搜聚合 API，部署在 Vercel/Cloudflare 上。所有端点遵循统一接口：

```
GET <base>/<platform>?cache=false&limit=N[&type=<partition>]
→ { code: 200, name, title, link, total, updateTime, data: ListItem[] }
```

每个 `ListItem` 有统一结构：`{ id, title, cover?, author?, desc?, hot?, timestamp?, url, mobileUrl }`。因此不需要为每个平台写独立 fetcher，一个通用客户端即可。

### 具体功能

#### `HotItem` 类型（第 22-35 行）

- **结构**：`{ id, title, cover?, author?, desc?, hot?, timestamp?, url, mobileUrl }`
- **设计**：所有可选字段都用 `?` 标注，因为不同平台提供的数据字段不同
  - 抖音热搜词：只有 `title` + `hot` + `url`（无 cover/author）
  - B站视频：有 `cover` + `author` + `hot`（播放量）+ `url`
  - 微博热搜：`hot` 可能是 `undefined`

#### `HotData` 类型（第 37-41 行）

- **结构**：`{ source: HotSource, items: HotItem[], fetchSuccess: boolean }`
- **`fetchSuccess` 字段**：所有 fetch 的通用容错契约，下游 saver 据此决定是否跳过报告生成

#### `ApiListItem` / `ApiResponse`（第 47-68 行）

- DailyHotApi 上游响应的内部类型（`hot` 可能是 number 或 string，`id` 可能是 number 或 string）

#### `parseHot(raw)` - 热度值解析（第 82-88 行）

- **功能**：将 DailyHotApi 返回的 `hot` 字段统一解析为 number
- **实现**：
  - `number` 直接返回；`undefined`/`null` 返回 `undefined`
  - `string` 去除逗号和空格后转 number（处理 `"12,345"`），非数字/空串返回 `undefined`
- **设计原因**：`hot` 字段类型不一致——GitHub trending 是字符串 `"12,345"`，多数平台是 number，微博是 `undefined`

#### `toItem(raw)` - 数据映射（第 90-104 行）

- **功能**：将 `ApiListItem` 映射为内部 `HotItem`
- **实现**：`id` 转 `String`；只填充存在的可选字段（`if (raw.cover)` 等），避免 undefined 污染；调用 `parseHot` 统一热度值

#### `fetchHotData(source)` - 单源采集（第 113-160 行）

- **功能**：从 DailyHotApi 获取单个数据源的热点数据
- **实现**：
  1. 读取 `DAILYHOT_BASE_URL`（默认 `https://api-hot.imsyy.top`），去除尾部斜杠
  2. 构建 `URLSearchParams`：`cache=false`（强制刷新）+ `limit=N`；`source.type` 存在时附加 `type`
  3. `fetch` 带 15 秒超时（`AbortController` + `setTimeout`，请求头带 `User-Agent: popular-radar/1.0`）
  4. **多层容错**：
     - HTTP 非 2xx → 返回空数据 + `fetchSuccess: false`
     - 响应非 JSON（上游失败时 DailyHotApi 会返回 HTML 错误页）→ `JSON.parse` 包 try-catch，返回空数据
     - `code !== 200` 或 `data` 非数组 → 返回空数据
     - 任何异常 → 外层 `try-catch` 返回空数据
  5. 成功时映射所有 items，`fetchSuccess = items.length > 0`
- **容错设计**：任何失败路径都返回 `{ source, items: [], fetchSuccess: false }`，保证调用方不会因单源崩溃

#### `fetchAllHotData(sources)` - 并行采集（第 162-167 行）

- **功能**：并行采集所有配置的数据源
- **实现**：`Promise.all(sources.map((s) => fetchHotData(s).catch(() => ({ source: s, items: [], fetchSuccess: false }))))`
- **双重容错**：`fetchHotData` 内部已有 try-catch，外层再加 `.catch()` 兜底（防御性编程）
- **联动模块**：被 `index.ts` 的 Phase 1 调用

### 常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `DEFAULT_BASE_URL` | `https://api-hot.imsyy.top` | 公共演示实例（生产应自部署） |
| `FETCH_TIMEOUT_MS` | `15_000` | 单请求 15 秒超时 |

---

## 五、LLM Provider 抽象层 (`src/providers/`)

**Provider 抽象层通过 `LlmProvider` 接口统一 6 种 LLM 后端（Anthropic、OpenAI、GitHub Copilot、OpenRouter、DeepSeek、火山方舟 Volcano），工厂模式按环境变量选择，新增 provider 只需一个文件加一行注册。此模块从 agents-radar 移植，并新增了 `volcano` provider。**

### 继承体系

```
LlmProvider (接口, types.ts)
  ── call(prompt, maxTokens) -> Promise<string>
  │
  ├─ AnthropicProvider            直接实现接口（独立 SDK）
  │
  └─ OpenAICompatibleProvider     抽象基类（共享 openai SDK）
       ├─ OpenAIProvider
       ├─ GitHubCopilotProvider
       ├─ OpenRouterProvider
       ├─ DeepSeekProvider
       └─ VolcanoProvider          ← 新增（火山方舟 Ark）
```

### 具体功能

#### `types.ts` - 接口定义

- **`LlmProvider` 接口**：`{ readonly name: string; call(prompt, maxTokens): Promise<string> }`
- **`ProviderFactory` 类型**：`() => LlmProvider`，零参数工厂函数
- 无 SDK 依赖，是整个代码库的 provider 无关契约

#### `openai-compatible.ts` - 共享基类

- **功能**：为所有 OpenAI API 兼容的 provider 提供共享实现
- **实现**：
  - 构造函数接收 `{ apiKey?, baseURL?, model, extraBody? }`，实例化 `new OpenAI({ apiKey, baseURL })`；`extraBody` 用于 provider 特有请求参数（如 Ark 的 `thinking`）
  - `call()` 调用 `client.chat.completions.create()`，使用 `max_completion_tokens`（OpenAI 新参数名），并展开 `extraBody`
  - **额外参数自动降级**：若后端拒绝 `extraBody`（400 invalid parameter），自动去掉额外参数重试一次
  - **绝不回退 `reasoning_content`**：只取 `message.content`；为空（思考耗尽 token 预算）时直接抛错——发布思考过程比这份报告失败更糟。旧版的 reasoning_content 回退曾导致整段思考文本被当作报告正文发布，已删除

#### `anthropic.ts` - Anthropic 独立实现

- **功能**：直接使用 `@anthropic-ai/sdk`，不继承 OpenAI 兼容基类
- **原因**：Anthropic Messages API 返回内容块数组（`type === "text"`），与 OpenAI 的 `choices` 数组结构不同
- **实现**：`client.messages.create({ model, max_tokens, messages })`，从 `content` 中 `find(b => b.type === "text")` 取文本
- **默认模型**：`claude-sonnet-4-6`（`ANTHROPIC_MODEL` 覆盖；SDK 自动读取 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`）

#### 5 个 OpenAI 兼容子类

| Provider | 文件 | 默认模型 | baseURL | 主要环境变量 |
|----------|------|---------|---------|---------|
| OpenAIProvider | `openai.ts` | `gpt-4o` | 可覆盖（`OPENAI_BASE_URL`） | `OPENAI_API_KEY` / `OPENAI_MODEL` |
| GitHubCopilotProvider | `github-copilot.ts` | `gpt-4o` | 固定 `models.github.ai/inference` | `GITHUB_TOKEN` / `GITHUB_COPILOT_MODEL` |
| OpenRouterProvider | `openrouter.ts` | `anthropic/claude-sonnet-4` | 固定 `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` |
| DeepSeekProvider | `deepseek.ts` | `deepseek-chat` | 固定 `api.deepseek.com` | `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` |
| **VolcanoProvider** | `volcano.ts` | `doubao-seed-2.0-pro` | 默认 `ark.cn-beijing.volces.com/api/coding/v3`（`ARK_BASE_URL` 可覆盖） | `ARK_API_KEY` / `ARK_MODEL` |

#### `volcano.ts` - 火山方舟 Ark（新增）

- **功能**：接入火山方舟（字节跳动）doubao-seed 系列模型，走 OpenAI 兼容协议
- **实现**：继承 `OpenAICompatibleProvider`，`name = "volcano"`，默认 base URL 指向火山**编程套餐 OpenAI 兼容端点** `/api/coding/v3`，默认模型 `doubao-seed-2.0-pro`
- **思考模式默认关闭**：请求体带 `thinking: { type: "disabled" }`（`ARK_THINKING` 环境变量可覆盖为 `enabled`/`auto`）。日报摘要类任务不依赖深度推理，关闭后既省思考 token，又从源头杜绝思考过程泄漏；若模型不支持该参数，基类自动去参重试
- **火山双端点说明**：火山 Ark 编程套餐同时提供 Anthropic 协议端点 `/api/coding` 与 OpenAI 协议端点 `/api/coding/v3`；本项目使用后者
- **联动**：在 `providers/index.ts` 注册为 `volcano`

#### `index.ts` - 工厂与注册表

- **`PROVIDERS` 注册表**：`Record<string, ProviderFactory>`，用 `satisfies` 确保类型安全，当前含 6 项（含 `volcano`）
- **`ProviderName` / `VALID_PROVIDER_NAMES`**：从注册表 key 派生的类型与运行时数组
- **`createProvider(name?)`**：解析 `LLM_PROVIDER` 环境变量（默认 `"anthropic"`），查找工厂函数；名字非法时抛出带全部合法名字的描述性错误
- **日志安全**：只输出 provider 名称，**绝不记录 API key 或 URL**

---

## 六、LLM 调用基础设施 (`src/report.ts`)

**`report.ts` 是 LLM 调用的基础设施层，提供并发限流（5）、429 自动重试（指数退避）、思考文本剥离（`stripThinkTags`）、JSON 容错解析、文件写入等核心工具，所有报告生成器都依赖此模块。从 agents-radar 移植，修改了 `autoGenFooter` 的品牌文本并新增思考清洗。**

### 具体功能

#### Provider 单例（第 22 行）

- 模块加载时创建 `const provider = createProvider()`，整个进程复用一个 provider 实例

#### `stripThinkTags(text)` - 思考文本剥离（第 67-72 行）

- **功能**：剥离思考模型内联在正文里的推理块（`<think>...</think>` / `<thinking>...</thinking>`，含未闭合标签），确保推理文本永不进入发布产物
- **调用位置**：`callLlm` 对每次 LLM 返回统一清洗；清洗后为空则抛错（宁可该报告失败，也不发布思考过程）
- **测试覆盖**：`__tests__/parse.test.ts` 5 个用例（纯文本不变 / 闭合块 / thinking 变体 / 未闭合 / 多块）

#### `callLlm(prompt, maxTokens)` - 核心调用入口（第 74-97 行）

- **功能**：所有 LLM 调用的唯一入口，内置并发限流、重试与思考文本剥离
- **并发限流**（第 30-49 行）：
  - `LLM_CONCURRENCY = 5`，通过 `llmSlots` 计数器 + `llmQueue` FIFO 队列实现
  - `acquireSlot()`：有空闲槽位直接获取，否则入队等待
  - `releaseSlot()`：唤醒队首等待者，否则归还槽位
  - 设计目的：防止大量并行 LLM 调用触发 429 限流
- **429 重试**：
  - `MAX_RETRIES = 3`，指数退避 `5s / 10s / 20s`（`RETRY_BASE_MS = 5000`，`RETRY_BASE_MS * 2 ** attempt`）
  - 重试前释放并发槽位（让其他调用继续），等待后重新获取
  - `is429(err)`（第 58-60 行）检查 `.status === 429` 或错误信息包含 "429"
  - `finally` 块保证槽位一定释放（用 `released` 标志避免重复释放）
- **联动**：被 `index.ts`、`report-savers.ts`、`rollup.ts` 调用

#### `parseLlmJson<T>(raw)` - 容错 JSON 解析（第 117-131 行）

- **功能**：解析 LLM 返回的 JSON，容忍常见格式缺陷
- **实现**：
  1. 去除 markdown code fence（` ```json ` 和 ` ``` `）
  2. 用 `CONTROL_CHARS` 正则替换 ASCII 控制字符（U+0000–U+001F）为空格——模型偶尔在字符串里吐裸换行，属非法 JSON
  3. 尝试 `JSON.parse`
  4. 失败时调用 `repairJson` 修复后重试（若修复后与原文相同则抛原错误）
- **`repairJson(s)`（第 137-144 行）**：
  - 缩窄到最外层 `{`/`[` 到最后 `}`/`]` 的块（去除周围散文）
  - 移除 `}`/`]` 前的尾逗号
- **设计目的**：单个杂散字符不应导致整个语言的 `highlights.json` 被清空
- **测试覆盖**：`__tests__/parse.test.ts` 覆盖 clean JSON / 去 fence / 控制字符 / 尾逗号 / 散文包裹 5 种场景
- **联动**：被 `index.ts`（highlights 解析）、`rollup.ts`（rollup highlights 解析）调用

#### `saveFile(content, ...segments)` - 文件写入（第 150-155 行）

- **功能**：将内容写入 `digests/<segments>`，自动创建父目录
- **实现**：`path.join("digests", ...segments)` + `fs.mkdirSync(recursive: true)` + `fs.writeFileSync`，返回文件路径
- **联动**：被所有报告生成器、`rollup.ts`、`index.ts` 调用

#### `autoGenFooter()` - 自动生成页脚（第 157-161 行）

- **功能**：生成"由 popular-radar 自动生成"的 Markdown 页脚（中文）
- **实现**：读取 `DIGEST_REPO`，未设置时返回空字符串；否则拼接 `FOOTER.autoGen` + 仓库链接 + "自动生成。"
- **与 agents-radar 的差异**：品牌文本从 "agents-radar" 改为 "popular-radar"，并移除了 lang 参数
- **联动**：被所有报告生成器调用，页脚文案来自 `i18n.ts` 的 `FOOTER`

#### Token 预算常量

| 常量 | 值 | 使用场景 |
|------|-----|---------|
| `LLM_TOKENS_DEFAULT` | 4096 | 所有日报（`callLlm` 默认值） |
| `LLM_TOKENS_ROLLUP` | 8192 | 周报/月报 |

> highlights 生成不使用上述常量，而是显式传参：日报 highlights 传 `2048`，rollup highlights 传 `1024`。

---

## 七、Prompt 构建层 (`src/prompts-data.ts`)

**Prompt 构建层为所有报告类型构建 LLM prompt（全部中文），包含两个数据源 prompt builder（按 contentType 分流）和三个汇总 prompt builder。所有 builder 返回纯字符串，无 LLM 调用，可独立测试。每个 prompt 末尾都显式要求"直接输出报告正文，不要输出任何思考过程"。**

### 7.1 `buildKeywordsPrompt` - 热搜词 prompt（第 19-59 行）

- **功能**：为热搜词类数据源（抖音）构建 LLM prompt
- **数据格式化**：每条渲染为 `序号. **词** \n 🔗 链接 \n 🔥 热度`（热度缺失显示 `-`），用 `map(...).join("\n\n")` 拼接
- **请求输出**：4 节结构
  1. **今日速览** - 3-5 句概括
  2. **热门搜索词** - 精选 10-15 个，每个含词+链接+热度+一句话说明
  3. **趋势信号分析** - 100-200 字，按领域（科技/社会/娱乐/消费）分析
  4. **值得关注** - 2-3 个值得深挖的搜索词
- **联动**：被 `report-savers.ts` 的 `saveHotReport`（当 `contentType === "keywords"`）调用

### 7.2 `buildVideosPrompt` - 视频内容 prompt（第 61-104 行）

- **功能**：为视频/内容类数据源（B站热门/B站音乐）构建 LLM prompt
- **数据格式化**：每条渲染为 `序号. **标题** | UP主 | 播放量 \n 🔗 链接`（author/hot 存在才拼），比 keywords prompt 多 author 和 hot 字段
- **请求输出**：4 节结构
  1. **今日速览** - 3-5 句概括
  2. **热门内容** - 按 4 个分类组织：📚知识科技 / 🎬娱乐 / 🎵音乐表演 / 🏠生活
  3. **流量信号分析** - 100-200 字，分析爆款内容和新锐创作者
  4. **值得一看** - 2-3 个最值得深入观看的内容
- **联动**：被 `report-savers.ts` 的 `saveHotReport`（当 `contentType === "videos"`）调用

### 7.3 `buildHighlightsPrompt` - Highlights 提取 prompt（第 114-139 行）

- **功能**：从报告内容中提取结构化要点，返回 JSON
- **签名**：`(reportContents: Record<string,string>, itemsPerReport=6)`
- **输入处理**：每份报告内容截断 2000 字符，用 `## [reportId]` 标注拼接
- **输出格式**：`{"ai-douyin":["亮点1",...], "ai-bili":[...]}`（用方括号里的 reportId 作 key）
- **约束**：每报告 `itemsPerReport`（默认 6）条；每条 ≤ 30 字；跳过无内容/失败的报告
- **返回纯 JSON**（提示词明确要求无 markdown fence、无思考过程）
- **联动**：被 `index.ts` Phase 3（传 `itemsPerReport` 缺省 6）和 `rollup.ts`（`generateRollupHighlights`，单报告）调用

#### `ReportHighlights` 类型（第 110-112 行）

- **结构**：`{ [reportId: string]: string[] }`（reportId → highlight 数组）
- **联动**：被 `index.ts`、`rollup.ts`、`notify.ts`、`feishu.ts` 使用

### 7.4 `buildWeeklyPrompt` - 周报 prompt（第 145-166 行）

- **功能**：将近 7 天日报内容（`Record<date, content>`）传入 LLM，生成周报
- **请求输出**：6 节（本周要闻、抖音搜索趋势、B站内容亮点、跨平台信号、创作者聚焦、下周信号）
- **联动**：被 `rollup.ts` 的 `runWeeklyRollup` 调用

### 7.5 `buildMonthlyPrompt` - 月报 prompt（第 172-193 行）

- **功能**：将上月报告（`Record<key, content>`）传入 LLM，生成月报
- **请求输出**：6 节（月度要闻、抖音搜索月度回顾、B站内容月度回顾、跨平台趋势总结、创作者生态健康度、下月展望）
- **联动**：被 `rollup.ts` 的 `runMonthlyRollup` 调用

---

## 八、报告生成层 (`src/report-savers.ts`)

**`report-savers.ts` 是报告生成的编排层，用一个通用 `saveHotReport` 函数处理所有数据源报告，根据 `contentType` 自动选择 prompt builder，遵循 guard → LLM → header → saveFile → issue → catch 的统一模式。**

### 设计理念

相比 agents-radar 的 7 个独立 saver 函数（`saveHnReport`、`saveArxivReport` 等），popular-radar 用**一个通用 saver** 处理所有数据源。原因是：

1. 所有 DailyHotApi 端点返回相同结构的数据
2. 报告生成流程完全一致（guard → LLM → header → save → issue）
3. 唯一差异是 prompt builder 选择（由 `contentType` 决定）
4. 报告元数据（标题、issue 标题）通过 `getReportMeta(source)` 动态获取

### `saveHotReport(data, utcStr, dateStr, digestRepo, footer)` - 通用报告生成器

- **功能**：生成并保存单个数据源的日报报告，返回报告内容字符串（供 highlights），失败/跳过返回 `null`
- **实现**（7 步模式）：
  1. **Guard 检查**：`!data.fetchSuccess || data.items.length === 0` 时跳过，日志 "No data available"，返回 `null`
  2. **LLM 调用**：按 `contentType` 分流选 `buildKeywordsPrompt` 或 `buildVideosPrompt`，`callLlm(prompt)`（默认 4096 token）
  3. **文件命名**：`ai-<id>.md`
  4. **Header 构建**：`getReportMeta(source)` 取标题 + 数据源名 + 条数 + 生成时间
  5. **保存**：`saveFile(header + summary + footer, dateStr, fileName)`
  6. **Issue 创建**：`digestRepo` 非空时 `createGitHubIssue(meta.issueTitle, content, label)`，label 取 `ISSUE_LABELS[id]`，缺省回退 `id`
  7. **容错**：整个 try 块的错误被 `console.error` 捕获，返回 `null`，不崩溃主流程
- **联动模块**：`prompts-data.ts`（两个 builder）、`report.ts`（`callLlm`/`saveFile`）、`github.ts`（`createGitHubIssue`）、`i18n.ts`（`getReportMeta`/`ISSUE_LABELS`）、`hot.ts`（`HotData` 类型）

### Header 格式

```
# {TITLE} {dateStr}

> 数据来源: {source.name} | 共 {count} 条 | 生成时间: {utcStr} UTC

---

{LLM 摘要}

{footer}
```

---

## 九、文案集中管理 (`src/i18n.ts`)

**`i18n.ts` 是所有用户可见字符串的唯一来源（纯中文）。原双语系统（`Lang` 类型 + `t(zh,en)` + `Record<Lang,string>`）已随英文移除一并删除，所有常量简化为普通字符串。**

### 具体功能

#### 状态消息 `MSG`

- `noData`：数据获取失败消息
- `summaryFailed`：摘要生成失败消息

#### 报告标签对象

Phase 1 三个日报，每个含 `title: string` + `issueTitle(dateStr)`：

| 对象 | emoji | 标题 |
|------|-------|------|
| `DOUYIN_REPORT` | 🔥 | 抖音热搜日报 |
| `BILI_REPORT` | 📺 | B站热门视频日报 |
| `BILI_MUSIC_REPORT` | 🎵 | B站热门音乐日报 |

周报月报：
- `WEEKLY_REPORT`：`title` + `coverage`（覆盖日期标签）+ `issueTitle(weekStr)`（📅）
- `MONTHLY_REPORT`：`title` + `issueTitle(monthStr)`（📆）

#### `getReportMeta(source)` - 动态报告元数据

- **功能**：根据 source id 返回对应的报告元数据（`title` + `issueTitle`）
- **实现**：内置 `REPORT_META_BY_ID`（douyin/bili/bili-music）映射查找；未命中时用 `fallbackMeta(source)` 以 `source.name` 生成 `📊 {name}日报` 标题
- **设计目的**：支持 config.yml 新增非内置数据源（如快手），自动生成报告标题
- **联动**：被 `report-savers.ts` 调用

#### `ISSUE_LABELS` - GitHub Issue 标签

- 每种报告类型一个标签（如 `douyin: "douyin"`），含 5 组：douyin/bili/bili-music/weekly/monthly
- **类型**：`Record<string, string>`（非 `as const`，允许动态 key 访问）
- **联动**：被 `report-savers.ts` 调用

#### `FOOTER`

- `autoGen: "本日报由"`，被 `report.ts` 的 `autoGenFooter` 使用

#### `REPORT_LABELS` - manifest/RSS 标签

- `Record<string, string>`，slug → 显示标题，含 3 日报 + 周报 + 月报 = 5 条
- **联动**：被 `generate-manifest.ts` 调用

#### `NOTIFY_LABELS` - 通知短标签

- `Record<string, string>`，slug → 短标签（如 `ai-douyin: "抖音热搜"`）
- **联动**：被 `notify.ts`、`feishu.ts` 使用

---

## 十、周报月报汇总系统 (`src/rollup.ts`)

**`rollup.ts` 读取已保存的日报文件（不重新 fetch 数据），通过 LLM 生成周报和月报，并维护合并的 highlights.json。从 agents-radar 移植，核心逻辑相同，但 `ROLLUP_SOURCES` 改为从 config 动态派生。**

### 具体功能

#### `ROLLUP_SOURCES` - 动态汇总源（第 29-30 行）

```typescript
const { hotSources: HOT_SOURCES } = loadConfig();
const ROLLUP_SOURCES = HOT_SOURCES.map((s) => `ai-${s.id}`);
```

- **功能**：汇总报告要读取的日报文件列表
- **设计**：从 config.yml 动态派生，新增数据源自动纳入汇总（agents-radar 是硬编码 5 个）

#### 文件读取辅助

- **`getDateDirs()`（第 36-43 行）**：列出 `digests/` 下匹配 `YYYY-MM-DD` 的目录，降序排列
- **`readDailyDigest(date)`（第 46-57 行）**：拼接该日所有 `ROLLUP_SOURCES` 日报，每类截断 `MAX_CHARS_PER_REPORT=2500` 字符（超出加"...[摘要截断]"），无内容返回 `null`
- **`readWeeklyDigest(date)`（第 60-65 行）**：读取 `ai-weekly.md`，截断 3000 字符

#### `toWeekStr(date)` - ISO 周字符串（第 68-75 行）

- **功能**：计算 ISO 周字符串（如 `"2026-W28"`），使用"第一个星期四"规则

#### `generateRollupHighlights(...)` - Highlights 合并（第 81-112 行）

- **功能**：为周报/月报生成 highlights，**合并**到已有 `highlights.json`（不覆盖日报 highlights）
- **实现**：读取已有 highlights（扁平 `ReportHighlights`）→ spread 复制到新对象 → `callLlm(buildHighlightsPrompt({[reportId]: content}, itemsPerReport), 1024)` → `parseLlmJson` 后 `Object.assign` 合并 → 写回
- **容错**：读取旧文件 parse 失败则从空开始；生成/解析失败只记日志，保留已有 highlights

#### `runWeeklyRollup()` - 周报生成（第 117-167 行）

- **功能**：基于近 7 天日报生成周报（中文）
- **实现**：
  1. 计算 `weekStr`（对 CST 时间取 ISO 周）、`dateStr`、`utcStr`
  2. `getDateDirs()` 取近 7 个日期目录，`readDailyDigest` 拼接；全空则跳过
  3. `callLlm(buildWeeklyPrompt(...), LLM_TOKENS_ROLLUP=8192)`
  4. 拼 header（含覆盖日期范围 `last7[末] ~ last7[首]`）+ footer，保存 `ai-weekly.md`
  5. `generateRollupHighlights(..., "ai-weekly", 6)` 合并 highlights
  6. `digestRepo` 非空时创建 GitHub Issue（label `weekly`）
- **联动**：`prompts-data.ts`、`report.ts`、`github.ts`、`i18n.ts`、`date.ts`、`config.ts`

#### `runMonthlyRollup()` - 月报生成（第 173-242 行）

- **功能**：基于**上月**报告生成月报（中文）
- **实现**：
  1. 覆盖上个月（`cstDate.getUTCMonth() - 1`），`monthStr` 形如 `"2026-06"`
  2. **源选择策略**：上月有 ≥2 期周报 → 用周报（`readWeeklyDigest`，优先）；否则每 4 天采样 1 天日报（最多 10 天，`readDailyDigest`）；全空则跳过
  3. `callLlm(buildMonthlyPrompt(...), LLM_TOKENS_ROLLUP)`
  4. 拼 header（含来源说明 `sourceLabel`）保存 `ai-monthly.md`
  5. `generateRollupHighlights(..., "ai-monthly", 6)` 合并 highlights
  6. `digestRepo` 非空时创建 GitHub Issue（label `monthly`）

### 常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `DIGESTS_DIR` | `digests` | 日报根目录 |
| `MAX_CHARS_PER_REPORT` | `2500` | 每份日报读入时截断长度 |

---

## 十一、通知推送系统

**通知系统包含两个平行模块：`notify.ts`（Telegram，HTML 格式）和 `feishu.ts`（飞书，Markdown 卡片），都从 manifest.json 读取最新报告列表，附加 highlights 摘要后推送。从 agents-radar 移植，改品牌名和 `PAGES_URL` 默认值。当前部署主用飞书。**

### 11.1 `src/notify.ts` - Telegram 通知

**`notify.ts` 构建 HTML 格式的 Telegram 消息，列出当日所有报告的链接和 highlights 摘要，通过 Bot API 推送。**

#### 具体功能

**`buildMessage(date, reports, pagesUrl?, highlights?)`**
- 防御性过滤历史 manifest 中的 `-en` 条目，按"日报在前、周报/月报在后"排序
- 根据是否含 `ai-weekly`/`ai-monthly` 选择图标（📡 日报 / 📅 周报 / 📆 月报）和标题后缀
- 每报告一行中文链接（`PAGES_URL/#date/report`）
- highlights（扁平 `ReportHighlights`）作为缩进子项 `◦`，用 `escapeHtml` 转义
- 末尾附 Web UI + RSS 链接

**`sendTelegram(text)`**
- `POST https://api.telegram.org/bot{TOKEN}/sendMessage`，`parse_mode: "HTML"`，`disable_web_page_preview: true`
- 非 2xx 抛错

**`main()`**
- `TELEGRAM_BOT_TOKEN` 未设置 → 静默跳过
- 读 `manifest.json` 取最新日期与报告列表；空则跳过
- 可选加载 `digests/{date}/highlights.json`
- 构建 + 发送
- **direct-run guard**：仅当 `import.meta.url === argv[1]` 时执行，防止被 import 时误发

### 11.2 `src/feishu.ts` - 飞书通知

**`feishu.ts` 构建 Markdown 格式的飞书卡片消息，支持多 webhook 扇出推送，容忍部分失败。**

#### 具体功能

**`buildFeishuMessage(...)`**
- 与 Telegram 相同的报告排序 + highlights 逻辑，但使用 `[label](url)` Markdown 链接语法

**`getWebhookUrls()`**
- 读取 `FEISHU_WEBHOOK_URLS`（逗号分隔多 webhook），回退支持旧的单个 `FEISHU_WEBHOOK_URL`；trim 后过滤空串

**`sendToOneWebhook` / `sendFeishu`**
- `POST` interactive card JSON（`msg_type: "interactive"`，蓝色标题模板 `template: "blue"`，元素为一个 `markdown` 块）
- `Promise.allSettled` 多 webhook 扇出，部分失败记日志，**全部失败才抛错**

**`main()`**
- 无 webhook → 静默跳过；读 manifest 最新日期；可选加载 highlights
- 标题按日报/周报/月报选图标与后缀
- **direct-run guard** 同 notify.ts

#### 共同设计

- 两者都有 direct-run guard，都读 `manifest.json` 找最新日期，都可选加载 `highlights.json`（扁平 `ReportHighlights`），都在 secret 未设置时静默跳过
- `PAGES_URL` 默认值均为 `https://tangzijian-hanakhhu.github.io/popular-radar`

---

## 十二、Web UI 与 RSS (`src/generate-manifest.ts` + `index.html`)

**`generate-manifest.ts` 扫描所有已生成的日报，生成 `manifest.json`（Web UI 侧边栏数据）和 `feed.xml`（RSS 2.0 订阅源），`index.html` 读取 manifest 构建前端界面。从 agents-radar 移植，改 `REPORT_FILES` 列表和 `SITE_URL`。**

### 12.1 `src/generate-manifest.ts`（后处理层）

**在所有报告生成后运行，扫描 `digests/` 目录生成 manifest.json 和 feed.xml。**

#### 具体功能

**`main()`（第 82-163 行）**
1. 扫描 `digests/` 下匹配 `YYYY-MM-DD` 的目录，过滤出至少含一个 `REPORT_FILES` 报告的目录，降序排列
2. 写入 `manifest.json`：`{ generated: ISO时间, dates: [{date, reports}] }`
3. 构建 RSS：遍历条目（最新优先），最多 `MAX_FEED_ITEMS = 30` 条
4. 每条 `<item>`：title、link（`SITE_URL/#date/report`）、guid（isPermaLink）、pubDate（RFC 822）、description（≤500字纯文本摘要）、content:encoded（CDATA 全文 HTML）
5. 写入 `feed.xml`（完整 RSS 2.0 文档，含 atom:link self、lastBuildDate）

**`getReportContent(date, report)`（第 50-80 行）**
- `marked.parse` 转 HTML → 去标签得 ≤500 字符纯文本摘要（`escapeXml`）→ 全文 HTML 包 CDATA
- 处理 `]]>` 序列防 CDATA 注入；读文件异常时回退到"标题-only"内容

**`toRfc822` / `escapeXml`** - RFC 822 日期格式化与 XML 转义辅助

#### 常量

- `REPORT_FILES`：5 个报告 ID（`ai-douyin` / `ai-bili` / `ai-bili-music` / `ai-weekly` / `ai-monthly`）
- `MAX_FEED_ITEMS = 30`
- `SITE_URL`：`https://tangzijian-hanakhhu.github.io/popular-radar`

### 12.2 `index.html` - Web UI（单页应用，569 行）

**读取 `manifest.json` 构建侧边栏，按需 fetch 报告 Markdown 渲染。**

- **主题**：深色/浅色切换，用 CSS 变量 + `data-theme` 属性；**主题偏好持久化到 `localStorage`（key `ar-theme`）**，默认 dark
- **侧边栏**：按月分组 → 日期 → 报告类型三级折叠（纯中文报告按钮；历史 manifest 中的 `-en` 条目被防御性忽略）
- **全文搜索**：`fetch` 所有报告 `.md` 建立搜索索引（`searchIndex`），按日期高亮匹配
- **渲染**：报告 Markdown 通过 `marked`（`breaks: true, gfm: true`）渲染 + `DOMPurify` 消毒；自定义 hook 放行 `<details>`/`<summary>` 标签
- **数据加载**：从 `./manifest.json` 读列表，从 `./digests/{date}/{report}.md` 读正文；失败显示"无法加载 manifest.json"
- **`LABELS` 对象**：与 `i18n.ts` 的 `REPORT_LABELS` 保持同步
- **RSS 入口**：header 有 RSS 链接，`<link rel="alternate">` 指向 `./feed.xml`
- **移动端适配**：侧边栏折叠为顶部菜单

---

## 十三、GitHub Actions 工作流

**项目有 4 个 GitHub Actions 工作流，覆盖 CI 质量门禁、每日日报、周报、月报，刻意错峰调度避免 LLM 并发冲突。日报/周报/月报三条流水线均使用 `LLM_PROVIDER: volcano`（火山方舟），并均已接入飞书与 Telegram 推送。**

### 13.1 `ci.yml` - CI 质量门禁

- **触发**：push 到 master/main + 所有 pull_request
- **步骤**：`pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`
- **不提交**：只做检查，无产物

### 13.2 `daily-digest.yml` - 每日日报（主流程）

- **调度**：`cron: "0 0 * * *"`（UTC 00:00 = CST 08:00）+ `workflow_dispatch`
- **权限**：`contents: write` + `issues: write`；超时 20 分钟
- **步骤序列**：
  1. Checkout + pnpm v4 + Node 22 + `pnpm install --frozen-lockfile`
  2. `pnpm start`，环境变量：`GITHUB_TOKEN`、`LLM_PROVIDER=volcano`、`ARK_API_KEY`、`ARK_MODEL`、`DAILYHOT_BASE_URL`、`DIGEST_REPO=${{ github.repository }}`
  3. Commit digest files（有变化才 commit + pull --rebase + push）
  4. `pnpm manifest`
  5. Commit manifest and feed
  6. `pnpm notify`（Telegram，`PAGES_URL` 内联为 Pages 地址）
  7. `pnpm notify:feishu`（飞书，`FEISHU_WEBHOOK_URLS`）
  8. `pnpm close-stale`（关闭 7 天前 Issue）

### 13.3 `weekly-digest.yml` - 周报

- **调度**：`cron: "0 1 * * 1"`（UTC 周一 01:00 = CST 09:00）+ `workflow_dispatch`；超时 15 分钟
- **步骤**：`pnpm weekly`（env 同上，无 DAILYHOT——周报不 fetch）→ Commit → `pnpm manifest` → Commit → `pnpm notify`（Telegram）→ **`pnpm notify:feishu`（飞书，已补齐）**

### 13.4 `monthly-digest.yml` - 月报

- **调度**：`cron: "0 2 1 * *"`（UTC 每月1日 02:00 = CST 10:00）+ `workflow_dispatch`；超时 15 分钟
- **步骤**：`pnpm monthly` → Commit → `pnpm manifest` → Commit → `pnpm notify`（Telegram）→ **`pnpm notify:feishu`（飞书，已补齐）**

> 说明：周报/月报原本仅有 Telegram 推送，现已补齐飞书推送步骤，使三条流水线的飞书通知行为一致。Telegram 与飞书在对应 secret 未配置时均静默跳过，互不影响。

### 调度错峰设计

| 时间(UTC) | CST | 工作流 |
|-----------|-----|--------|
| 00:00 每日 | 08:00 | 每日日报 |
| 01:00 周一 | 09:00 | 周报 |
| 02:00 每月1日 | 10:00 | 月报 |

---

## 十四、辅助工具模块

### 14.1 `src/date.ts` - 日期工具

**提供 CST/UTC 日期格式化和 sleep 工具。从 agents-radar 原样复制。**

- **`toCstDateStr(date)`**：加 8 小时偏移后取 ISO 日期（如 `"2026-07-11"`）
- **`toUtcStr(date)`**：格式化为紧凑 UTC（如 `"2026-07-11 00:00"`）
- **`sleep(ms)`**：Promise 延迟（被 `report.ts` 的 429 退避使用）
- **联动**：被 `index.ts`、`rollup.ts`、`report.ts` 使用

### 14.2 `src/github.ts` - GitHub Issue 管理（精简版）

**从 agents-radar 精简而来，仅保留 Issue 创建/标签管理/过期清理，删除了 issues/PRs/releases 采集功能。运行时从环境变量读取 `GITHUB_TOKEN` 和 `DIGEST_REPO`。**

- **`headers()` / `githubGet<T>()`**：统一鉴权头（Bearer + API version 2022-11-28）与 GET 封装
- **`createGitHubIssue(title, body, label)`（第 112-127 行）**：
  - `neutralizeGitHubRefs` 中和跨仓引用（`github.com` URL 和 `@mention` 插入零宽空格 `​`，避免"mentioned this issue"通知与误 @）
  - body 超 `65536` 字符时截断并加提示尾注
  - `ensureLabel` 确保标签存在（颜色取 `LABEL_COLORS`，缺省 `0075ca`），再 `POST .../issues`
- **`ensureLabel(name, color)`**：`POST .../labels`，已存在（422）视为成功
- **`closeStaleIssues(days)`（第 79-110 行）**：分页取最旧 open issues，`created_at` 早于 cutoff 的并发 PATCH 关闭；每轮重取第 1 页（关闭会改变分页）；返回关闭数量
- **`LABEL_COLORS`**：各报告标签颜色（douyin `000000`、bili `fb7299` B站粉、bili-music `ff6b9d`、weekly `7c3aed` 紫、monthly `0d9488` 青，含 en 变体）
- **联动**：被 `report-savers.ts`、`rollup.ts`、`close-stale-issues.ts` 调用

### 14.3 `src/close-stale-issues.ts` - 过期 Issue 清理

**独立运行脚本，关闭 7 天前的开放 Issue。**

- `STALE_DAYS = 7`，调用 `github.ts` 的 `closeStaleIssues(7)`；被 `pnpm close-stale` 调用

### 14.4 `src/weekly.ts` / `src/monthly.ts` - 汇总入口脚本

- **`weekly.ts`**：调用 `rollup.ts` 的 `runWeeklyRollup()`；被 `pnpm weekly` 调用
- **`monthly.ts`**：调用 `rollup.ts` 的 `runMonthlyRollup()`；被 `pnpm monthly` 调用

### 14.5 `src/__tests__/parse.test.ts` - 单元测试

- **`parseLlmJson`**：5 个用例（clean JSON / 去 fence / 控制字符 / 尾逗号 / 散文包裹）
- **config defaults**：文件缺失时返回内置数据源，含 `douyin`
- **hot data shape**：`HotData` 携带 source 与 items 的形状校验

---

## 十五、部署与运维 (`DEPLOY.md` + 环境变量)

**`DEPLOY.md` 记录了从本地仓库到 GitHub Actions 全自动推送的一次性配置步骤，配套的环境变量在此集中说明。**

### 15.1 部署步骤（详见 `DEPLOY.md`）

1. 本地仓库 push 到 GitHub
2. 配置仓库 Secrets（见下表）
3. Settings → Actions → Workflow permissions 设为 **Read and write**（否则无法 commit/push 回仓库）
4.（可选）开启 GitHub Pages（Deploy from branch → main / root），供 Web UI 与 RSS
5. 手动 `workflow_dispatch` 触发 Daily 验证日志

### 15.2 环境变量总表

| 变量 | 用途 | 必填 | 说明 |
|------|------|------|------|
| `GITHUB_TOKEN` | 创建/关闭 Issue、push | ✅ | Actions 自动注入 |
| `LLM_PROVIDER` | 选择 LLM 后端 | ✅ | 工作流内联为 `volcano` |
| `ARK_API_KEY` | 火山方舟 key | ✅（用 volcano 时） | `ark-...` |
| `ARK_MODEL` | 覆盖模型 | ⬜ | 默认 `doubao-seed-2.0-pro` |
| `ARK_BASE_URL` | 覆盖端点 | ⬜ | 默认 `.../api/coding/v3` |
| `ARK_THINKING` | 思考模式开关 | ⬜ | 默认 `disabled`（省 token 防泄漏），可设 `enabled`/`auto` |
| `FEISHU_WEBHOOK_URLS` | 飞书推送 | ✅（要飞书时） | 逗号分隔多 webhook |
| `DAILYHOT_BASE_URL` | 数据源地址 | ⬜ | 不填用公共实例 |
| `DIGEST_REPO` | Issue 目标仓库 | ⬜ | 工作流设为 `github.repository` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram 推送 | ⬜ | 不填静默跳过 |
| `PAGES_URL` | Web UI/RSS 链接基址 | ⬜ | 工作流内联 Pages 地址 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` | 用 anthropic 后端时 | ⬜ | 默认模型 `claude-sonnet-4-6` |

### 15.3 火山方舟编程套餐注意事项

- 火山官方说明：**编程套餐额度仅在 AI 编程工具中生效，不可用于普通 API 调用**。popular-radar 是脚本化 API 调用，存在被拒可能。
- 建议：配置后先手动跑一次 Daily 看日志验证。
- 备选：改用标准 Ark API（`ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`），或切回内置的 `deepseek`（改 `LLM_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`）。

---

## 十六、项目文件全景

```
popular_radar/
├── src/
│   ├── index.ts              # 主编排：3阶段 pipeline + main()
│   ├── hot.ts                # DailyHotApi 通用客户端（fetchHotData/fetchAllHotData）
│   ├── config.ts             # config.yml 加载器（loadConfig + HotSource 类型）
│   ├── i18n.ts               # 中文字符串中心
│   ├── date.ts               # CST/UTC 日期工具
│   │
│   ├── LLM 层
│   │   ├── providers/        # 6个 provider + 工厂 (9个文件)
│   │   │   ├── types.ts           # LlmProvider 接口
│   │   │   ├── openai-compatible.ts # 共享基类 (extraBody + 空正文报错，无 reasoning_content 回退)
│   │   │   ├── anthropic.ts       # Anthropic 独立实现
│   │   │   ├── openai.ts          # OpenAI
│   │   │   ├── github-copilot.ts  # GitHub Copilot
│   │   │   ├── openrouter.ts      # OpenRouter
│   │   │   ├── deepseek.ts        # DeepSeek
│   │   │   ├── volcano.ts         # ★ 火山方舟 Ark (doubao-seed-2.0-pro, thinking 默认关闭)
│   │   │   └── index.ts           # 工厂 + 注册表 (6项)
│   │   ├── report.ts         # callLlm(限流+重试+think剥离) / saveFile / parseLlmJson / autoGenFooter
│   │   └── prompts-data.ts   # 5个 prompt builder (keywords/videos/highlights/weekly/monthly, 纯中文)
│   │
│   ├── 报告层
│   │   ├── report-savers.ts  # 通用 saveHotReport（按 contentType 分流）
│   │   └── github.ts         # Issue 创建/标签/清理（精简版）
│   │
│   ├── 汇总与后处理
│   │   ├── rollup.ts             # 周报/月报
│   │   ├── generate-manifest.ts  # manifest.json + feed.xml
│   │   ├── notify.ts / feishu.ts  # 通知推送 (Telegram / 飞书)
│   │   ├── close-stale-issues.ts  # Issue 清理
│   │   └── weekly.ts / monthly.ts  # 汇总入口脚本
│   │
│   └── __tests__/           # 单元测试
│       └── parse.test.ts
│
├── .github/workflows/       # 4 个 CI/CD 工作流
│   ├── ci.yml               # 质量门禁
│   ├── daily-digest.yml     # 每日日报 (volcano + 飞书 + Telegram)
│   ├── weekly-digest.yml    # 周报 (volcano + 飞书 + Telegram)
│   └── monthly-digest.yml   # 月报 (volcano + 飞书 + Telegram)
│
├── config.yml               # 平台/分区配置
├── digests/                 # 历史报告输出 (git tracked)
│   └── YYYY-MM-DD/          # 每日报告目录
│       ├── ai-douyin.md        # 抖音热搜日报
│       ├── ai-bili.md          # B站热门视频日报
│       ├── ai-bili-music.md    # B站热门音乐日报
│       ├── ai-weekly.md        # 周报
│       ├── ai-monthly.md       # 月报
│       └── highlights.json     # 通知用摘要 (扁平 reportId → 亮点数组)
│
├── index.html               # Web UI (读 manifest.json, 569 行)
├── manifest.json            # Web UI 数据 (git tracked)
├── feed.xml                 # RSS 2.0 订阅源 (git tracked)
├── DEPLOY.md                # ★ 部署与配置指南
├── ARCHITECTURE.md          # 本文档
├── package.json             # 项目配置 + pnpm scripts
├── tsconfig.json            # TypeScript 配置 (ESNext/bundler/strict)
├── eslint.config.js / .prettierrc / vitest.config.ts
├── .env.example             # 环境变量模板 (含 ARK_*)
└── .gitignore               # 忽略 .env / node_modules / dist / recommendations
```

### pnpm scripts 速查

| 脚本 | 命令 | 作用 |
|------|------|------|
| `start` | `tsx src/index.ts` | 生成当日日报 |
| `weekly` / `monthly` | `tsx src/weekly.ts` / `monthly.ts` | 生成周报/月报 |
| `manifest` | `tsx src/generate-manifest.ts` | 生成 manifest.json + feed.xml |
| `notify` / `notify:feishu` | `tsx src/notify.ts` / `feishu.ts` | Telegram / 飞书推送 |
| `close-stale` | `tsx src/close-stale-issues.ts` | 关闭过期 Issue |
| `lint` / `format:check` / `typecheck` / `test` | — | CI 质量门禁 |

---

## 十七、与 agents-radar 的差异对照

### 17.1 删除的模块

| agents-radar 模块 | popular-radar 处理 | 原因 |
|-------------------|-------------------|------|
| 9 个独立 fetcher (github/web/hn/arxiv/hf/devto/lobsters/trending/ph) | **替换**为 1 个 `hot.ts` 通用客户端 | DailyHotApi 统一接口 |
| `prompts.ts` (GitHub 类 prompt) | **删除** | 无 GitHub 仓库跟踪需求 |
| `report-builders.ts` (CLI/OpenClaw 复杂拼装) | **删除** | 无复杂多段报告拼接 |
| 推荐系统 (recommend-runner/candidate/dedup/scorer) | **删除**（config 保留权重占位） | Phase 2 预留 |
| MCP Server (mcp/) / 社媒生成 (social.ts) / `web.ts` | **删除** | 非核心需求 |

### 17.2 简化的模块

| 模块 | agents-radar | popular-radar |
|------|-------------|---------------|
| `index.ts` 主编排 | 6 阶段 | 3 阶段（无交叉对比） |
| `report-savers.ts` | 7 个独立 saver | 1 个通用 `saveHotReport` |
| `github.ts` | issues/PRs/releases 采集 + Issue 管理 | 仅 Issue 管理 |
| `i18n.ts` MSG | 5 条 | 2 条 |
| `report.ts` token 常量 | 4 个 | 2 个（default 4096 / rollup 8192） |

### 17.3 原样/近似复制的模块

- `src/providers/` 的既有 5 个 provider + 基类（`volcano` 为新增）
- `src/date.ts`；`src/rollup.ts` 核心逻辑（改 `ROLLUP_SOURCES`）
- `src/generate-manifest.ts`（改 `REPORT_FILES` / `SITE_URL`）
- `src/notify.ts` / `src/feishu.ts`（改品牌名 / `PAGES_URL`）
- `src/close-stale-issues.ts`；所有配置文件（tsconfig/eslint/prettier/vitest）

### 17.4 popular-radar 新增/独有设计

- **`contentType` 分流**：`HotSource.contentType` 决定 prompt builder，是数据层到报告层的关键桥梁
- **`getReportMeta(source)` 动态元数据**：支持 config.yml 新增非内置数据源自动生成标题
- **`ROLLUP_SOURCES` 动态派生**：从 config 生成汇总源，新增数据源自动纳入周报月报
- **通用 `saveHotReport`**：一个函数处理所有数据源
- **DailyHotApi 客户端多层容错**：HTTP 错误 / 非 JSON / 字段校验 / 超时 / 异常
- **`volcano` provider（火山方舟 Ark）**：接入 doubao-seed 模型，走 `/api/coding/v3` OpenAI 兼容端点，thinking 默认关闭
- **中文单语架构**：不生成英文报告/界面（agents-radar 为双语），LLM 调用量减半
- **思考过程三层防线**：请求关 thinking → 空正文报错（不回退 reasoning_content）→ 输出剥离 think 标签
- **飞书全流水线打通**：日报/周报/月报三条工作流均推送飞书
- **`DEPLOY.md`**：独立的部署与运维指南

---

## 十八、关键设计约定总结

1. **配置驱动** - `config.yml` 控制平台列表，`loadConfig()` 有完整 fallback，新增平台只需加一行
2. **contentType 分流** - `HotSource.contentType` 决定 prompt builder 选择，数据层到报告层的唯一分流器
3. **并发限流不可绕过** - `LLM_CONCURRENCY=5` + 429 指数退避，所有 LLM 调用必须走 `callLlm`
4. **容错降级** - 每个数据源 `.catch()` 返回空数据；saver 错误被捕获返回 `null`；highlights 生成失败只记日志不中断
5. **中文单语** - 所有文案集中在 `i18n.ts`（纯中文字符串）；不生成任何英文报告或界面，禁止让 LLM 做翻译
6. **Provider 安全与可插拔** - 日志只输出 provider 名称，绝不记录 API key/URL；新增后端仅需一个文件加一行注册（如 `volcano`）
7. **跨仓库引用中和** - Issue body 中的 GitHub URL 和 @mention 插入零宽空格
8. **调度错峰** - 日报 00:00 → 周一 01:00 周报 → 1日 02:00 月报，避免 LLM 并发
9. **highlights 合并不覆盖** - 周报月报的 highlights 合并到已有 `highlights.json`，不覆盖日报 highlights
10. **动态汇总源** - `ROLLUP_SOURCES` 从 config 派生，新增数据源自动纳入周报月报
11. **通知静默降级** - Telegram/飞书在对应 secret 未配置时静默跳过，且都有 direct-run guard 防误发
12. **多渠道一致性** - 日报/周报/月报三条流水线的飞书与 Telegram 推送行为对齐
13. **思考过程零泄漏** - volcano 请求默认 `thinking: disabled`；基类空正文直接报错、绝不回退 `reasoning_content`；`callLlm` 统一剥离 `<think>` 标签——报告里只允许出现最终结论
```