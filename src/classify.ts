/**
 * Classification layer (P3) - sits between data collection (hot.ts) and
 * report generation (report-savers.ts). Tags every HotItem with entertainment
 * labels and filters out social-news noise before it reaches the LLM.
 *
 * Three-stage engine (cheapest first):
 *   1. Source priors  - sources from dedicated partitions (e.g. bili-dance)
 *                       preset tags via config.yml `tags`, no per-item work
 *   2. Keyword rules  - KEYWORD_TAGS (built-in + config.yml `keyword_tags`,
 *                       config wins). Entertainment keywords take precedence
 *                       over social-news keywords so "原神版本发布" is game,
 *                       not social-news.
 *   3. LLM fallback   - remaining `other` items are batch-classified (≤50 per
 *                       call). On any failure the batch stays `other` and is
 *                       NOT filtered - missing a trend costs more than showing
 *                       one news item.
 */

import type { HotItem, HotData } from "./hot.ts";
import type { HotSource } from "./config.ts";
import { callLlm, parseLlmJson } from "./report.ts";
import { buildClassifyPrompt } from "./prompts-data.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntTag = "bgm" | "dance" | "meme" | "fandom" | "game" | "social-news" | "other";

/** Tags that have their own aggregated tag report (ai-<tag>.md). */
export const CONTENT_TAGS = ["bgm", "dance", "meme", "game", "fandom"] as const;
export type ContentTag = (typeof CONTENT_TAGS)[number];

const VALID_TAGS: ReadonlySet<string> = new Set([...CONTENT_TAGS, "social-news", "other"]);

export interface ClassifiedItem extends HotItem {
  tags: EntTag[];
}

export interface ClassifiedData {
  source: HotSource;
  items: ClassifiedItem[];
  fetchSuccess: boolean;
}

/** Aggregated item carrying its origin source name (for cross-source tag reports). */
export interface TaggedItem extends ClassifiedItem {
  sourceName: string;
}

// ---------------------------------------------------------------------------
// Engine 1+2: source priors + keyword rules
// ---------------------------------------------------------------------------

/** Built-in keyword -> tags mapping. config.yml `keyword_tags` is merged on top. */
const DEFAULT_KEYWORD_TAGS: Record<string, EntTag[]> = {
  手势舞: ["dance"],
  舞蹈: ["dance"],
  跳舞: ["dance"],
  翻跳: ["dance"],
  编舞: ["dance"],
  齐舞: ["dance"],
  原神: ["game", "meme"],
  游戏: ["game"],
  手游: ["game"],
  开服: ["game"],
  新皮肤: ["game"],
  电竞: ["game"],
  主播: ["game"],
  塌房: ["fandom"],
  绯闻: ["fandom"],
  官宣恋情: ["fandom"],
  爱豆: ["fandom"],
  出道: ["fandom"],
  打榜: ["fandom"],
  应援: ["fandom"],
  鬼畜: ["meme"],
  抽象: ["meme"],
  整活: ["meme"],
  名场面: ["meme"],
  梗: ["meme"],
  翻唱: ["bgm"],
  神曲: ["bgm"],
  新歌: ["bgm"],
  单曲: ["bgm"],
  主题曲: ["bgm"],
  片尾曲: ["bgm"],
};

/** Social-news keywords - only applied when NO entertainment keyword matched. */
const SOCIAL_NEWS_KEYWORDS: string[] = [
  "台风",
  "暴雨",
  "地震",
  "洪水",
  "山火",
  "火灾",
  "事故",
  "遇难",
  "身亡",
  "救援",
  "政策",
  "条例",
  "通报",
  "被查",
  "落马",
  "判决",
  "起诉",
  "庭审",
  "外交",
  "会晤",
  "关税",
  "汇率",
  "油价",
  "房价",
  "高考",
  "招聘",
  "疫情",
  "病毒",
  "辟谣",
];

function isEntTag(tag: string): tag is EntTag {
  return VALID_TAGS.has(tag);
}

/** Merge built-in and config keyword maps (config wins), dropping invalid tags. */
export function mergeKeywordTags(configTags: Record<string, string[]>): Record<string, EntTag[]> {
  const merged: Record<string, EntTag[]> = { ...DEFAULT_KEYWORD_TAGS };
  for (const [kw, tags] of Object.entries(configTags)) {
    const valid = tags.filter(isEntTag);
    if (valid.length > 0) merged[kw] = valid;
  }
  return merged;
}

