/**
 * DailyHotApi client - fetches hot/trending data from short-video & content
 * platforms via a self-hosted instance of imsyy/DailyHotApi.
 *
 * DailyHotApi exposes a uniform interface: `GET <base>/<platform>?cache=false&limit=N`
 * returns `{ code, name, title, link, total, updateTime, data: ListItem[] }`.
 * Every endpoint shares the same ListItem shape, so a single generic fetcher
 * serves all platforms. The `type` query param selects a partition (e.g.
 * bilibili type=3 = music ranking).
 *
 * Env vars:
 *   DAILYHOT_BASE_URL - base URL of your self-hosted DailyHotApi instance
 *                       (default: public demo instance)
 */

import type { HotSource } from "./config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HotItem {
  id: string;
  title: string;
  cover?: string;
  author?: string;
  desc?: string;
  /** Hot score / view count. May be undefined (e.g. Weibo) or a string. */
  hot?: number;
  timestamp?: number;
  /** Desktop/web URL */
  url: string;
  /** Mobile URL */
  mobileUrl: string;
}

export interface HotData {
  source: HotSource;
  items: HotItem[];
  fetchSuccess: boolean;
}

// ---------------------------------------------------------------------------
// DailyHotApi response schema (see src/types.d.ts in imsyy/DailyHotApi)
// ---------------------------------------------------------------------------

interface ApiListItem {
  id: number | string;
  title: string;
  cover?: string;
  author?: string;
  desc?: string;
  hot?: number | string;
  timestamp?: number;
  url: string;
  mobileUrl: string;
}

interface ApiResponse {
  code: number;
  name?: string;
  title?: string;
  link?: string;
  total?: number;
  updateTime?: string;
  data?: ApiListItem[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://api-hot.imsyy.top";
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** Parse the numeric hot value, tolerating string values (e.g. "12,345"). */
function parseHot(raw: number | string | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return raw;
  const cleaned = String(raw).replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : undefined;
}

function toItem(raw: ApiListItem): HotItem {
  const item: HotItem = {
    id: String(raw.id),
    title: raw.title,
    url: raw.url,
    mobileUrl: raw.mobileUrl,
  };
  if (raw.cover) item.cover = raw.cover;
  if (raw.author) item.author = raw.author;
  if (raw.desc) item.desc = raw.desc;
  const hot = parseHot(raw.hot);
  if (hot !== undefined) item.hot = hot;
  if (raw.timestamp !== undefined) item.timestamp = raw.timestamp;
  return item;
}

/**
 * Fetch hot/trending data for a single source from DailyHotApi.
 *
 * Returns `{ fetchSuccess: false, items: [] }` on any error so the caller can
 * `.catch()` it without crashing the whole pipeline (same pattern as
 * agents-radar's fetchers).
 */
export async function fetchHotData(source: HotSource): Promise<HotData> {
  const base = (process.env["DAILYHOT_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/$/, "");
  const params = new URLSearchParams({
    cache: "false",
    limit: String(source.limit),
  });
  if (source.type !== undefined) params.set("type", source.type);

  const url = `${base}/${source.platform}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: { "User-Agent": "popular-radar/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      console.error(`  [${source.id}] HTTP ${resp.status} from ${source.platform}`);
      return { source, items: [], fetchSuccess: false };
    }

    // DailyHotApi returns JSON on success; on upstream failure it may return
    // an HTML error page (Hono onError), so guard the parse.
    const text = await resp.text();
    let data: ApiResponse;
    try {
      data = JSON.parse(text) as ApiResponse;
    } catch {
      console.error(`  [${source.id}] Non-JSON response from ${source.platform}`);
      return { source, items: [], fetchSuccess: false };
    }

    if (data.code !== 200 || !Array.isArray(data.data)) {
      console.error(`  [${source.id}] Bad response code=${data.code} from ${source.platform}`);
      return { source, items: [], fetchSuccess: false };
    }

    const items = data.data.map(toItem);
    console.log(`  [${source.id}] ${items.length} items from ${source.platform}`);
    return { source, items, fetchSuccess: items.length > 0 };
  } catch (err) {
    console.error(`  [${source.id}] fetch failed: ${err}`);
    return { source, items: [], fetchSuccess: false };
  }
}

/** Fetch all configured sources in parallel, each with its own `.catch()` fallback. */
export async function fetchAllHotData(sources: HotSource[]): Promise<HotData[]> {
  return Promise.all(
    sources.map((s) => fetchHotData(s).catch((): HotData => ({ source: s, items: [], fetchSuccess: false }))),
  );
}
