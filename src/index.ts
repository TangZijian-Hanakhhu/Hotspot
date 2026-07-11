/**
 * popular-radar: daily digest for short-video platform hot trends.
 *
 * Pipeline (mirrors agents-radar's structure, simplified for hot sources):
 *   1. Fetch all hot sources in parallel via DailyHotApi
 *   2. Generate Chinese reports in parallel (one report per source)
 *   3. Generate highlights for Telegram/Feishu notifications
 *   4. Create GitHub issues
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
import { saveHotReport } from "./report-savers.ts";
import { callLlm, parseLlmJson, saveFile, autoGenFooter } from "./report.ts";
import { buildHighlightsPrompt, type ReportHighlights } from "./prompts-data.ts";
import { toCstDateStr, toUtcStr } from "./date.ts";

// ---------------------------------------------------------------------------
// Repo config - loaded from config.yml, falls back to built-in defaults
// ---------------------------------------------------------------------------

const { hotSources: HOT_SOURCES } = loadConfig();

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

  // 2. Generate + save all reports in parallel (Chinese only)
  console.log("  Generating and saving reports in parallel...");
  const reportContents: Record<string, string> = {};
  const footer = autoGenFooter();

  await Promise.all(
    allHotData.map(async (data) => {
      const content = await saveHotReport(data, utcStr, dateStr, digestRepo, footer);
      if (content) {
        reportContents[`ai-${data.source.id}`] = content;
      }
    }),
  );

  // 3. Generate highlights for Telegram/Feishu notifications
  console.log("  Generating highlights for notifications...");
  let highlights: ReportHighlights = {};
  try {
    const raw = await callLlm(buildHighlightsPrompt(reportContents), 2048);
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
