/**
 * LLM prompt builders for hot-source reports and rollup reports.
 *
 * Audience: 娱乐/舞蹈/游戏自媒体创作者 - every report is a creation-decision
 * aid (what BGM to use, what dance to follow, what meme to ride), not a
 * content catalogue.
 *
 * Builders:
 *   - buildKeywordsPrompt: keyword sources (抖音/微博热搜) with 娱乐向分流
 *   - buildVideosPrompt:   video sources (B站综合) with 创作者视角分类
 *   - buildTagReportPrompt: cross-source tag reports (bgm/dance/meme/game/fandom)
 *   - buildClassifyPrompt: batch tag classification (classify.ts engine 3)
 *   - buildHighlightsPrompt / buildWeeklyPrompt / buildMonthlyPrompt
 *
 * All prompts are Chinese-only and enforce the output contract: first line is
 * a fixed H2 anchor, all sections use "## " headings, no reasoning text.
 */

import type { HotData } from "./hot.ts";

// ---------------------------------------------------------------------------
// Shared contract line
// ---------------------------------------------------------------------------

const NO_THINKING = "直接输出报告正文，不要输出任何思考过程、推敲过程或自我修正的文字；不要重复报告标题。";

const EMPTY_SECTION_RULE =
  "某一节没有对应内容时，输出该节标题加一句「今日暂无」即可，禁止硬凑或编造不存在的内容。";

// ---------------------------------------------------------------------------
// Keywords prompt (抖音/微博热搜 - P2 娱乐向分流)
// ---------------------------------------------------------------------------

export function buildKeywordsPrompt(data: HotData, dateStr: string): string {
  const itemsText = data.items
    .map((item, i) => {
      const hot = item.hot !== undefined ? `${item.hot}` : "-";
      return `${i + 1}. **${item.title}**\n   🔗 ${item.url}\n   🔥 热度: ${hot}`;
    })
    .join("\n\n");

  const sourceName = data.source.name;

  return `你是一位短视频娱乐创作顾问，专注为舞蹈/游戏/娱乐自媒体博主提供可跟拍、可借鉴、可蹭流量的热点情报。以下是 ${dateStr} 从${sourceName}获取的今日热搜词（按热度排序，共 ${data.items.length} 条）：

---

${itemsText}

---

先对每个热搜词做判断：娱乐向（影视/综艺/明星/游戏/动漫/音乐/舞蹈/梗/网红/饭圈相关）或非娱乐向（社会新闻/政策/灾害/经济/国际时政等）。然后生成《${sourceName}日报》，包含以下部分：

## 今日速览
3-5 句话概括今日热搜格局，突出娱乐向热点和流量风向

## 🎬 娱乐向热搜
精选 10-15 个娱乐相关热搜词，每个包含：
- 搜索词（附原文链接）+ 热度值
- 一句话：涉及什么、为何上榜
- **创作切入点**：给自媒体博主的具体建议（如"可做反应视频""可跟拍挑战""可做盘点/锐评"）

## 📰 非娱乐热搜速览
社会新闻/政策类热搜挑 3-5 个，每个一句话带过即可，不展开

## 趋势信号分析
100-200 字分析今日娱乐流量趋势：哪些题材在升温、是否有新梗新挑战冒头、与日常相比有何变化

## 创作建议
基于今日娱乐热搜给出 2-3 条具体可执行的创作建议（选题+形式+时机）

输出要求：中文，简洁专业，保留所有原文链接。${EMPTY_SECTION_RULE}${NO_THINKING}输出的第一行必须是「## 今日速览」，以上各部分一律使用「## 」二级标题。
`;
}

