/**
 * LLM prompt builders for hot-source reports and rollup reports.
 *
 * Two source prompt builders based on data type:
 *   - buildKeywordsPrompt: for search-keyword sources (抖音热搜)
 *   - buildVideosPrompt:   for video/content sources (B站热门/音乐)
 * Plus buildHighlightsPrompt, buildWeeklyPrompt, buildMonthlyPrompt for rollups.
 *
 * All prompts are Chinese-only: the data sources are Chinese platforms, so
 * no English reports are generated (saves ~50% LLM tokens).
 */

import type { HotData } from "./hot.ts";

// ---------------------------------------------------------------------------
// Keywords prompt (抖音热搜 - items are search terms)
// ---------------------------------------------------------------------------

export function buildKeywordsPrompt(data: HotData, dateStr: string): string {
  const itemsText = data.items
    .map((item, i) => {
      const hot = item.hot !== undefined ? `${item.hot}` : "-";
      return `${i + 1}. **${item.title}**\n   🔗 ${item.url}\n   🔥 热度: ${hot}`;
    })
    .join("\n\n");

  const sourceName = data.source.name;

  return `你是一位短视频趋势分析师。以下是 ${dateStr} 从${sourceName}获取的今日热搜词（按热度排序，共 ${data.items.length} 条）：

---

${itemsText}

---

请生成《${sourceName}热搜日报》，包含以下部分：

1. **今日速览** - 3-5 句话概括今日最热搜索趋势和整体公众关注焦点

2. **热门搜索词** - 精选 10-15 个最有代表性的搜索词，每个包含：
   - 搜索词（附原文链接）
   - 热度值
   - 一句话：该热点涉及什么、为何上榜

3. **趋势信号分析** - 100-200 字分析今日搜索格局：
   - 哪些领域（科技/社会/娱乐/消费等）占主导？
   - 是否有突发热点或争议话题？
   - 与日常模式相比，今日有何突出之处？

4. **值得关注** - 列出 2-3 个最值得内容创作者/营销者深挖的搜索词，附简短理由

输出要求：中文，简洁专业，保留所有原文链接。直接输出报告正文，不要输出任何思考过程、推敲过程或自我修正的文字；不要重复报告标题。输出的第一行必须是「## 今日速览」，以上四个部分一律使用「## 」二级标题。
`;
}

// ---------------------------------------------------------------------------
// Videos prompt (B站热门视频/音乐 - items have cover/author/views)
// ---------------------------------------------------------------------------

export function buildVideosPrompt(data: HotData, dateStr: string): string {
  const itemsText = data.items
    .map((item, i) => {
      const author = item.author ? ` | UP主: ${item.author}` : "";
      const hot = item.hot !== undefined ? ` | 播放量: ${item.hot}` : "";
      return `${i + 1}. **${item.title}**${author}${hot}\n   🔗 ${item.url}`;
    })
    .join("\n\n");

  const sourceName = data.source.name;

  return `你是一位短视频内容分析师。以下是 ${dateStr} 从${sourceName}获取的今日热门内容（共 ${data.items.length} 条）：

---

${itemsText}

---

请生成《${sourceName}日报》，包含以下部分：

1. **今日速览** - 3-5 句话概括今日最热内容和整体平台趋势

2. **热门内容** - 按分类组织，每个分类精选最有代表性的内容，每条包含：
   - 标题（附原文链接）
   - UP主和播放量
   - 一句话：内容讲什么、为何上热门

   分类：
   - 📚 知识科技（教程、科普、教育）
   - 🎬 娱乐（游戏、番剧、综艺、搞笑）
   - 🎵 音乐表演（翻唱、原创音乐、舞蹈）
   - 🏠 生活（美食、旅行、日常）

3. **流量信号分析** - 100-200 字分析今日内容格局：
   - 今日哪些分类最活跃？
   - 是否有爆款内容或新锐创作者崛起？
   - 与日常模式相比，今日有何突出之处？

4. **值得一看** - 列出 2-3 个最值得深入观看的内容，附简短理由

输出要求：中文，简洁专业，保留所有原文链接。直接输出报告正文，不要输出任何思考过程、推敲过程或自我修正的文字；不要重复报告标题。输出的第一行必须是「## 今日速览」，以上四个部分一律使用「## 」二级标题。
`;
}

