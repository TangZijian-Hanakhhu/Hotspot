# 🔥 Hotspot - 短视频热点日报自动生成系统

面向**娱乐/舞蹈/游戏自媒体创作者**的短视频热点日报自动生成系统。每天定时从抖音、B站、微博、快手等平台聚合热搜和热门视频，经 LLM 分析后生成中文日报，以 GitHub Issues + Markdown 文件 + Web UI + RSS + 飞书/Telegram 通知等多种方式发布。

> **Hotspot** 是一个面向娱乐、舞蹈、游戏自媒体创作者的**短视频热点日报自动生成系统**。
>
> 每天 08:00 自动从抖音、B站、微博、快手、米游社等 12 个数据源并行采集热搜词和热门视频，经「来源先验 → 关键词规则 → LLM 批量兜底」三级分类引擎打标过滤后，由 LLM 生成 7 份创作者视角的中文日报（抖音热搜、B站综合、BGM、舞蹈、热梗、游戏、饭圈），并按周/月自动汇总。报告通过飞书（含创作者画像分流推送）、Telegram、GitHub Issues、Web UI 与 RSS 多渠道分发，帮助创作者快速掌握当日可跟拍、可蹭流量的热点情报。

## ✨ 功能特性

- **每日日报**：12 个数据源并行采集 → 三级分类引擎过滤 → 2 份源报告 + 5 份跨源专项报告
- **周报月报**：基于日报自动汇总，每周一/每月1日生成
- **多渠道分发**：GitHub Issues、飞书（含创作者画像分流）、Telegram、Web UI、RSS
- **配置驱动**：`config.yml` 控制跟踪的平台/分区列表，新增平台只需加一行
- **多 LLM 后端**：6 个 provider 可切换（火山方舟 / Anthropic / OpenAI / GitHub Copilot / OpenRouter / DeepSeek），当前默认火山方舟
- **思考过程零泄漏**：四层防线确保推理文本不进入发布产物

## 📊 生成报告

| 报告 | 类型 | 说明 |
|------|------|------|
| 抖音热搜日报 | 源报告 | 娱乐向热搜词 + 创作切入点 |
| B站热门视频日报 | 源报告 | 可跟拍BGM/舞蹈/热梗/游戏/饭圈 |
| 🎵 热门BGM日报 | 专项报告 | 跨源聚合，适配场景推荐 |
| 💃 热门舞蹈跟拍日报 | 专项报告 | 难度评估 + 跟拍要点 |
| 😂 热梗与抽象日报 | 专项报告 | 梗的起源/玩法/蹭流量方式 |
| 🎮 游戏热点日报 | 专项报告 | 版本/赛事/梗/创作切入点 |
| ⭐ 饭圈动态日报 | 专项报告 | 含风险等级标注 |
| 短视频热点周报 | 汇总 | 每周一，近7天回顾 |
| 短视频热点月报 | 汇总 | 每月1日，上月复盘 |

---

## 🚀 Quick Start

本指南带你从零部署，完成后系统将每天自动生成报告并推送到飞书/Telegram。

### 前置要求

