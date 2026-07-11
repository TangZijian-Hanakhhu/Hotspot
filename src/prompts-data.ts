/**
 * LLM prompt builders for hot-source reports and rollup reports.
 *
 * Two source prompt builders based on data type:
 *   - buildKeywordsPrompt: for search-keyword sources (抖音热搜)
 *   - buildVideosPrompt:   for video/content sources (B站热门/音乐)
 * Plus buildHighlightsPrompt, buildWeeklyPrompt, buildMonthlyPrompt for rollups.
 */

import type { HotData } from "./hot.ts";
import type { Lang } from "./i18n.ts";

// ---------------------------------------------------------------------------
// Keywords prompt (抖音热搜 - items are search terms)
// ---------------------------------------------------------------------------

export function buildKeywordsPrompt(data: HotData, dateStr: string, lang: Lang = "zh"): string {
  const itemsText = data.items
    .map((item, i) => {
      const hot = item.hot !== undefined ? `${item.hot}` : "-";
      return lang === "en"
        ? `${i + 1}. **${item.title}**\n   🔗 ${item.url}\n   🔥 Hot: ${hot}`
        : `${i + 1}. **${item.title}**\n   🔗 ${item.url}\n   🔥 热度: ${hot}`;
    })
    .join("\n\n");

  const sourceName = data.source.name;

  if (lang === "en") {
    return `You are a short-video trend analyst. The following are today's (${dateStr}) top search keywords from ${sourceName}, sorted by hotness (${data.items.length} total):

---

${itemsText}

---

Generate a structured ${sourceName} Hot Search Digest in English:

1. **Today's Highlights** - 3-5 sentences summarizing the hottest search trends and overall public attention focus today

2. **Top Search Terms** - Select the 10-15 most representative search terms, each with:
   - The keyword (with original link)
   - Hotness score
   - One sentence: what this trend is about and why it's trending

3. **Trend Signal Analysis** - 100-200 words analyzing today's search landscape:
   - Which categories dominate (tech, society, entertainment, consumption, etc.)?
   - Any notable surge or controversy?
   - Compared to typical patterns, what stands out today?

4. **Worth Watching** - List 2-3 search terms most worth deeper attention for content creators / marketers, with brief reasoning

Style: English, concise and professional, preserve all original links.
`;
  }

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

语言要求：中文，简洁专业，保留所有原文链接。
`;
}

// ---------------------------------------------------------------------------
// Videos prompt (B站热门视频/音乐 - items have cover/author/views)
// ---------------------------------------------------------------------------

export function buildVideosPrompt(data: HotData, dateStr: string, lang: Lang = "zh"): string {
  const itemsText = data.items
    .map((item, i) => {
      const author = item.author ? (lang === "en" ? ` | UP: ${item.author}` : ` | UP主: ${item.author}`) : "";
      const hot =
        item.hot !== undefined ? (lang === "en" ? ` | Views: ${item.hot}` : ` | 播放量: ${item.hot}`) : "";
      return lang === "en"
        ? `${i + 1}. **${item.title}**${author}${hot}\n   🔗 ${item.url}`
        : `${i + 1}. **${item.title}**${author}${hot}\n   🔗 ${item.url}`;
    })
    .join("\n\n");

  const sourceName = data.source.name;

  if (lang === "en") {
    return `You are a short-video content analyst. The following are today's (${dateStr}) trending content from ${sourceName} (${data.items.length} items):

---

${itemsText}

---

Generate a structured ${sourceName} Trending Digest in English:

1. **Today's Highlights** - 3-5 sentences on today's hottest content and overall platform trend

2. **Top Content** - Organized by category, select the most representative items per category, each with:
   - Title (with original link)
   - Author and view count
   - One sentence: what this content is about and why it's trending

   Categories:
   - 📚 Knowledge & Tech (tutorials, science, education)
   - 🎬 Entertainment (gaming, anime, variety, fun)
   - 🎵 Music & Performance (covers, original music, dance)
   - 🏠 Lifestyle (food, travel, daily life)

3. **Traffic Signal Analysis** - 100-200 words analyzing today's content landscape:
   - Which categories are most active today?
   - Any breakout viral content or emerging creators?
   - Compared to typical patterns, what stands out today?

4. **Worth Watching** - List 2-3 items most worth watching in depth, with brief reasoning

Style: English, concise and professional, preserve all original links.
`;
  }

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

语言要求：中文，简洁专业，保留所有原文链接。
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
  lang: Lang = "zh",
  itemsPerReport: number = 6,
): string {
  const sections = Object.entries(reportContents)
    .map(([id, content]) => `## [${id}]\n\n${content.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  if (lang === "en") {
    return `You are a concise news editor. The following are today's short-video trend report excerpts, each labeled with a report ID.

${sections}

---

For each report, extract ${itemsPerReport} of the most noteworthy highlights - the kind that would make a reader want to click through. Each highlight should be a single short sentence (under 60 characters).

Return ONLY valid JSON, no markdown fences, no explanation. Format:
{"ai-douyin":["highlight 1","highlight 2",...],"ai-bili":["highlight 1","highlight 2",...],...}

Rules:
- Use the exact report IDs from the [brackets] above as keys
- Only include reports that have meaningful content (skip reports with failure messages)
- ${itemsPerReport} highlights per report, each under 60 characters
- Focus on: trending topics, viral content, breakout creators, notable shifts
- Be specific: include keywords, creator names, view counts where relevant`;
  }

  return `你是一位简洁的新闻编辑。以下是今日短视频热点各报告的摘要，每个报告用 ID 标注。

${sections}

---

为每份报告提取 ${itemsPerReport} 条最值得关注的亮点--能让读者产生点击欲望的那种。每条亮点用一句简短的话（不超过 30 个字）。

只返回合法的 JSON，不要 markdown 代码块，不要解释。格式：
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

export function buildWeeklyPrompt(
  dailyDigests: Record<string, string>,
  weekStr: string,
  lang: Lang = "zh",
): string {
  const digestEntries = Object.entries(dailyDigests)
    .map(([date, content]) => `## ${date}\n\n${content}`)
    .join("\n\n---\n\n");

  if (lang === "en") {
    return `You are a short-video trend analyst. The following are daily digest summaries from the past 7 days (${weekStr}) of short-video platform hot trends. Generate a comprehensive weekly recap.

${digestEntries}

---

Generate a Short-Video Trends Weekly Report with these sections:

1. **Week's Top Stories** - 5-8 most important trending events, viral content, and shifts this week, each with date
2. **Douyin Search Trends** - Overall hot search landscape and notable keyword evolution this week
3. **Bilibili Content Highlights** - Key trending videos and music, breakout creators this week
4. **Cross-Platform Signals** - Common themes or divergent trends across platforms
5. **Creator & Content Spotlight** - Standout creators or content worth noting
6. **Next Week's Signals** - Based on this week's data, predict trends worth watching

Style: English, concise and professional, helping content creators and marketers quickly grasp the week's developments.`;
  }

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