// ---------------------------------------------------------------------------
// Highlights prompt - extracts structured highlights for notifications
// ---------------------------------------------------------------------------

export interface ReportHighlights {
  [reportId: string]: string[];
}

export function buildHighlightsPrompt(
  reportContents: Record<string, string>,
  itemsPerReport: number = 6,
): string {
  const sections = Object.entries(reportContents)
    .map(([id, content]) => `## [${id}]\n\n${content.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  return `你是一位简洁的新闻编辑。以下是今日短视频热点各报告的摘要，每个报告用 ID 标注。

${sections}

---

为每份报告提取 ${itemsPerReport} 条最值得关注的亮点--能让读者产生点击欲望的那种。每条亮点用一句简短的话（不超过 30 个字）。

只返回合法的 JSON，不要 markdown 代码块，不要解释，不要输出任何思考过程。格式：
{"ai-douyin":["亮点1","亮点2",...],"ai-bili":["亮点1","亮点2",...],...}

规则：
- 用上面方括号中的报告 ID 作为 key
- 只包含有实际内容的报告（跳过失败或无数据的报告）
- 每个报告 ${itemsPerReport} 条亮点，每条不超过 30 个字
- 重点关注：热搜词、爆款内容、新锐创作者、趋势变化
- 要具体：包含关键词、创作者名、播放量等关键信息`;
}

// ---------------------------------------------------------------------------
// Weekly rollup prompt
// ---------------------------------------------------------------------------

export function buildWeeklyPrompt(dailyDigests: Record<string, string>, weekStr: string): string {
  const digestEntries = Object.entries(dailyDigests)
    .map(([date, content]) => `## ${date}\n\n${content}`)
    .join("\n\n---\n\n");

  return `你是一位短视频趋势分析师。以下是过去 7 天（${weekStr}）的短视频平台每日热点摘要，请生成本周综合回顾报告。

${digestEntries}

---

请生成《短视频热点周报》，包含以下部分：

1. **本周要闻** - 5-8 条本周最重要的热点事件、爆款内容、趋势变化，每条附日期
2. **抖音搜索趋势** - 本周热搜词整体格局和值得注意的关键词演变
3. **B站内容亮点** - 本周热门视频和音乐、新锐 UP 主
4. **跨平台信号** - 各平台共同的主题或分化的趋势
5. **创作者与内容聚焦** - 值得关注的创作者或内容
6. **下周信号** - 基于本周数据，预判值得关注的趋势

输出要求：中文，简洁专业，适合内容创作者和营销者快速掌握一周动态。直接输出报告正文，不要输出任何思考过程；不要重复报告标题。输出的第一行必须是「## 本周要闻」，以上六个部分一律使用「## 」二级标题。`;
}

// ---------------------------------------------------------------------------
// Monthly rollup prompt
// ---------------------------------------------------------------------------

export function buildMonthlyPrompt(sourceDigests: Record<string, string>, monthStr: string): string {
  const digestEntries = Object.entries(sourceDigests)
    .map(([key, content]) => `## ${key}\n\n${content}`)
    .join("\n\n---\n\n");

  return `你是一位短视频趋势分析师。以下是 ${monthStr} 月的短视频平台动态汇总（共 ${Object.keys(sourceDigests).length} 份报告），请生成本月综合回顾报告。

${digestEntries}

---

请生成《短视频热点月报》，包含以下部分：

1. **月度要闻** - 本月最重要的 5-10 条热点事件和里程碑，按时间排列
2. **抖音搜索月度回顾** - 本月热搜格局演变、持续性 vs 短暂性趋势
3. **B站内容月度回顾** - 本月内容趋势、新锐创作者、值得注意的视频
4. **跨平台趋势总结** - 本月最显著的跨平台规律与范式变化
5. **创作者生态健康度** - 各平台月度活跃度对比、创作者参与度评估
6. **下月展望** - 基于本月趋势，预判值得重点关注的方向

输出要求：中文，深度分析，数据驱动，适合月度复盘和战略决策参考。直接输出报告正文，不要输出任何思考过程；不要重复报告标题。输出的第一行必须是「## 月度要闻」，以上六个部分一律使用「## 」二级标题。`;
}
