/**
 * Loads and validates popular-radar configuration from config.yml.
 * Falls back to built-in defaults if the file is missing or a section is absent.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export type ContentType = "keywords" | "videos";

export interface HotSource {
  /** Short identifier used for report filenames (e.g. "douyin" -> ai-douyin.md) */
  id: string;
  /** DailyHotApi endpoint name (e.g. "douyin", "bilibili", "kuaishou") */
  platform: string;
  /** Display name (Chinese) */
  name: string;
  /** Optional partition parameter (e.g. bilibili type "3" = music) */
  type?: string;
  /** Max number of items to fetch */
  limit: number;
  /** Data type: "keywords" (search terms) or "videos" (video/content links) */
  contentType: ContentType;
}

interface RawHotSource {
  id?: string;
  platform?: string;
  name?: string;
  type?: string;
  limit?: number;
  contentType?: string;
}

interface RawRecommendWeights {
  popularity?: number;
  recency?: number;
  relevance?: number;
}

interface RawRecommendConfig {
  top_k?: number;
  weights?: RawRecommendWeights;
}

interface RawConfig {
  hot_sources?: RawHotSource[];
  recommend?: RawRecommendConfig;
}

export interface ScoreWeights {
  popularity: number;
  recency: number;
  relevance: number;
}

export interface RecommendConfig {
  topK: number;
  weights: ScoreWeights;
}

export interface PopularRadarConfig {
  hotSources: HotSource[];
  recommend: RecommendConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HOT_SOURCES: HotSource[] = [
  { id: "douyin", platform: "douyin", name: "抖音热搜", limit: 50, contentType: "keywords" },
  { id: "bili", platform: "bilibili", name: "B站热门视频", limit: 50, contentType: "videos" },
  {
    id: "bili-music",
    platform: "bilibili",
    name: "B站热门音乐",
    type: "3",
    limit: 30,
    contentType: "videos",
  },
];

const DEFAULT_RECOMMEND: RecommendConfig = {
  topK: 5,
  weights: { popularity: 0.5, recency: 0.3, relevance: 0.2 },
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function toHotSource(e: RawHotSource): HotSource {
  const contentType = e.contentType === "videos" ? "videos" : "keywords";
  const source: HotSource = {
    id: e.id ?? "",
    platform: e.platform ?? "",
    name: e.name ?? e.id ?? "",
    limit: typeof e.limit === "number" ? e.limit : 50,
    contentType,
  };
  if (e.type !== undefined) source.type = String(e.type);
  return source;
}

export function loadConfig(configPath = "config.yml"): PopularRadarConfig {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    console.log(`[config] ${configPath} not found - using built-in defaults.`);
    return { hotSources: DEFAULT_HOT_SOURCES, recommend: DEFAULT_RECOMMEND };
  }

  const raw = yaml.load(fs.readFileSync(resolved, "utf-8")) as RawConfig;

  const hotSources =
    Array.isArray(raw?.hot_sources) && raw.hot_sources.length > 0
      ? raw.hot_sources.map(toHotSource)
      : DEFAULT_HOT_SOURCES;

  const recommend: RecommendConfig = raw?.recommend
    ? {
        topK: typeof raw.recommend.top_k === "number" ? raw.recommend.top_k : DEFAULT_RECOMMEND.topK,
        weights: {
          popularity: raw.recommend.weights?.popularity ?? DEFAULT_RECOMMEND.weights.popularity,
          recency: raw.recommend.weights?.recency ?? DEFAULT_RECOMMEND.weights.recency,
          relevance: raw.recommend.weights?.relevance ?? DEFAULT_RECOMMEND.weights.relevance,
        },
      }
    : DEFAULT_RECOMMEND;

  console.log(
    `[config] Loaded from ${configPath}: ${hotSources.length} hot sources, ` +
      `recommend topK=${recommend.topK}`,
  );

  return { hotSources, recommend };
}
