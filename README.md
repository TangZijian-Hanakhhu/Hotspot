# 🔥 Hotspot — 短视频热点日报自动生成系统

面向**娱乐/舞蹈/游戏自媒体创作者**的短视频热点日报自动生成系统。每天定时从抖音、B站、微博、快手等平台聚合热搜和热门视频，经 LLM 分析后生成中文日报，以 GitHub Issues + Markdown 文件 + Web UI + RSS + 飞书/Telegram 通知等多种方式发布。

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

## 🚀 快速部署

详见 **[DEPLOY.md](DEPLOY.md)**，简要步骤：

1. Fork / 克隆本仓库
2. 配置仓库 Secrets（`ARK_API_KEY`、`FEISHU_WEBHOOK_URLS` 等）
3. Settings → Actions → Workflow permissions → Read and write
4. （可选）开启 GitHub Pages
5. 手动触发 Daily workflow 验证

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

- [ARCHITECTURE.md](ARCHITECTURE.md) — 完整架构详解
- [DEPLOY.md](DEPLOY.md) — 部署与配置指南
- [IMPROVEMENT.md](IMPROVEMENT.md) — 改进方案详解

## 📜 License

MIT
