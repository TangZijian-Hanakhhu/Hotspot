/**
 * popular-radar: daily digest for short-video platform hot trends,
 * targeted at 娱乐/舞蹈/游戏自媒体创作者.
 *
 * Pipeline:
 *   1.   Fetch all hot sources in parallel via DailyHotApi
 *   1.5  Classify every item (source priors -> keyword rules -> LLM fallback),
 *        drop social-news noise
 *   2.   Per-source reports for sources with `report: true` (综合源)
 *   2.5  Cross-source tag reports (ai-bgm/ai-dance/ai-meme/ai-game/ai-fandom)
 *   3.   Highlights for Telegram/Feishu notifications
 *
 * Chinese-only: data sources are Chinese platforms, so no English reports
 * are generated (saves ~50% LLM tokens).
 *
 * Env vars:
 *   LLM_PROVIDER        - "anthropic" | "openai" | "github-copilot" | "openrouter" | "deepseek" | "volcano"
 *   GITHUB_TOKEN        - GitHub token for issue creation
 *   DIGEST_REPO         - owner/repo where digest issues are posted (optional)
 *   DAILYHOT_BASE_URL   - self-hosted DailyHotApi base URL
 */

import { loadConfig } from "./config.ts";
import { fetchAllHotData } from "./hot.ts";
import { classifyAllData, aggregateByTag, CONTENT_TAGS } from "./classify.ts";
import { saveHotReport, saveTagReport } from "./report-savers.ts";
import { callLlm, parseLlmJson, saveFile, autoGenFooter } from "./report.ts";
import { buildHighlightsPrompt, type ReportHighlights } from "./prompts-data.ts";
import { toCstDateStr, toUtcStr } from "./date.ts";

// ---------------------------------------------------------------------------
// Repo config - loaded from config.yml, falls back to built-in defaults
// ---------------------------------------------------------------------------

const { hotSources: HOT_SOURCES, keywordTags: KEYWORD_TAGS } = loadConfig();

// Highlights output budget - raised from 2048 since tag reports joined the
// report set (up to ~7 reports feed the prompt).
const LLM_TOKENS_HIGHLIGHTS = 3072;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  requireEnv("GITHUB_TOKEN");

  const now = new Date();
  const dateStr = toCstDateStr(now);
  const utcStr = toUtcStr(now);
  const digestRepo = process.env["DIGEST_REPO"] ?? "";

  const providerName = process.env["LLM_PROVIDER"] ?? "anthropic";
  console.log(`[${now.toISOString()}] Starting digest | provider: ${providerName}`);
  console.log(`  Tracking: ${HOT_SOURCES.map((s) => s.id).join(", ")}`);

  // 1. Fetch all hot sources in parallel
  console.log("  Fetching hot data in parallel...");
  const allHotData = await fetchAllHotData(HOT_SOURCES);

  // 1.5 Classify + filter social-news (source priors -> keywords -> LLM)
  console.log("  Classifying items...");
  const classified = await classifyAllData(allHotData, KEYWORD_TAGS);

  // 2 + 2.5 Generate all reports in parallel:
  //   - per-source reports for sources with report: true (综合源)
  //   - cross-source tag reports for each content tag (专项报告)
  console.log("  Generating source + tag reports in parallel...");
  const reportContents: Record<string, string> = {};
  const footer = autoGenFooter();

  const byTag = aggregateByTag(classified);

  await Promise.all([
    ...classified
      .filter((d) => d.source.report)
      .map(async (data) => {
        const content = await saveHotReport(data, utcStr, dateStr, digestRepo, footer);
        if (content) reportContents[`ai-${data.source.id}`] = content;
      }),
    ...CONTENT_TAGS.map(async (tag) => {
      const content = await saveTagReport(tag, byTag[tag], utcStr, dateStr, digestRepo, footer);
      if (content) reportContents[`ai-${tag}`] = content;
    }),
  ]);

  // 3. Generate highlights for Telegram/Feishu notifications
  console.log("  Generating highlights for notifications...");
  let highlights: ReportHighlights = {};
  try {
    const raw = await callLlm(buildHighlightsPrompt(reportContents), LLM_TOKENS_HIGHLIGHTS);
    highlights = parseLlmJson<ReportHighlights>(raw);
  } catch (err) {
    console.error(`  [highlights] generation failed: ${err}`);
  }

  const highlightsPath = saveFile(JSON.stringify(highlights, null, 2), dateStr, "highlights.json");
  console.log(`  Saved ${highlightsPath}`);

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
