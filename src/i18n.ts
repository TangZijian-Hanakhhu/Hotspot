/**
 * Centralized user-facing strings (Chinese-only).
 *
 * All data sources are Chinese platforms, so reports and labels are Chinese
 * only. The old bilingual (zh/en) layer was removed to save LLM tokens.
 */

// ---------------------------------------------------------------------------
// Status & error messages (used in index.ts, rollup.ts)
// ---------------------------------------------------------------------------

export const MSG = {
  noData: "⚠️ 数据获取失败，无法生成报告。",
  summaryFailed: "⚠️ 摘要生成失败。",
} as const;

// ---------------------------------------------------------------------------
// Report headers & labels
// ---------------------------------------------------------------------------

export const DOUYIN_REPORT = {
  title: "抖音热搜日报",
  issueTitle: (dateStr: string) => `🔥 抖音热搜日报 ${dateStr}`,
} as const;

export const BILI_REPORT = {
  title: "B站热门视频日报",
  issueTitle: (dateStr: string) => `📺 B站热门视频日报 ${dateStr}`,
} as const;

export const BILI_MUSIC_REPORT = {
  title: "B站热门音乐日报",
  issueTitle: (dateStr: string) => `🎵 B站热门音乐日报 ${dateStr}`,
} as const;

export const WEEKLY_REPORT = {
  title: "短视频热点周报",
  coverage: "覆盖日期",
  issueTitle: (weekStr: string) => `📅 短视频热点周报 ${weekStr}`,
} as const;

export const MONTHLY_REPORT = {
  title: "短视频热点月报",
  issueTitle: (monthStr: string) => `📆 短视频热点月报 ${monthStr}`,
} as const;

export const ISSUE_LABELS: Record<string, string> = {
  douyin: "douyin",
  bili: "bili",
  "bili-music": "bili-music",
  weekly: "weekly",
  monthly: "monthly",
};

/**
 * Map a source id (from config.yml) to its report metadata.
 * Used by report-savers.ts to be fully config-driven.
 */
import type { HotSource } from "./config.ts";

interface ReportMeta {
  title: string;
  issueTitle: (dateStr: string) => string;
}

const REPORT_META_BY_ID: Record<string, ReportMeta> = {
  douyin: DOUYIN_REPORT,
  bili: BILI_REPORT,
  "bili-music": BILI_MUSIC_REPORT,
};

/** Fallback meta for sources not in the built-in map (uses source.name). */
function fallbackMeta(source: HotSource): ReportMeta {
  return {
    title: `${source.name}日报`,
    issueTitle: (dateStr: string) => `📊 ${source.name}日报 ${dateStr}`,
  };
}

export function getReportMeta(source: HotSource): ReportMeta {
  return REPORT_META_BY_ID[source.id] ?? fallbackMeta(source);
}

// ---------------------------------------------------------------------------
// Footer (used in report.ts)
// ---------------------------------------------------------------------------

export const FOOTER = {
  autoGen: "本日报由",
} as const;

// ---------------------------------------------------------------------------
// Report labels for manifest/RSS (used in generate-manifest.ts)
// ---------------------------------------------------------------------------

export const REPORT_LABELS: Record<string, string> = {
  "ai-douyin": "抖音热搜日报",
  "ai-bili": "B站热门视频日报",
  "ai-bili-music": "B站热门音乐日报",
  "ai-weekly": "短视频热点周报",
  "ai-monthly": "短视频热点月报",
};

// ---------------------------------------------------------------------------
// Telegram / Feishu notification labels (used in notify.ts / feishu.ts)
// ---------------------------------------------------------------------------

export const NOTIFY_LABELS: Record<string, string> = {
  "ai-douyin": "抖音热搜",
  "ai-bili": "B站热门",
  "ai-bili-music": "B站音乐",
  "ai-weekly": "短视频热点周报",
  "ai-monthly": "短视频热点月报",
};
