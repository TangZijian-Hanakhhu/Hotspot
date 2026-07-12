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
  /** Generate a standalone per-source report (default true). false = collect-only. */
  report: boolean;
  /** Source-level preset entertainment tags (skip per-item classification). */
  tags?: string[];
}

/** Creator profile for targeted notification routing (P5). */
export interface CreatorProfile {
  id: string;
  name: string;
  /** Entertainment tags this creator cares about (maps to ai-<tag> reports). */
  cares: string[];
  /** Env var name holding this profile's Feishu webhook URL. */
  feishuWebhookEnv: string;
}

interface RawHotSource {
  id?: string;
  platform?: string;
  name?: string;
  type?: string;
  limit?: number;
  contentType?: string;
  report?: boolean;
  tags?: string[];
}

interface RawCreatorProfile {
  id?: string;
  name?: string;
  cares?: string[];
  feishu_webhook_env?: string;
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
  keyword_tags?: Record<string, string[]>;
  creator_profiles?: RawCreatorProfile[];
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
  /** keyword -> tags mapping merged over classify.ts built-ins (config wins). */
  keywordTags: Record<string, string[]>;
  creatorProfiles: CreatorProfile[];
  recommend: RecommendConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HOT_SOURCES: HotSource[] = [
  { id: "douyin", platform: "douyin", name: "抖音热搜", limit: 50, contentType: "keywords", report: true },
  { id: "bili", platform: "bilibili", name: "B站热门视频", limit: 50, contentType: "videos", report: true },
  {
    id: "bili-music",
    platform: "bilibili",
    name: "B站热门音乐",
    type: "3",
    limit: 30,
    contentType: "videos",
    report: false,
    tags: ["bgm"],
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
    report: e.report !== false, // default true
  };
  if (e.type !== undefined) source.type = String(e.type);
  if (Array.isArray(e.tags) && e.tags.length > 0) source.tags = e.tags.map(String);
  return source;
}

function toCreatorProfile(e: RawCreatorProfile): CreatorProfile | null {
  // A profile is unusable without an id, cares and a webhook env name - skip it.
  if (!e.id || !e.feishu_webhook_env || !Array.isArray(e.cares) || e.cares.length === 0) {
    return null;
  }
  return {
    id: e.id,
    name: e.name ?? e.id,
    cares: e.cares.map(String),
    feishuWebhookEnv: e.feishu_webhook_env,
  };
}

export function loadConfig(configPath = "config.yml"): PopularRadarConfig {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    console.log(`[config] ${configPath} not found - using built-in defaults.`);
    return {
      hotSources: DEFAULT_HOT_SOURCES,
      keywordTags: {},
      creatorProfiles: [],
      recommend: DEFAULT_RECOMMEND,
    };
  }

  const raw = yaml.load(fs.readFileSync(resolved, "utf-8")) as RawConfig;

  const hotSources =
    Array.isArray(raw?.hot_sources) && raw.hot_sources.length > 0
      ? raw.hot_sources.map(toHotSource)
      : DEFAULT_HOT_SOURCES;

  const keywordTags: Record<string, string[]> = {};
  if (raw?.keyword_tags && typeof raw.keyword_tags === "object") {
    for (const [kw, tags] of Object.entries(raw.keyword_tags)) {
      if (Array.isArray(tags) && tags.length > 0) keywordTags[kw] = tags.map(String);
    }
  }

  const creatorProfiles = Array.isArray(raw?.creator_profiles)
    ? raw.creator_profiles.map(toCreatorProfile).filter((p): p is CreatorProfile => p !== null)
    : [];

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
    `[config] Loaded from ${configPath}: ${hotSources.length} hot sources ` +
      `(${hotSources.filter((s) => s.report).length} with own report), ` +
      `${Object.keys(keywordTags).length} keyword tags, ${creatorProfiles.length} creator profiles`,
  );

  return { hotSources, keywordTags, creatorProfiles, recommend };
}