// ---------------------------------------------------------------------------
// Videos prompt (B站综合热门 - P1 创作者视角分类)
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

  return `你是一位短视频娱乐创作顾问，专注为舞蹈/游戏/娱乐自媒体博主提供可跟拍、可借鉴、可蹭流量的热点情报。以下是 ${dateStr} 从${sourceName}获取的今日热门内容（共 ${data.items.length} 条）：

---

${itemsText}

---

请从创作者视角生成《${sourceName}日报》，包含以下部分：

## 今日速览
3-5 句话概括今日流量风向和最值得关注的创作机会

## 🎵 可跟拍 BGM
列表中出现的热门音乐/热歌相关内容，每条包含：歌名或内容（附链接）、热度、适配场景（舞蹈/剪辑/vlog）、搜索关键词

## 💃 热门舞蹈跟拍
热门舞蹈/手势舞内容，每条包含：舞蹈内容（附链接）、UP主与播放量、难度评估（简单/中等/较难）、为什么火

## 😂 热梗与抽象
正在传播的梗、鬼畜、无厘头内容，每条包含：梗的内容（附链接）、梗的来源和玩法、适合什么类型的博主蹭

## 🎮 游戏热点
值得蹭的游戏流量，每条包含：游戏名与内容（附链接）、热点类型（版本/赛事/梗/剧情）、创作切入点

## ⭐ 饭圈动态
明星/偶像相关流量，每条包含：明星名与话题（附链接）、话题性质（正面/争议）、蹭流量注意点

## 创作建议
基于今日内容给出 2-3 条具体可执行的创作建议（选题+形式+时机）

输出要求：中文，简洁专业，保留所有原文链接。${EMPTY_SECTION_RULE}${NO_THINKING}输出的第一行必须是「## 今日速览」，以上各部分一律使用「## 」二级标题。
`;
}

// ---------------------------------------------------------------------------
// Tag report prompt (P4 跨源专项报告, fandom 含 P7 风险标注)
// ---------------------------------------------------------------------------

/** Minimal item shape for tag reports (avoids importing classify.ts - no cycles). */
export interface TagReportItem {
  title: string;
  url: string;
  hot?: number;
  author?: string;
  sourceName: string;
}

interface TagPromptSpec {
  role: string;
  sections: string;
}

const FALLBACK_TAG_SPEC: TagPromptSpec = {
  role: "短视频娱乐创作顾问",
  sections: `## 今日速览
2-4 句话概括该类内容今日风向

## 热点内容
精选最值得关注的内容，每条包含：内容（附链接）、来源平台、热度、创作切入点

## 创作建议
2-3 条具体可执行的创作建议`,
};

const TAG_PROMPT_SPECS: Record<string, TagPromptSpec> = {
  bgm: {
    role: "音乐向短视频创作顾问",
    sections: `## 今日速览
2-4 句话概括今日热门 BGM/热歌风向

## 🎵 今日热门 BGM
精选最值得使用的背景音乐/热歌，每条包含：歌名或内容（附链接）、来源平台、热度、适配场景（舞蹈/剪辑/vlog/变装）、搜索关键词

## 创作建议
2-3 条：哪些 BGM 适合立刻跟进、适合什么内容形式`,
  },
  dance: {
    role: "舞蹈区创作顾问",
    sections: `## 今日速览
2-4 句话概括今日舞蹈/手势舞流量风向

## 💃 今日热门舞蹈
精选最值得跟拍的舞蹈/手势舞，每条包含：舞蹈内容（附链接）、来源平台与UP主、播放量、难度评估（简单/中等/较难）、为什么火、跟拍要点

## 创作建议
2-3 条：哪些舞蹈值得立刻跟拍、拍摄形式建议`,
  },
  meme: {
    role: "梗文化与抽象内容创作顾问",
    sections: `## 今日速览
2-4 句话概括今日梗与抽象内容风向

## 😂 今日热梗与抽象
精选正在传播的梗/鬼畜/无厘头内容，每条包含：梗的内容（附链接）、来源平台、梗的起源与玩法说明、适合什么类型的博主怎么蹭

## 创作建议
2-3 条：哪些梗还在上升期值得跟、玩法建议`,
  },
  game: {
    role: "游戏区创作顾问",
    sections: `## 今日速览
2-4 句话概括今日游戏圈流量风向

## 🎮 今日游戏热点
精选值得蹭的游戏流量，每条包含：游戏名与内容（附链接）、来源平台、热点类型（新游上线/版本更新/赛事/梗/剧情）、创作切入点（直播选题/攻略/整活/锐评）

## 创作建议
2-3 条：哪些游戏热点适合直播蹭、哪些适合做视频`,
  },
  fandom: {
    role: "娱乐圈动态创作顾问",
    sections: `## 今日速览
2-4 句话概括今日明星/饭圈流量风向

## ⭐ 今日饭圈动态
精选明星/偶像相关流量话题，每条包含：明星名与话题（附链接）、来源平台、热度，并**必须标注**：
- 话题性质：正面 / 争议 / 负面
- 风险等级：低 / 中 / 高
- 风险提示：争议或负面话题必须附一句提示（如"该话题争议较大，蹭流量需谨慎，避免站队"）；正面话题可写"风险低，可正常跟进"

## 创作建议
2-3 条：哪些话题可安全蹭流量、哪些建议观望，说明理由`,
  },
};