/**
 * Rule-based classification for one item.
 * Precedence: source priors + entertainment keywords > social-news > other.
 */
export function classifyItemWithRules(
  item: HotItem,
  sourceTags: EntTag[],
  keywordTags: Record<string, EntTag[]>,
): ClassifiedItem {
  const tags = new Set<EntTag>(sourceTags);

  const text = `${item.title} ${item.desc ?? ""}`;
  for (const [kw, kwTags] of Object.entries(keywordTags)) {
    if (text.includes(kw)) kwTags.forEach((t) => tags.add(t));
  }

  // Entertainment match wins - never mark a matched item as social-news.
  if (tags.size > 0) return { ...item, tags: [...tags] };

  if (SOCIAL_NEWS_KEYWORDS.some((kw) => text.includes(kw))) {
    return { ...item, tags: ["social-news"] };
  }

  return { ...item, tags: ["other"] };
}

// ---------------------------------------------------------------------------
// Engine 3: LLM batch fallback for `other` items
// ---------------------------------------------------------------------------

const LLM_BATCH_SIZE = 50;
const LLM_CLASSIFY_TOKENS = 4096;

interface LlmTagResult {
  id: string;
  tags: string[];
}

async function classifyBatchWithLlm(items: ClassifiedItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += LLM_BATCH_SIZE) {
    const batch = items.slice(i, i + LLM_BATCH_SIZE);
    try {
      const raw = await callLlm(buildClassifyPrompt(batch), LLM_CLASSIFY_TOKENS);
      const results = parseLlmJson<LlmTagResult[]>(raw);
      const byId = new Map(batch.map((it) => [it.id, it]));
      for (const r of Array.isArray(results) ? results : []) {
        const item = byId.get(String(r.id));
        if (!item || !Array.isArray(r.tags)) continue;
        const valid = r.tags.filter(isEntTag);
        if (valid.length > 0) item.tags = valid;
      }
    } catch (err) {
      // Fail open: batch stays `other` and will NOT be filtered.
      console.error(`  [classify] LLM batch ${i / LLM_BATCH_SIZE + 1} failed, keeping as other: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public pipeline API
// ---------------------------------------------------------------------------

/**
 * Classify all fetched data: source priors -> keyword rules -> LLM fallback.
 * Then drop `social-news` items (fail-open: `other` is kept).
 */
export async function classifyAllData(
  allData: HotData[],
  configKeywordTags: Record<string, string[]>,
): Promise<ClassifiedData[]> {
  const keywordTags = mergeKeywordTags(configKeywordTags);

  const classified: ClassifiedData[] = allData.map((d) => {
    const sourceTags = (d.source.tags ?? []).filter(isEntTag);
    return {
      source: d.source,
      fetchSuccess: d.fetchSuccess,
      items: d.items.map((it) => classifyItemWithRules(it, sourceTags, keywordTags)),
    };
  });

  // LLM fallback only for `other` items from sources without priors.
  const others = classified
    .filter((d) => !(d.source.tags && d.source.tags.length > 0))
    .flatMap((d) => d.items.filter((it) => it.tags.length === 1 && it.tags[0] === "other"));
  if (others.length > 0) {
    console.log(`  [classify] ${others.length} items -> LLM fallback classification...`);
    await classifyBatchWithLlm(others);
  }

  // Filter social-news at the data layer (P2's prompt filter stays as backup).
  for (const d of classified) {
    const before = d.items.length;
    d.items = d.items.filter((it) => !it.tags.includes("social-news"));
    const dropped = before - d.items.length;
    if (dropped > 0) console.log(`  [classify] [${d.source.id}] dropped ${dropped} social-news items`);
  }

  return classified;
}

/**
 * Aggregate classified items across all sources by content tag, deduped by
 * title. Items carry their source display name for the tag reports.
 */
export function aggregateByTag(allData: ClassifiedData[]): Record<ContentTag, TaggedItem[]> {
  const byTag = Object.fromEntries(CONTENT_TAGS.map((t) => [t, [] as TaggedItem[]])) as Record<
    ContentTag,
    TaggedItem[]
  >;
  const seen = new Set<string>();

  for (const d of allData) {
    for (const item of d.items) {
      for (const tag of item.tags) {
        if (!CONTENT_TAGS.includes(tag as ContentTag)) continue;
        const key = `${tag}:${item.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byTag[tag as ContentTag].push({ ...item, sourceName: d.source.name });
      }
    }
  }

  return byTag;
}
