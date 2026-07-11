# popular-radar 架构详解

> 本文档详细梳理 popular-radar 项目的完整架构，涵盖每个功能模块的实现细节、核心逻辑与模块联动关系。
> 每个功能先以一句话总结，再分点展开具体功能、实现方式和模块联动。
> 项目架构移植自 agents-radar，但数据采集层和报告类型完全针对短视频/内容平台热点重写。

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
- [九、双语国际化系统](#九双语国际化系统-srci18nts)
- [十、周报月报汇总系统](#十周报月报汇总系统-srcrollupts)
- [十一、通知推送系统](#十一通知推送系统)
- [十二、Web UI 与 RSS](#十二web-ui-与-rss-srcgenerate-manifestts--indexhtml)
- [十三、GitHub Actions 工作流](#十三github-actions-工作流)
- [十四、辅助工具模块](#十四辅助工具模块)
- [十五、项目文件全景](#十五项目文件全景)
- [十六、与 agents-radar 的差异对照](#十六与-agents-radar-的差异对照)

---

## 一、项目总览

**popular-radar 是一个短视频/内容平台热点日报自动生成系统，通过 GitHub Actions 每天定时从抖音、B站等平台聚合热搜词和热门视频，经 LLM 分析后生成中英双语日报，以 GitHub Issues + Markdown 文件 + Web UI + RSS + Telegram/飞书通知等多种方式发布。**

### 核心功能

- **每日日报**：从抖音热搜、B站热门视频、B站热门音乐 3 类数据源采集数据，LLM 生成 3 种类型的中英双语报告
- **周报月报**：基于日报自动汇总生成周报（每周一）和月报（每月1日）
- **多渠道分发**：GitHub Issues、Telegram、飞书、Web UI、RSS
- **配置驱动**：通过 `config.yml` 控制跟踪的平台/分区列表，新增平台只需加一行配置

### 技术栈

- **语言**：TypeScript（ESM，`"type": "module"`），Node 22，tsx 运行时
- **包管理**：pnpm 9.15.9
- **LLM SDK**：`@anthropic-ai/sdk` + `openai` SDK
- **测试**：Vitest 4
- **代码质量**：ESLint 9 + Prettier 3 + Husky 9（pre-commit hook）
- **部署**：GitHub Actions + GitHub Pages
- **数据源**：imsyy/DailyHotApi 自部署实例（Vercel/Cloudflare）

### 与 agents-radar 的关系

popular-radar **移植自 agents-radar** 的架构和约 70% 的代码（LLM provider 抽象层、调用基础设施、rollup、manifest、通知推送模块），但：

- 数据采集层从 9 个独立 fetcher 简化为 **1 个通用客户端**（`hot.ts`）
- 报告类型从 9 种 AI 报告替换为 **3 种短视频热点报告**
- 删除了 CLI/OpenClaw 复杂报告、推荐系统、MCP Server、社媒生成等非核心模块
- 完全独立部署，与 agents-radar 互不干扰

### 三阶段流水线

整个日报生成流水线在 `src/index.ts` 的 `main()` 函数中编排，分为 3 个阶段：

1. **Phase 1 - 数据采集**（`fetchAllHotData`）：3 类数据源并行 fetch，每个都 `.catch()` 容错
2. **Phase 2 - 报告生成**：中英双语 × 3 源 = 6 份报告并行生成（LLM 摘要 + 文件保存 + Issue 创建）
3. **Phase 3 - Highlights 生成**：从报告中提取要点，供 Telegram/飞书通知使用

> 相比 agents-radar 的 6 阶段，popular-radar 精简为 3 阶段：无独立的交叉对比阶段，无跨平台对比（数据源结构差异大），highlights 直接在主流程末尾生成。

---

## 二、核心编排引擎 (`src/index.ts`)

**`index.ts` 是整个日报流水线的编排中枢，定义了 3 个阶段和 `main()` 入口，协调数据采集、报告生成、highlights 提取的完整流程。**

### 具体功能与实现

#### `main()` - 主入口（第 39-93 行）

- **功能**：编排完整的日报生成流程
- **实现**：
  1. `requireEnv("GITHUB_TOKEN")` 强制校验 GitHub Token
  2. 计算 `dateStr`（CST 日期，如 `"2026-07-11"`）和 `utcStr`（紧凑 UTC，如 `"2026-07-11 00:00"`）
  3. 读取 `digestRepo` 环境变量（控制是否创建 Issue）
  4. 日志输出 provider 名称（**绝不记录 API key**）
  5. 调用三个阶段函数
- **联动模块**：`config.ts`（`loadConfig`）、`hot.ts`（`fetchAllHotData`）、`report-savers.ts`（`saveHotReport`）、`report.ts`（`callLlm`/`parseLlmJson`/`saveFile`/`autoGenFooter`）、`prompts-data.ts`（`buildHighlightsPrompt`）、`date.ts`

#### Phase 1 - 并行数据采集（第 52-55 行）

```typescript
console.log("  Fetching hot data in parallel...");
const allHotData = await fetchAllHotData(HOT_SOURCES);
```

- **功能**：一次性并行采集所有 3 类数据源
- **实现**：调用 `fetchAllHotData(sources)`，内部用 `Promise.all` 并行，每个源有 `.catch()` 兜底
- **容错设计**：单个源失败返回 `{ fetchSuccess: false, items: [] }`，不影响整体流程
- **联动模块**：`hot.ts`

#### Phase 2 - 双语报告并行生成（第 57-68 行）

```typescript
const reportContents: Record<Lang, Record<string, string>> = { zh: {}, en: {} };
const savePromises: Promise<void>[] = [];
for (const lang of ["zh", "en"] as const) {
  const footer = autoGenFooter(lang);
  for (const data of allHotData) {
    savePromises.push(/* saveHotReport → 收集 content */);
  }
}
await Promise.all(savePromises);
```

- **功能**：中英双语 × 3 源 = 6 份报告**全部并行**生成
- **实现**：双重循环生成 6 个 Promise，一次性 `Promise.all` 等待全部完成
- **内容收集**：成功生成的报告内容存入 `reportContents[lang][reportId]`，供 highlights 使用
- **联动模块**：`report-savers.ts`（`saveHotReport`）、`report.ts`（`autoGenFooter`）

> **设计亮点**：相比 agents-radar 分阶段先摘要再保存，popular-radar 将摘要+保存+Issue 创建合并到 `saveHotReport` 一步完成，因为报告结构更简单（无跨工具对比拼接）。

#### Phase 3 - Highlights 生成（第 70-89 行）

```typescript
const [zhRes, enRes] = await Promise.allSettled([
  callLlm(buildHighlightsPrompt(reportContents.zh, "zh"), 2048),
  callLlm(buildHighlightsPrompt(reportContents.en, "en"), 2048),
]);
```

- **功能**：从所有报告中提取要点，供 Telegram/飞书通知使用
- **实现**：
  - `Promise.allSettled` 中英并行（一个失败不影响另一个）
  - `parseLlmJson` 容错解析（去除 fence、替换控制字符、修复 JSON）
  - 写入 `highlights.json`
- **联动模块**：`prompts-data.ts`（`buildHighlightsPrompt`）、`report.ts`（`callLlm`/`parseLlmJson`/`saveFile`）

#### 模块级配置加载（第 27-31 行）

```typescript
const { hotSources: HOT_SOURCES } = loadConfig();
```

- **功能**：在模块加载时读取 `config.yml`，获取跟踪的平台列表
- **设计**：模块级单例，整个进程生命周期内复用

#### 入口执行（第 95-99 行）

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
  - `recommend`：推荐系统配置（预留，Phase 2 启用，含 `top_k` 和三因子权重）
- **Phase 1 默认配置**：3 个源--抖音热搜、B站热门视频、B站热门音乐

#### `loadConfig(configPath)` - 配置加载器（第 113-163 行）

- **功能**：读取并解析 `config.yml`，返回类型安全的 `PopularRadarConfig` 对象
- **实现**：
  - 用 `js-yaml` 解析 YAML
  - 文件缺失时返回完整默认值（内置 3 个数据源）
  - 逐字段 fallback：如果 `hot_sources` 存在但某条目字段缺失，使用默认值
  - `toHotSource(raw)` 规范化原始条目，处理可选的 `type` 字段和 `contentType` 枚举校验
- **日志**：输出加载数据源数量和 recommend topK
- **联动模块**：被 `index.ts`（模块级加载）和 `rollup.ts`（动态派生 ROLLUP_SOURCES）调用

#### `HotSource` 类型

- **结构**：`{ id, platform, name, type?, limit, contentType }`
- **`type` 字段的作用**：作为 DailyHotApi 的 `?type=` 查询参数，用于选择分区（如 B站 `type=3` 选音乐排行榜）
- **`contentType` 字段的作用**：决定使用哪个 prompt builder（`buildKeywordsPrompt` vs `buildVideosPrompt`），是报告生成层的关键分流器

#### `ContentType` 类型

- `"keywords" | "videos"`
- **`keywords`**：数据是热搜词（如抖音热搜），无封面/作者，只有标题+热度+链接
- **`videos`**：数据是视频/内容（如B站），有封面/作者/播放量

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
- **`fetchSuccess` 字段**：所有 fetcher 的通用容错契约，下游 saver 据此决定是否跳过报告生成

#### `parseHot(raw)` - 热度值解析（第 82-88 行）

- **功能**：将 DailyHotApi 返回的 `hot` 字段统一解析为 number
- **实现**：
  - `number` 直接返回
  - `string` 去除逗号和空格后转 number（处理 `"12,345"` 这种格式）
  - `undefined`/`null` 返回 `undefined`
  - 非数字字符串返回 `undefined`
- **设计原因**：DailyHotApi 的 `hot` 字段类型不一致--GitHub trending 是字符串 `"12,345"`，多数平台是 number，微博是 `undefined`

#### `toItem(raw)` - 数据映射（第 90-104 行）

- **功能**：将 DailyHotApi 的 `ApiListItem` 映射为内部的 `HotItem`
- **实现**：
  - `id` 转为 `String`（原始可能是 number 或 string）
  - 只填充存在的可选字段（用 `if (raw.cover)` 判断），避免 undefined 污染
  - 调用 `parseHot` 统一热度值
- **设计**：保守映射，只复制确定有值的字段

#### `fetchHotData(source)` - 单源采集（第 113-160 行）

- **功能**：从 DailyHotApi 获取单个数据源的热点数据
- **实现**：
  1. 读取 `DAILYHOT_BASE_URL` 环境变量，去除尾部斜杠（默认公共实例）
  2. 构建 `URLSearchParams`：`cache=false`（强制刷新）+ `limit=N`
  3. 如果 `source.type` 存在，附加 `type` 参数（B站分区选择）
  4. `fetch` 带 15 秒超时（`AbortController` + `setTimeout`）
  5. **多层容错**：
     - HTTP 非 2xx → 返回空数据 + `fetchSuccess: false`
     - 响应非 JSON（DailyHotApi 上游失败时返回 HTML 错误页）→ 返回空数据
     - `code !== 200` 或 `data` 非数组 → 返回空数据
     - 任何异常 → `.catch()` 返回空数据
  6. 成功时映射所有 items，`fetchSuccess` = items 非空
- **容错设计**：任何失败路径都返回 `{ source, items: [], fetchSuccess: false }`，保证调用方不会因单源崩溃
- **联动模块**：被 `fetchAllHotData` 调用

#### `fetchAllHotData(sources)` - 并行采集（第 163-167 行）

- **功能**：并行采集所有配置的数据源
- **实现**：`Promise.all(sources.map(fetchHotData.catch(...)))`
- **双重容错**：`fetchHotData` 内部已有 try-catch，外层再加 `.catch()` 兜底（防御性编程）
- **联动模块**：被 `index.ts` 的 Phase 1 调用

### 常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `DEFAULT_BASE_URL` | `https://api-hot.imsyy.top` | 公共演示实例（生产应自部署） |
| `FETCH_TIMEOUT_MS` | `15_000` | 单请求 15 秒超时 |

---

## 五、LLM Provider 抽象层 (`src/providers/`)

**Provider 抽象层通过 `LlmProvider` 接口统一 5 种 LLM 后端（Anthropic、OpenAI、GitHub Copilot、OpenRouter、DeepSeek），工厂模式按环境变量选择，新增 provider 只需一个文件加一行注册。此模块从 agents-radar 原样复制，未做任何修改。**

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
       └─ DeepSeekProvider
```

### 具体功能

#### `types.ts` - 接口定义

- **`LlmProvider` 接口**：`{ readonly name: string; call(prompt, maxTokens): Promise<string> }`
- **`ProviderFactory` 类型**：`() => LlmProvider`，零参数工厂函数
- 无 SDK 依赖，是整个代码库的 provider 无关契约

#### `openai-compatible.ts` - 共享基类

- **功能**：为所有 OpenAI API 兼容的 provider 提供共享实现
- **实现**：
  - 构造函数接收 `{ apiKey?, baseURL?, model }`，实例化 `new OpenAI({ apiKey, baseURL })`
  - `call()` 调用 `client.chat.completions.create()`，使用 `max_completion_tokens`（OpenAI 新参数名）
  - **`reasoning_content` 回退**：优先取 `message.content`，为空时回退到 `reasoning_content`（支持"思考"模型）

#### `anthropic.ts` - Anthropic 独立实现

- **功能**：直接使用 `@anthropic-ai/sdk`，不继承 OpenAI 兼容基类
- **原因**：Anthropic Messages API 返回内容块数组（`type === "text"`），与 OpenAI 的 `choices` 数组结构不同
- **默认模型**：`claude-sonnet-4-6`（可通过 `ANTHROPIC_MODEL` 覆盖）

#### 4 个 OpenAI 兼容子类

| Provider | 文件 | 默认模型 | baseURL | 环境变量 |
|----------|------|---------|---------|---------|
| OpenAIProvider | `openai.ts` | `gpt-4o` | 可覆盖 | `OPENAI_API_KEY` |
| GitHubCopilotProvider | `github-copilot.ts` | `gpt-4o` | 固定 `models.github.ai/inference` | `GITHUB_TOKEN` |
| OpenRouterProvider | `openrouter.ts` | `anthropic/claude-sonnet-4` | 固定 `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| DeepSeekProvider | `deepseek.ts` | `deepseek-chat` | 固定 `api.deepseek.com` | `DEEPSEEK_API_KEY` |

#### `index.ts` - 工厂与注册表

- **`PROVIDERS` 注册表**：`Record<string, ProviderFactory>`，用 `satisfies` 确保类型安全
- **`createProvider(name?)`**：解析 `LLM_PROVIDER` 环境变量（默认 `"anthropic"`），查找工厂函数，返回实例
- **日志安全**：只输出 provider 名称，**绝不记录 API key 或 URL**

---

## 六、LLM 调用基础设施 (`src/report.ts`)

**`report.ts` 是 LLM 调用的基础设施层，提供并发限流（5）、429 自动重试（指数退避）、JSON 容错解析、文件写入等核心工具，所有报告生成器都依赖此模块。从 agents-radar 移植，仅修改了 `autoGenFooter` 的品牌文本。**

### 具体功能

#### `callLlm(prompt, maxTokens)` - 核心调用入口（第 50-80 行）

- **功能**：所有 LLM 调用的唯一入口，内置并发限流和重试
- **并发限流**：
  - `LLM_CONCURRENCY = 5`，通过 `llmSlots` 计数器 + `llmQueue` FIFO 队列实现
  - `acquireSlot()`：有空闲槽位直接获取，否则入队等待
  - `releaseSlot()`：唤醒队首等待者，否则归还槽位
  - 设计目的：防止大量并行 LLM 调用触发 429 限流
- **429 重试**：
  - `MAX_RETRIES = 3`，指数退避 `5s / 10s / 20s`（`RETRY_BASE_MS = 5000`）
  - 重试前释放并发槽位（让其他调用继续），等待后重新获取
  - `is429(err)` 检查 `.status === 429` 或错误信息包含 "429"
- **Provider 实例化**：模块加载时创建单例 `const provider = createProvider()`
- **联动**：被 `index.ts`、`report-savers.ts`、`rollup.ts` 调用

#### `parseLlmJson<T>(raw)` - 容错 JSON 解析（第 92-127 行）

- **功能**：解析 LLM 返回的 JSON，容忍常见格式缺陷
- **实现**：
  1. 去除 markdown code fence（` ```json ` 和 ` ``` `）
  2. 替换 ASCII 控制字符（U+0000–U+001F）为空格
  3. 尝试 `JSON.parse`
  4. 失败时调用 `repairJson` 修复后重试
- **`repairJson(s)`**：
  - 缩窄到最外层 `{`/`[` 块（去除周围散文）
  - 移除 `}`/`]` 前的尾逗号
- **设计目的**：单个杂散字符不应导致整个语言的 `highlights.json` 被清空
- **联动**：被 `index.ts`（highlights 解析）、`rollup.ts`（rollup highlights 解析）调用

#### `saveFile(content, ...segments)` - 文件写入（第 138-143 行）

- **功能**：将内容写入 `digests/<segments>`，自动创建父目录
- **实现**：`fs.mkdirSync(recursive: true)` + `fs.writeFileSync`
- **联动**：被所有报告生成器、`rollup.ts` 调用

#### `autoGenFooter(lang)` - 自动生成页脚（第 145-149 行）

- **功能**：生成"由 popular-radar 自动生成"的 Markdown 页脚
- **实现**：读取 `DIGEST_REPO` 环境变量，未设置时返回空字符串
- **与 agents-radar 的差异**：品牌文本从 "agents-radar" 改为 "popular-radar"
- **联动**：被所有报告生成器调用，页脚文本来自 `i18n.ts`

#### Token 预算常量

| 常量 | 值 | 使用场景 |
|------|-----|---------|
| `LLM_TOKENS_DEFAULT` | 4096 | 所有日报 |
| `LLM_TOKENS_ROLLUP` | 8192 | 周报/月报 |

> 相比 agents-radar，删除了 `LLM_TOKENS_TRENDING`（6144）和 `LLM_TOKENS_WEB`（8192），因为 popular-radar 没有这两个报告类型。

---

## 七、Prompt 构建层 (`src/prompts-data.ts`)

**Prompt 构建层为所有报告类型构建 LLM prompt，包含两个数据源 prompt builder（按 contentType 分流）和三个汇总 prompt builder。所有 builder 返回纯字符串，无 LLM 调用，可独立测试。**

### 7.1 `buildKeywordsPrompt` - 热搜词 prompt（第 17-84 行）

- **功能**：为热搜词类数据源（抖音）构建 LLM prompt
- **数据格式化**：每条渲染为 `序号. **词** \n 🔗 链接 \n 🔥 热度`，用 `map(...).join("\n\n")` 拼接
- **请求输出**：4 节结构
  1. **今日速览** - 3-5 句概括
  2. **热门搜索词** - 精选 10-15 个，每个含词+链接+热度+一句话说明
  3. **趋势信号分析** - 100-200 字，按领域（科技/社会/娱乐/消费）分析
  4. **值得关注** - 2-3 个值得深挖的搜索词
- **双语**：`lang === "en"` 三元分支，中英各一套完整 prompt
- **联动**：被 `report-savers.ts` 的 `saveHotReport`（当 `contentType === "keywords"`）调用

### 7.2 `buildVideosPrompt` - 视频内容 prompt（第 90-171 行）

- **功能**：为视频/内容类数据源（B站热门/B站音乐）构建 LLM prompt
- **数据格式化**：每条渲染为 `序号. **标题** | UP主 | 播放量 \n 🔗 链接`，比 keywords prompt 多了 author 和 hot 字段
- **请求输出**：4 节结构
  1. **今日速览** - 3-5 句概括
  2. **热门内容** - 按 4 个分类组织：📚知识科技 / 🎬娱乐 / 🎵音乐表演 / 🏠生活
  3. **流量信号分析** - 100-200 字，分析爆款内容和新锐创作者
  4. **值得一看** - 2-3 个最值得深入观看的内容
- **双语**：中英各一套
- **联动**：被 `report-savers.ts` 的 `saveHotReport`（当 `contentType === "videos"`）调用

### 7.3 `buildHighlightsPrompt` - Highlights 提取 prompt（第 181-227 行）

- **功能**：从报告内容中提取结构化要点，返回 JSON
- **输入**：`Record<string, string>`（reportId -> 报告内容，每条截断 2000 字符）
- **输出格式**：`{"ai-douyin":["亮点1",...], "ai-bili":[...]}`
- **约束**：每条 highlight ≤ 60 字符（en）/ ≤ 30 字符（zh），每报告 6 条
- **返回纯 JSON**（无 markdown fence）
- **联动**：被 `index.ts` Phase 3 和 `rollup.ts` 调用

#### `ReportHighlights` 类型（第 177-179 行）

- **结构**：`Record<string, string[]>`（reportId -> highlight 数组）
- **联动**：被 `index.ts`、`rollup.ts`、`notify.ts`、`feishu.ts` 使用

### 7.4 `buildWeeklyPrompt` - 周报 prompt（第 233-277 行）

- **功能**：将 7 天日报内容传入 LLM，生成周报
- **请求输出**：6 节（本周要闻、抖音搜索趋势、B站内容亮点、跨平台信号、创作者聚焦、下周信号）
- **联动**：被 `rollup.ts` 的 `runWeeklyRollup` 调用

### 7.5 `buildMonthlyPrompt` - 月报 prompt（第 283-327 行）

- **功能**：将上月报告传入 LLM，生成月报
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

### 具体功能

#### `saveHotReport(data, utcStr, dateStr, digestRepo, footer, lang)` - 通用报告生成器（第 22-82 行）

- **功能**：生成并保存单个数据源的日报报告
- **实现**（7 步模式）：

  1. **Guard 检查**（第 36-39 行）：`!data.fetchSuccess || data.items.length === 0` 时跳过，日志 "No data available"
  2. **LLM 调用**（第 44-49 行）：
     ```typescript
     const prompt = data.source.contentType === "keywords"
       ? buildKeywordsPrompt(data, dateStr, lang)
       : buildVideosPrompt(data, dateStr, lang);
     const summary = await callLlm(prompt);
     ```
     按 `contentType` 分流选择 prompt builder
  3. **文件命名**（第 51-52 行）：`ai-<id>.md`（zh）或 `ai-<id>-en.md`（en）
  4. **Header 构建**（第 55-63 行）：i18n 标题 + 数据源名 + 条数 + 生成时间，双语三元
  5. **保存**（第 66 行）：`saveFile(header + summary + footer, dateStr, fileName)`
  6. **Issue 创建**（第 69-75 行）：`digestRepo` 存在时调用 `createGitHubIssue`
  7. **容错**（第 77-80 行）：错误被 `console.error` 捕获，返回 `null`，不崩溃主流程

- **返回值**：成功返回报告内容字符串（供 highlights 使用），失败/跳过返回 `null`
- **联动模块**：`prompts-data.ts`（`buildKeywordsPrompt`/`buildVideosPrompt`）、`report.ts`（`callLlm`/`saveFile`）、`github.ts`（`createGitHubIssue`）、`i18n.ts`（`getReportMeta`/`ISSUE_LABELS`）

#### Header 格式

```
# {TITLE} {dateStr}

> 数据来源: {source.name} | 共 {count} 条 | 生成时间: {utcStr} UTC

---

{LLM 摘要}

{footer}
```

---

## 九、双语国际化系统 (`src/i18n.ts`)

**`i18n.ts` 是所有用户可见双语字符串的唯一来源，通过 `Lang` 类型和 `Record<Lang, string>` 约束，禁止在其他文件中内联双语三元表达式。**

### 具体功能

#### 核心类型与工具

- **`Lang` 类型**：`"zh" | "en"`，整个代码库的语言类型
- **`t(zh, en)` 辅助函数**：返回 `{ zh, en }` 对象，每个常量一次定义双语版本

#### 状态消息 (`MSG`)

- `noData`：数据获取失败消息
- `summaryFailed`：摘要生成失败消息

> 相比 agents-radar 的 5 条 MSG，popular-radar 精简为 2 条（无 skills/trending 专用消息）。

#### 报告标签对象

Phase 1 三个报告类型，每个含 `title: t(zh, en)` + `issueTitle(dateStr, lang)`：

| 对象 | emoji | 中文标题 | 英文标题 |
|------|-------|---------|---------|
| `DOUYIN_REPORT` | 🔥 | 抖音热搜日报 | Douyin Hot Search Digest |
| `BILI_REPORT` | 📺 | B站热门视频日报 | Bilibili Trending Videos Digest |
| `BILI_MUSIC_REPORT` | 🎵 | B站热门音乐日报 | Bilibili Trending Music Digest |

周报月报：
- `WEEKLY_REPORT`：`title` + `coverage` + `issueTitle(weekStr)`
- `MONTHLY_REPORT`：`title` + `issueTitle(monthStr)`

#### `getReportMeta(source)` - 动态报告元数据（第 62-82 行）

- **功能**：根据 source id 返回对应的报告元数据（title + issueTitle）
- **实现**：内置 `REPORT_META_BY_ID` 映射表查找，未命中时用 `source.name` 生成 fallback meta
- **设计目的**：支持 config.yml 新增非内置数据源（如快手），自动生成报告标题
- **联动**：被 `report-savers.ts` 调用

#### `ISSUE_LABELS` - GitHub Issue 标签

- 每种报告类型一个标签，中英各一个（如 `douyin: { zh: "douyin", en: "douyin-en" }`）
- **类型**：`Record<string, Record<Lang, string>>`（非 `as const`，允许动态 key 访问）
- **联动**：被 `report-savers.ts` 调用

#### `REPORT_LABELS` - manifest/RSS 标签

- `Record<string, string>`，slug → 显示标题
- 包含 3 个报告 × 2 语言 + 周报月报 × 2 语言 = 10 个条目
- **联动**：被 `generate-manifest.ts` 调用

#### `NOTIFY_LABELS` - 通知短标签

- `Record<string, Record<Lang, string>>`，slug → 双语短标签
- **联动**：被 `notify.ts`、`feishu.ts` 调用

#### `FOOTER`

- `autoGen: t("本日报由", "This digest is auto-generated by")`
- 被 `report.ts` 的 `autoGenFooter` 使用

---

## 十、周报月报汇总系统 (`src/rollup.ts`)

**`rollup.ts` 读取已保存的日报文件（不重新 fetch 数据），通过 LLM 生成周报和月报，并维护合并的 highlights.json。从 agents-radar 移植，核心逻辑相同，但 `ROLLUP_SOURCES` 改为从 config 动态派生。**

### 具体功能

#### `ROLLUP_SOURCES` - 动态汇总源（第 26 行）

```typescript
const { hotSources: HOT_SOURCES } = loadConfig();
const ROLLUP_SOURCES = HOT_SOURCES.map((s) => `ai-${s.id}`);
```

- **功能**：汇总报告要读取的日报文件列表
- **设计**：从 config.yml 动态派生，新增数据源自动纳入汇总（agents-radar 是硬编码 5 个）
- **联动**：被 `readDailyDigest` 使用

#### `getDateDirs()` / `readDailyDigest(date)` / `readWeeklyDigest(date)` - 文件读取辅助

- `getDateDirs()`：列出 `digests/` 下匹配 `YYYY-MM-DD` 的目录，降序排列
- `readDailyDigest(date)`：拼接该日所有日报（ROLLUP_SOURCES），每类截断 2500 字符
- `readWeeklyDigest(date)`：读取周报，截断 3000 字符

#### `toWeekStr(date)` - ISO 周字符串

- **功能**：计算 ISO 周字符串（如 `"2026-W28"`），使用"第一个星期四"规则

#### `generateRollupHighlights(zhContent, enContent, reportId, dateStr, itemsPerReport)` - Highlights 合并

- **功能**：为周报/月报生成 highlights，**合并**到已有 `highlights.json`（不覆盖日报 highlights）
- **实现**：`Promise.allSettled` 中英并行（一个语言失败不影响另一个），`parseLlmJson` 解析，`Object.assign` 合并
- **设计**：读取已有 highlights → spread 复制 → 合并新 key → 写回，保证日报 highlights 不丢失

#### `runWeeklyRollup()` - 周报生成

- **功能**：基于近 7 天日报生成周报（中英双语）
- **实现**：
  1. 计算 `weekStr`（ISO 周）和 `dateStr`（CST）
  2. `getDateDirs()` 取近 7 个日期目录
  3. `readDailyDigest(date)` 拼接每日报告
  4. 中英并行 `callLlm(buildWeeklyPrompt(...), LLM_TOKENS_ROLLUP)`
  5. 保存 `ai-weekly.md` / `ai-weekly-en.md` 到当日目录
  6. 生成 highlights（合并到已有）
  7. 创建 GitHub Issue
- **联动**：`prompts-data.ts`、`report.ts`、`github.ts`、`i18n.ts`

#### `runMonthlyRollup()` - 月报生成

- **功能**：基于上月报告生成月报（中英双语）
- **实现**：
  1. 覆盖**上个月**（`cstDate.getUTCMonth() - 1`）
  2. 源选择：上月有 ≥2 期周报 → 用周报（优先）；否则每 4 天采样 1 天日报（最多 10 天）
  3. 中英并行 `callLlm(buildMonthlyPrompt(...), LLM_TOKENS_ROLLUP)`
  4. 保存 `ai-monthly.md` / `ai-monthly-en.md`
  5. 生成 highlights
  6. 创建 GitHub Issue

---

## 十一、通知推送系统

**通知系统包含两个平行模块：`notify.ts`（Telegram，HTML 格式）和 `feishu.ts`（飞书，Markdown 卡片），都从 manifest.json 读取最新报告列表，附加 highlights 摘要后推送。从 agents-radar 移植，仅改品牌名和 PAGES_URL 默认值。**

### 11.1 `src/notify.ts` - Telegram 通知

**`notify.ts` 构建 HTML 格式的 Telegram 消息，列出当日所有报告的链接和 highlights 摘要，通过 Bot API 推送。**

#### 具体功能

**`buildMessage(date, reports, pagesUrl?, highlights?)` - 消息构建**
- 遍历报告类型，中英配对显示链接
- 日报在前，周报/月报在后
- 图标区分：📡 日报 / 📅 周报 / 📆 月报
- 附带 Web UI + RSS 链接
- highlights 作为摘要附加（`escapeHtml` 转义）
- 联动：从 `manifest.json` 读取最新日期和报告列表

**`sendTelegram(text)` - 发送**
- `POST https://api.telegram.org/bot{TOKEN}/sendMessage`，`parse_mode: "HTML"`
- 跳过条件：`TELEGRAM_BOT_TOKEN` 未设置

**`main()` - 主流程**
- 读 `manifest.json` 取最新日期
- 加载 `digests/{date}/highlights.json`
- 构建 + 发送
- direct-run guard 防止导入时误触发

### 11.2 `src/feishu.ts` - 飞书通知

**`feishu.ts` 构建 Markdown 格式的飞书卡片消息，支持多 webhook 扇出推送，容忍部分失败。**

#### 具体功能

**`buildFeishuMessage(date, reports, pagesUrl?, highlights?)`**
- 与 Telegram 相同的报告列表 + highlights 逻辑，但使用 `[label](url)` Markdown 链接语法

**`getWebhookUrls()`**
- 读取 `FEISHU_WEBHOOK_URLS`（逗号分隔，多 webhook）
- 回退：支持旧的单个 `FEISHU_WEBHOOK_URL`

**`sendFeishu(title, content)`**
- `POST` interactive card JSON（`msg_type: "interactive"`，蓝色标题模板）
- `Promise.allSettled` 多 webhook 扇出，全部失败才抛错

#### 共同设计

- 两者都有 direct-run guard
- 两者都读 `manifest.json` 找最新日期
- 两者都可选加载 `highlights.json`
- 两者在 secret 未设置时静默跳过

---

## 十二、Web UI 与 RSS (`src/generate-manifest.ts` + `index.html`)

**`generate-manifest.ts` 扫描所有已生成的日报，生成 `manifest.json`（Web UI 侧边栏数据）和 `feed.xml`（RSS 2.0 订阅源），`index.html` 读取 manifest 构建前端界面。从 agents-radar 移植，改 REPORT_FILES 列表和 SITE_URL。**

### 12.1 `src/generate-manifest.ts`

**`generate-manifest.ts` 是后处理层，在所有报告生成后运行，扫描 `digests/` 目录生成 manifest.json 和 feed.xml。**

#### 具体功能

**`main()` - 生成 manifest + feed**
1. 扫描 `digests/` 下日期目录，过滤有报告的目录，降序排列
2. 写入 `manifest.json`：`{ generated, dates: [{date, reports}] }`
3. 构建 RSS feed：遍历条目（最新优先），最多 30 条
4. 每条 `<item>`：title、link、guid、pubDate（RFC 822）、description（≤500字摘要）、content:encoded（CDATA 全文 HTML）
5. 写入 `feed.xml`（完整 RSS 2.0 文档）

**`getReportContent(date, report)` - 报告内容提取**
- `marked.parse` 转 HTML → 去标签提取 ≤500 字符纯文本摘要 → 全文 HTML 包裹 CDATA
- 处理 `]]>` 序列防注入

#### 常量

- `REPORT_FILES`：10 个报告 ID（3 报告 × 2 语言 + 周月报 × 2 语言）
- `MAX_FEED_ITEMS = 30`
- `SITE_URL`：GitHub Pages 地址

### 12.2 `index.html` - Web UI

**`index.html` 是单页应用，读取 `manifest.json` 构建侧边栏，按需 fetch 报告 Markdown 渲染。**

- 深色/浅色主题切换
- 侧边栏：按月分组 → 日期 → 报告类型三级折叠
- 中英切换按钮（有双版本的报告显示 ZH/EN 切换）
- 全文搜索：建立所有报告的索引，按日期高亮匹配
- 报告 Markdown 通过 `marked` 渲染 + `DOMPurify` 消毒
- `LABELS` 对象与 `i18n.ts` 的 `REPORT_LABELS` 保持同步
- 移动端适配：侧边栏折叠为顶部菜单

---

## 十三、GitHub Actions 工作流

**项目有 4 个 GitHub Actions 工作流，覆盖 CI 质量门禁、每日日报、周报、月报，刻意错峰调度避免 LLM 并发冲突。**

### 13.1 `ci.yml` - CI 质量门禁

- **触发**：push 到 master/main + 所有 pull_request
- **步骤**：`pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`
- **不提交**：只做检查，无产物

### 13.2 `daily-digest.yml` - 每日日报（主流程）

- **调度**：`cron: "0 0 * * *"`（UTC 00:00 = CST 08:00）+ `workflow_dispatch`
- **权限**：`contents: write` + `issues: write`
- **超时**：20 分钟
- **步骤序列**：
  1. Checkout + pnpm v4 + Node 22 + install
  2. `pnpm start`（环境变量：`GITHUB_TOKEN`、`LLM_PROVIDER=anthropic`、`ANTHROPIC_API_KEY`、`DAILYHOT_BASE_URL`、`DIGEST_REPO`）
  3. Commit digest files
  4. `pnpm manifest`
  5. Commit manifest and feed
  6. `pnpm notify`（Telegram）
  7. `pnpm notify:feishu`（飞书）
  8. `pnpm close-stale`

### 13.3 `weekly-digest.yml` - 周报

- **调度**：`cron: "0 1 * * 1"`（UTC 周一 01:00 = CST 09:00）+ `workflow_dispatch`
- **步骤**：`pnpm weekly` → Commit → `pnpm manifest` → Commit → `pnpm notify`

### 13.4 `monthly-digest.yml` - 月报

- **调度**：`cron: "0 2 1 * *"`（UTC 每月1日 02:00 = CST 10:00）+ `workflow_dispatch`
- **步骤**：`pnpm monthly` → Commit → `pnpm manifest` → Commit → `pnpm notify`

### 调度错峰设计

| 时间(UTC) | CST | 工作流 |
|-----------|-----|--------|
| 00:00 | 08:00 | 每日日报 |
| 01:00 周一 | 09:00 周一 | 周报 |
| 02:00 每月1日 | 10:00 每月1日 | 月报 |

---

## 十四、辅助工具模块

### 14.1 `src/date.ts` - 日期工具

**`date.ts` 提供 CST/UTC 日期格式化和 sleep 工具。从 agents-radar 原样复制。**

- **`toCstDateStr(date)`**：加 8 小时偏移后取 ISO 日期（如 `"2026-07-11"`）
- **`toUtcStr(date)`**：格式化为紧凑 UTC（如 `"2026-07-11 00:00"`）
- **`sleep(ms)`**：Promise 延迟
- **联动**：被几乎所有异步模块使用

### 14.2 `src/close-stale-issues.ts` - 过期 Issue 清理

**`close-stale-issues.ts` 是独立运行的 Issue 清理脚本，关闭 7 天前的开放 Issue。**

- `STALE_DAYS = 7`
- 调用 `github.ts` 的 `closeStaleIssues(7)`
- 被 `pnpm close-stale` 调用

### 14.3 `src/weekly.ts` / `src/monthly.ts` - 汇总入口脚本

- **`weekly.ts`**：调用 `rollup.ts` 的 `runWeeklyRollup()`
- **`monthly.ts`**：调用 `rollup.ts` 的 `runMonthlyRollup()`
- 被 `pnpm weekly` / `pnpm monthly` 调用

### 14.4 `src/github.ts` - GitHub Issue 管理（精简版）

**`github.ts` 从 agents-radar 精简而来，仅保留 Issue 创建/标签管理/过期清理功能，删除了 issues/PRs/releases 采集功能。**

#### 具体功能

**`createGitHubIssue(title, body, label)` - 创建 Issue**
- `neutralizeGitHubRefs`：在 `github.com` URL 和 `@mention` 中插入零宽空格，防止跨仓库通知
- Body 截断到 65536 字符
- `ensureLabel` 确保标签存在
- `POST /repos/{DIGEST_REPO}/issues`

**`closeStaleIssues(days)` - 关闭过期 Issue**
- 分页获取最旧 open issues，逐个关闭
- 每次关闭后重新获取第 1 页（分页会变）

**`LABEL_COLORS` - 标签颜色映射**
- 为每种报告类型的 GitHub Issue 标签定义颜色（如 `douyin: 000000`、`bili: fb7299` B站粉）

---

## 十五、项目文件全景

```
popular_radar/
├── src/
│   ├── index.ts              # 主编排：3阶段 pipeline + main()
│   ├── hot.ts                # DailyHotApi 通用客户端（fetchHotData/fetchAllHotData）
│   ├── config.ts             # config.yml 加载器（loadConfig + HotSource 类型）
│   ├── i18n.ts               # 双语字符串中心
│   ├── date.ts               # CST/UTC 日期工具
│   │
│   ├── LLM 层
│   │   ├── providers/        # 5个 provider + 工厂 (8个文件)
│   │   │   ├── types.ts           # LlmProvider 接口
│   │   │   ├── openai-compatible.ts # 共享基类
│   │   │   ├── anthropic.ts       # Anthropic 独立实现
│   │   │   ├── openai.ts          # OpenAI
│   │   │   ├── github-copilot.ts  # GitHub Copilot
│   │   │   ├── openrouter.ts      # OpenRouter
│   │   │   ├── deepseek.ts        # DeepSeek
│   │   │   └── index.ts           # 工厂 + 注册表
│   │   ├── report.ts         # callLlm(限流+重试) / saveFile / parseLlmJson / autoGenFooter
│   │   └── prompts-data.ts   # 5个 prompt builder (keywords/videos/highlights/weekly/monthly)
│   │
│   ├── 报告层
│   │   ├── report-savers.ts  # 通用 saveHotReport（按 contentType 分流）
│   │   └── github.ts         # Issue 创建/标签/清理（精简版）
│   │
│   ├── 汇总与后处理
│   │   ├── rollup.ts             # 周报/月报
│   │   ├── generate-manifest.ts  # manifest.json + feed.xml
│   │   ├── notify.ts / feishu.ts  # 通知推送
│   │   ├── close-stale-issues.ts  # Issue 清理
│   │   └── weekly.ts / monthly.ts  # 汇总入口脚本
│   │
│   └── __tests__/           # 单元测试
│       └── parse.test.ts
│
├── .github/workflows/       # 4 个 CI/CD 工作流
│   ├── ci.yml               # 质量门禁
│   ├── daily-digest.yml     # 每日日报
│   ├── weekly-digest.yml    # 周报
│   └── monthly-digest.yml   # 月报
│
├── config.yml               # 平台/分区配置
├── digests/                 # 历史报告输出 (git tracked)
│   └── YYYY-MM-DD/          # 每日报告目录
│       ├── ai-douyin.md        # 抖音热搜日报 (中)
│       ├── ai-douyin-en.md     # 抖音热搜日报 (英)
│       ├── ai-bili.md          # B站热门视频日报 (中)
│       ├── ai-bili-en.md       # B站热门视频日报 (英)
│       ├── ai-bili-music.md    # B站热门音乐日报 (中)
│       ├── ai-bili-music-en.md # B站热门音乐日报 (英)
│       ├── ai-weekly.md        # 周报 (中)
│       ├── ai-weekly-en.md     # 周报 (英)
│       ├── ai-monthly.md       # 月报 (中)
│       ├── ai-monthly-en.md    # 月报 (英)
│       └── highlights.json     # 通知用摘要
│
├── index.html               # Web UI (读 manifest.json)
├── manifest.json            # Web UI 数据 (git tracked)
├── feed.xml                 # RSS 2.0 订阅源 (git tracked)
├── package.json             # 项目配置
├── tsconfig.json            # TypeScript 配置
├── eslint.config.js         # ESLint 配置
├── vitest.config.ts         # 测试配置
├── .prettierrc              # Prettier 配置
├── .env.example             # 环境变量模板
└── .gitignore
```

---

## 十六、与 agents-radar 的差异对照

### 16.1 删除的模块

| agents-radar 模块 | popular-radar 处理 | 原因 |
|-------------------|-------------------|------|
| 9 个独立 fetcher (github/web/hn/arxiv/hf/devto/lobsters/trending/ph) | **替换**为 1 个 `hot.ts` 通用客户端 | DailyHotApi 统一接口，无需逐个实现 |
| `prompts.ts` (GitHub 类 prompt) | **删除** | 无 GitHub 仓库跟踪需求 |
| `report-builders.ts` (CLI/OpenClaw 复杂拼装) | **删除** | 无复杂多段报告拼接需求 |
| 推荐系统 (recommend-runner/candidate/dedup/scorer/recommend) | **删除** | Phase 2 预留 |
| MCP Server (mcp/) | **删除** | 非核心需求 |
| 社媒生成 (social.ts) | **删除** | 非核心需求 |
| `web.ts` (sitemap 增量采集) | **删除** | DailyHotApi 自带 cache |

### 16.2 简化的模块

| 模块 | agents-radar | popular-radar |
|------|-------------|---------------|
| `index.ts` 主编排 | 6 阶段 | 3 阶段（无交叉对比） |
| `report-savers.ts` | 7 个独立 saver | 1 个通用 `saveHotReport` |
| `github.ts` | issues/PRs/releases 采集 + Issue 管理 | 仅 Issue 管理 |
| `i18n.ts` MSG | 5 条 | 2 条 |
| `report.ts` token 常量 | 4 个 | 2 个 |
| `config.ts` | 仓库列表 + 推荐配置 | 数据源列表 + 推荐配置 |

### 16.3 原样复制的模块

- `src/providers/`（8 文件，完整 LLM 抽象层）
- `src/date.ts`（日期工具）
- `src/rollup.ts` 的核心逻辑（改 ROLLUP_SOURCES）
- `src/generate-manifest.ts` 的核心逻辑（改 REPORT_FILES）
- `src/notify.ts` / `src/feishu.ts` 的核心逻辑（改品牌名）
- `src/close-stale-issues.ts`
- 所有配置文件（tsconfig/eslint/prettier/vitest）

### 16.4 新增的设计

- **`contentType` 分流**：`HotSource.contentType` 字段决定使用哪个 prompt builder，是数据层到报告层的关键桥梁
- **`getReportMeta(source)` 动态元数据**：支持 config.yml 新增非内置数据源时自动生成报告标题
- **`ROLLUP_SOURCES` 动态派生**：从 config 动态生成汇总源列表，新增数据源自动纳入周报月报
- **通用 `saveHotReport`**：一个函数处理所有数据源，消除 saver 代码重复
- **DailyHotApi 客户端容错**：多层错误处理（HTTP 错误、非 JSON 响应、字段校验、超时、异常）

---

## 关键设计约定总结

1. **配置驱动** - `config.yml` 控制跟踪的平台列表，`loadConfig()` 有完整 fallback 默认值，新增平台只需加一行配置
2. **contentType 分流** - `HotSource.contentType` 决定 prompt builder 选择，数据层到报告层的唯一分流器
3. **并发限流不可绕过** - `LLM_CONCURRENCY=5` + 429 指数退避，所有 LLM 调用必须走 `callLlm`
4. **容错降级** - 每个数据源 `.catch()` 返回空数据；saver 错误被捕获不崩溃主流程；highlights 中英用 `allSettled` 独立解析
5. **双语集中管理** - 所有中英文案集中在 `i18n.ts`，用 `Lang` 类型和 `Record<Lang, string>`
6. **Provider 安全** - 日志只输出 provider 名称，绝不记录 API key 或 URL
7. **跨仓库引用中和** - Issue body 中的 GitHub URL 和 @mention 插入零宽空格
8. **调度错峰** - 日报 00:00 → 周一 01:00 周报 → 1日 02:00 月报，避免 LLM 并发
9. **highlights 合并不覆盖** - 周报月报的 highlights 合并到已有 `highlights.json`，不覆盖日报 highlights
10. **动态汇总源** - `ROLLUP_SOURCES` 从 config 派生，新增数据源自动纳入周报月报