export function buildTagReportPrompt(tag: string, items: TagReportItem[], dateStr: string): string {
  const spec: TagPromptSpec = TAG_PROMPT_SPECS[tag] ?? FALLBACK_TAG_SPEC;

  const itemsText = items
    .map((item, i) => {
      const hot = item.hot !== undefined ? ` | 热度: ${item.hot}` : "";
      const author = item.author ? ` | 作者: ${item.author}` : "";
      return `${i + 1}. **${item.title}** [来源: ${item.sourceName}]${author}${hot}\n   🔗 ${item.url}`;
    })
    .join("\n\n");

  return `你是一位${spec.role}，为自媒体博主提供当日可直接行动的热点情报。以下是 ${dateStr} 从多个平台聚合的相关热点（共 ${items.length} 条，已按内容类型预筛选）：

---

${itemsText}

---

请生成当日专项报告，包含以下部分：

${spec.sections}

输出要求：中文，简洁专业，保留所有原文链接，每条注明来源平台。${EMPTY_SECTION_RULE}${NO_THINKING}输出的第一行必须是「## 今日速览」，以上各部分一律使用「## 」二级标题。
`;
}

// ---------------------------------------------------------------------------
// Classification prompt (P3 引擎 3 - LLM 批量兜底)
// ---------------------------------------------------------------------------

/** Minimal item shape for classification (avoids importing classify.ts). */
export interface ClassifyPromptItem {
  id: string;
  title: string;
}