语言要求：中文，简洁专业，适合内容创作者和营销者快速掌握一周动态。`;
}

// ---------------------------------------------------------------------------
// Monthly rollup prompt
// ---------------------------------------------------------------------------

export function buildMonthlyPrompt(
  sourceDigests: Record<string, string>,
  monthStr: string,
  lang: Lang = "zh",
): string {
  const digestEntries = Object.entries(sourceDigests)
    .map(([key, content]) => `## ${key}\n\n${content}`)
    .join("\n\n---\n\n");

  if (lang === "en") {
    return `You are a short-video trend analyst. The following are ${monthStr} short-video platform digest summaries (${Object.keys(sourceDigests).length} reports total). Generate a comprehensive monthly review.

${digestEntries}

---

Generate a Short-Video Trends Monthly Report with these sections:

1. **Month's Top Stories** - 5-10 most important trending events and milestones this month, in chronological order
2. **Douyin Search Monthly Review** - Monthly hot search landscape evolution, sustained vs ephemeral trends
3. **Bilibili Content Monthly Review** - Monthly content trends, breakout creators, notable videos
4. **Cross-Platform Trend Summary** - Most significant cross-platform patterns and paradigm shifts this month
5. **Creator Ecosystem Health** - Activity comparison across platforms, creator engagement assessment
6. **Next Month's Outlook** - Based on this month's trends, predict key directions to watch

Style: English, in-depth analysis, data-driven, suited for monthly retrospectives and strategic decision-making.`;
  }

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

语言要求：中文，深度分析，数据驱动，适合月度复盘和战略决策参考。`;
}