| 条件 | 说明 |
|------|------|
| **Node.js 22+** | 本地测试用，[下载地址](https://nodejs.org/) |
| **pnpm 9+** | 包管理器，`npm install -g pnpm` 安装 |
| **GitHub 账号** | 代码托管 + Actions 自动调度 + Pages 网页 |
| **LLM API Key** | 火山方舟（默认）/ DeepSeek / OpenAI 等任选其一 |
| **飞书群机器人** | （可选）用于飞书通知推送 |

### 第 1 步：克隆仓库

```bash
git clone https://github.com/TangZijian-Hanakhhu/Hotspot.git
cd Hotspot
pnpm install
```

### 第 2 步：本地配置环境变量

复制环境变量模板并填入你的密钥：

```bash
cp .env.example .env
```

编辑 `.env`，**必填项**如下：

```bash
# LLM 后端（默认火山方舟，也可改为 deepseek / openai / anthropic 等）
LLM_PROVIDER=volcano
ARK_API_KEY=ark-xxxxxxxxxxxxxxxx        # 你的火山方舟 API Key

# GitHub（本地测试可留空，CI 自动注入）
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxx        # 你的 GitHub Personal Access Token
DIGEST_REPO=你的用户名/Hotspot           # Issue 发布目标仓库
```

> ⚠️ `.env` 已被 `.gitignore` 忽略，不会推送到 GitHub，请勿手动提交。

<details>
<summary><b>📋 完整环境变量列表（点击展开）</b></summary>

| 变量 | 用途 | 必填 | 默认值 |
|------|------|------|--------|
| `LLM_PROVIDER` | LLM 后端选择 | ✅ | `anthropic` |
| `ARK_API_KEY` | 火山方舟 API Key（用 volcano 时） | ✅ | - |
| `ARK_MODEL` | 火山方舟模型名 | ⬜ | `doubao-seed-2.0-pro` |
| `ARK_THINKING` | 思考模式开关 | ⬜ | `disabled` |
| `GITHUB_TOKEN` | GitHub Issue 创建/关闭 | ✅ | Actions 自动注入 |
| `DIGEST_REPO` | Issue 目标仓库 | ⬜ | 工作流设为 `github.repository` |
| `DAILYHOT_BASE_URL` | DailyHotApi 地址 | ⬜ | `https://api-hot.imsyy.top` |
| `FEISHU_WEBHOOK_URLS` | 飞书推送 webhook | ⬜ | 不填则跳过 |
| `FEISHU_WEBHOOK_DANCE` | 舞蹈博主画像 webhook | ⬜ | 不填则跳过 |
| `FEISHU_WEBHOOK_GAME` | 游戏博主画像 webhook | ⬜ | 不填则跳过 |
| `FEISHU_WEBHOOK_ENT` | 娱乐博主画像 webhook | ⬜ | 不填则跳过 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | ⬜ | 不填则跳过 |
| `TELEGRAM_CHAT_ID` | Telegram 聊天 ID | ⬜ | `@popular_radar` |
| `PAGES_URL` | Web UI / RSS 基础地址 | ⬜ | 代码内默认值 |

</details>

### 第 3 步：配置数据源（可选）

编辑 [`config.yml`](config.yml) 自定义要采集的平台和分区。默认已配置 12 个数据源：

```yaml
hot_sources:
  # 综合源（生成独立源报告）
  - id: douyin
    platform: douyin
    name: 抖音热搜
    limit: 50
    contentType: keywords

  - id: bili
    platform: bilibili
    name: B站热门视频
    limit: 50
    contentType: videos

  # 垂类源（只采集，喂给专项报告，不出独立源报告）
  - id: bili-music
    platform: bilibili
    name: B站热门音乐
    type: "3"
    limit: 30
    contentType: videos
    report: false
    tags: [bgm]

  # ... 更多源见 config.yml
```

**新增平台只需加一行配置**，无需改代码。支持的 `platform` 取决于 [DailyHotApi](https://github.com/imsyy/DailyHotApi) 端点。

### 第 4 步：本地运行验证

```bash
# 生成当日日报
pnpm start

# 生成周报（基于已保存的日报）
pnpm weekly

# 生成月报
pnpm monthly

# 生成 Web UI 数据（manifest.json + feed.xml）
pnpm manifest
```

运行后报告会保存到 `digests/YYYY-MM-DD/` 目录下。如果 LLM 调用成功且报告生成无误，说明本地配置正确。

<details>
<summary><b>🔧 常用 pnpm 脚本一览（点击展开）</b></summary>

| 脚本 | 命令 | 作用 |
|------|------|------|
| `pnpm start` | `tsx src/index.ts` | 生成当日日报 |
| `pnpm weekly` | `tsx src/weekly.ts` | 生成周报 |
| `pnpm monthly` | `tsx src/monthly.ts` | 生成月报 |
| `pnpm manifest` | `tsx src/generate-manifest.ts` | 生成 manifest.json + feed.xml |
| `pnpm notify` | `tsx src/notify.ts` | Telegram 推送 |
| `pnpm notify:feishu` | `tsx src/feishu.ts` | 飞书推送 |
| `pnpm close-stale` | `tsx src/close-stale-issues.ts` | 关闭过期 Issue |
| `pnpm lint` | `eslint src` | 代码检查 |
| `pnpm typecheck` | `tsc --noEmit` | 类型检查 |
| `pnpm test` | `vitest run` | 运行测试 |

</details>

### 第 5 步：推送到 GitHub 并配置 Secrets

```bash
git add .
git commit -m "init: configure data sources"
git push
```

进入 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret**，添加以下 Secrets：

| Secret 名称 | 值 | 必填 |
|-------------|-----|------|
| `ARK_API_KEY` | 火山方舟 API Key（`ark-...`） | ✅ |
| `FEISHU_WEBHOOK_URLS` | 飞书群机器人 webhook（多个用逗号分隔） | ⬜ |
| `DAILYHOT_BASE_URL` | 自部署 DailyHotApi 地址 | ⬜ |
| `ARK_MODEL` | 覆盖默认模型 | ⬜ |

> `GITHUB_TOKEN` 由 Actions 自动提供，**无需手动配置**。
>
> 如果使用飞书创作者画像分流，还需添加 `FEISHU_WEBHOOK_DANCE` / `FEISHU_WEBHOOK_GAME` / `FEISHU_WEBHOOK_ENT`。

### 第 6 步：开启 Actions 写权限

**Settings → Actions → General → Workflow permissions** → 选择 **Read and write permissions**

> 这是让 Actions 能把生成的报告 commit/push 回仓库的必要设置。

### 第 7 步：开启 GitHub Pages（可选）

只有你想用 Web 网页界面 / RSS 时才需要：

**Settings → Pages → Build and deployment → Deploy from branch → `main` / `(root)`**

不开也不影响飞书/Telegram 推送，只是通知消息中的 Web UI 链接会 404。

### 第 8 步：手动触发验证

**Actions → Daily Popular Radar → Run workflow** 手动触发，然后查看运行日志：

- ✅ 采集：应看到 `[douyin] N items`、`[bili] N items` 等
- ✅ LLM：应看到 `[providers] Using LLM provider: volcano`，且报告成功生成
- ✅ 飞书：`Send Feishu notification` 步骤应把消息发到群里

验证通过后，系统会按以下调度自动运行，无需任何人工干预：

| 时间 (UTC) | 北京时间 | 工作流 | 动作 |
|-----------|---------|--------|------|
| 每天 00:00 | 08:00 | Daily | 采集 → 生成 7 份日报 → commit → 飞书推送 → 清理过期 Issue |
| 每周一 01:00 | 09:00 | Weekly | 汇总近 7 天日报 → 周报 → commit → 飞书推送 |
| 每月 1 日 02:00 | 10:00 | Monthly | 汇总上月 → 月报 → commit → 飞书推送 |

---

## 🛠️ 技术栈

- **语言**：TypeScript（ESM）+ Node 22 + tsx 运行时
- **包管理**：pnpm
- **LLM SDK**：`@anthropic-ai/sdk` + `openai`
- **数据源**：[imsyy/DailyHotApi](https://github.com/imsyy/DailyHotApi) 自部署实例
- **部署**：GitHub Actions + GitHub Pages

## 📁 项目结构

```
src/
├── index.ts              # 主编排：5阶段 pipeline
├── hot.ts                # DailyHotApi 通用客户端
├── classify.ts           # 分类层：三级引擎(先验/关键词/LLM)
├── config.ts             # config.yml 加载器
├── report.ts             # LLM 调用基础设施(限流/重试/清洗)
├── report-savers.ts      # 报告生成(源报告+专项报告)
├── prompts-data.ts       # 7个 prompt builder
├── i18n.ts               # 中文字符串中心
├── rollup.ts             # 周报/月报
├── generate-manifest.ts  # manifest.json + RSS feed.xml
├── notify.ts / feishu.ts # 通知推送
├── github.ts             # Issue 管理
├── providers/            # 6个 LLM provider
└── __tests__/            # 单元测试
```

## 📖 文档

- [ARCHITECTURE.md](ARCHITECTURE.md) - 完整架构详解
- [DEPLOY.md](DEPLOY.md) - 部署与配置指南（含火山方舟套餐注意事项）
- [IMPROVEMENT.md](IMPROVEMENT.md) - 改进方案详解

## 📜 License

MIT
