# popular-radar 自动推送部署指南

目标：像 agents-radar 一样，每天 / 每周 / 每月由 GitHub Actions 自动生成报告并推送到**飞书**，LLM 使用**火山方舟 doubao-seed-2.0-pro**。

三个工作流的 cron 已经写好，代码无需再改。你只要完成下面的「一次性配置」，之后就全自动运行。

---

## 已为你改好的代码（无需你操作）

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 volcano provider | `src/providers/volcano.ts` | OpenAI 兼容，base=`.../api/coding/v3`，默认模型 `doubao-seed-2.0-pro`，读 `ARK_API_KEY` |
| 注册 provider | `src/providers/index.ts` | `LLM_PROVIDER=volcano` 生效 |
| 三工作流切换 LLM | `daily/weekly/monthly-digest.yml` | `LLM_PROVIDER: volcano` + 注入 `ARK_API_KEY` |
| 周报/月报补飞书推送 | `weekly/monthly-digest.yml` | 原本只有 Telegram，现已加 `Send Feishu notification` 步骤 |
| 文档 | `.env.example` | 补充 ARK 变量说明 |

> 已通过校验：`createProvider()` 正确解析到 volcano（base/模型正确），4 个工作流 YAML 均合法。

---

## 一次性配置（只有你能做）

### 第 1 步：把本地仓库推到 GitHub

在 GitHub 新建一个仓库（例如 `popular-radar`），然后在本地项目目录执行：

```bash
git init
git add .
git commit -m "init: popular-radar"
git branch -M main
git remote add origin https://github.com/<你的用户名>/popular-radar.git
git push -u origin main
```

> 工作流里 `PAGES_URL` 目前硬编码为 `https://tangzijian-hanakhhu.github.io/Hotspot`。若你的 GitHub 用户名/仓库名不同，请把三个 workflow 里的这个地址一并改掉（只影响飞书消息里的 Web UI/RSS 链接）。

### 第 2 步：配置仓库 Secrets

进入 **仓库 → Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名称 | 值 | 必填 |
|-------------|-----|------|
| `ARK_API_KEY` | 你的火山 Ark key（`ark-...`） | ✅ 必填 |
| `FEISHU_WEBHOOK_URLS` | 飞书群机器人 webhook（多个用逗号分隔） | ✅ 必填 |
| `DAILYHOT_BASE_URL` | 自部署 DailyHotApi 地址 | ⬜ 可选，不填用公共实例 |
| `ARK_MODEL` | 覆盖默认模型 | ⬜ 可选，默认 `doubao-seed-2.0-pro` |

`GITHUB_TOKEN` 由 Actions 自动提供，**不用手动配**。Issues 会自动创建在同一仓库（`DIGEST_REPO=github.repository`），这是飞书通知的数据来源之一，保留即可。

> 🔐 安全提示：你的 API key 之前以明文发过，建议在火山控制台**重置一次 key**，然后只把新 key 存进上面的 Secret，不要写进任何提交的文件。

### 第 3 步：开启 Actions 写权限

**Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**（否则 Actions 无法把生成的报告 commit/push 回仓库）。

### 第 4 步（可选）：开启 GitHub Pages

只有你想用网页界面/RSS 时才需要。**Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**。不开也不影响飞书推送，只是飞书消息里的 Web UI 链接会 404。

### 第 5 步：手动跑一次验证

**Actions → Daily Popular Radar → Run workflow** 手动触发，然后看运行日志：

- 采集：应看到 `[douyin] N items`、`[bili] N items` 等
- LLM：应看到 `[providers] Using LLM provider: volcano`，且报告成功生成
- 飞书：`Send Feishu notification` 步骤应把消息发到群里

---

## ⚠️ 关于火山编程套餐的重要提醒

火山官方说明：**编程套餐（Coding Plan）额度仅在 AI 编程工具中生效，不可用于普通 API 调用**。popular-radar 是脚本化的 API 调用，因此存在两种可能：

1. 端点按 Anthropic/OpenAI SDK 请求放行 → 正常工作（本项目用官方 openai SDK 发请求，格式与编程工具一致，很可能通过）；
2. 端点按工具身份拦截 → LLM 调用被拒（日志会出现 401/403 或额度错误）。

**如果第 5 步验证时 LLM 被拒**，用以下任一备选：

- **标准 Ark API**：把 `ARK_BASE_URL` secret 设为 `https://ark.cn-beijing.volces.com/api/v3`（按 token 计费的常规 API），并确认用的是常规 API key；
- **改用 DeepSeek**（便宜稳定，项目已内置）：把三个工作流的 `LLM_PROVIDER` 改回 `deepseek`，Secret 换成 `DEEPSEEK_API_KEY`。

---

## 自动调度总览（错峰，避免 LLM 并发）

| 时间 (UTC) | 北京时间 | 工作流 | 动作 |
|-----------|---------|--------|------|
| 每天 00:00 | 08:00 | Daily | 采集 → 生成 6 份中英日报 → commit → 飞书推送 → 清理过期 Issue |
| 每周一 01:00 | 09:00 | Weekly | 汇总近 7 天日报 → 周报 → commit → 飞书推送 |
| 每月 1 日 02:00 | 10:00 | Monthly | 汇总上月 → 月报 → commit → 飞书推送 |

配置完成后无需任何人工干预，三条流水线会按上表自动运行并推送到飞书。