export function buildClassifyPrompt(items: ClassifyPromptItem[]): string {
  const itemsText = items.map((it) => `- [id:${it.id}] ${it.title}`).join("\n");

  return `你是一位短视频内容分类器。以下是无法用规则判断类别的热点标题，请判断每条属于哪些类别：

- bgm（热歌/背景音乐相关）
- dance（舞蹈/手势舞相关）
- meme（流行梗/抽象/无厘头/鬼畜内容）
- fandom（饭圈/明星/偶像动态）
- game（游戏相关）
- social-news（社会新闻/政策/灾害/时政，与娱乐创作无关）
- other（确实无法归类）

标题列表：
${itemsText}

只返回合法的 JSON 数组，不要 markdown 代码块，不要解释，不要输出任何思考过程。格式：
[{"id":"xxx","tags":["meme"]},{"id":"yyy","tags":["social-news"]}]

规则：
- id 必须原样使用方括号中的值
- 每条 1-2 个标签；拿不准时宁可标 other，不要标 social-news（避免误过滤娱乐内容）
- 娱乐属性优先：内容同时涉及娱乐和新闻时，标娱乐类标签`;
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
{"ai-douyin":["亮点1","亮点2",...],"ai-dance":["亮点1","亮点2",...],...}

规则：
- 用上面方括号中的报告 ID 作为 key
- 只包含有实际内容的报告（跳过失败或无数据的报告）
- 每个报告 ${itemsPerReport} 条亮点，每条不超过 30 个字
- 重点关注：热梗、热门 BGM、可跟拍舞蹈、游戏热点、明星话题
- 要具体：包含关键词、创作者名、播放量等关键信息`;
}

// ---------------------------------------------------------------------------
// Weekly rollup prompt (创作者视角, 与 P1 日报结构同步)
// ---------------------------------------------------------------------------

export function buildWeeklyPrompt(dailyDigests: Record<string, string>, weekStr: string): string {
  const digestEntries = Object.entries(dailyDigests)
    .map(([date, content]) => `## ${date}\n\n${content}`)
    .join("\n\n---\n\n");

  return `你是一位短视频娱乐创作顾问。以下是过去 7 天（${weekStr}）的短视频平台每日热点摘要，请为娱乐/舞蹈/游戏自媒体博主生成本周综合回顾。

${digestEntries}

---

请生成《短视频热点周报》，包含以下部分：

## 本周要闻
5-8 条本周最重要的娱乐热点事件、爆款内容、趋势变化，每条附日期

## 🎵 本周 BGM 与舞蹈
本周热门 BGM、舞蹈/手势舞盘点：哪些持续走热、哪些昙花一现，现在跟拍还来得及吗

## 😂 本周热梗盘点
本周流行梗与抽象内容：梗的生命周期判断（上升期/巅峰/退潮），下周还能不能蹭

## 🎮 游戏流量周况
本周游戏圈热点：新游表现、版本活动、值得持续跟进的选题

## ⭐ 饭圈周况
本周明星/偶像话题盘点，标注话题性质（正面/争议）与风险提示

## 下周信号
基于本周数据，预判下周值得提前布局的创作方向

输出要求：中文，简洁专业，适合创作者快速掌握一周动态。${EMPTY_SECTION_RULE}${NO_THINKING}输出的第一行必须是「## 本周要闻」，以上各部分一律使用「## 」二级标题。`;
}

// ---------------------------------------------------------------------------
// Monthly rollup prompt (创作者视角)
// ---------------------------------------------------------------------------

export function buildMonthlyPrompt(sourceDigests: Record<string, string>, monthStr: string): string {
  const digestEntries = Object.entries(sourceDigests)
    .map(([key, content]) => `## ${key}\n\n${content}`)
    .join("\n\n---\n\n");

  return `你是一位短视频娱乐创作顾问。以下是 ${monthStr} 月的短视频平台动态汇总（共 ${Object.keys(sourceDigests).length} 份报告），请为娱乐/舞蹈/游戏自媒体博主生成本月综合回顾。

${digestEntries}

---

请生成《短视频热点月报》，包含以下部分：

## 月度要闻
本月最重要的 5-10 条娱乐热点事件和里程碑，按时间排列

## 🎵 月度 BGM 与舞蹈趋势
本月热歌与舞蹈内容的整体演变：什么风格在崛起、持续性热点 vs 短暂性热点

## 😂 月度热梗盘点
本月梗与抽象内容生态回顾：现象级梗复盘、梗的传播规律总结

## 🎮 游戏流量月况
本月游戏圈整体格局：新游、大版本、赛事的流量表现与创作机会复盘

## ⭐ 饭圈月度回顾
本月明星/偶像话题格局，高风险话题复盘与经验教训

## 下月展望
基于本月趋势，预判下月值得重点布局的创作方向

输出要求：中文，深度分析，数据驱动，适合创作者月度复盘和选题规划。${EMPTY_SECTION_RULE}${NO_THINKING}输出的第一行必须是「## 月度要闻」，以上各部分一律使用「## 」二级标题。`;
}
