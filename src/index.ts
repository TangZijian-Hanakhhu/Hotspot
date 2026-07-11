/**
 * popular-radar: daily digest for short-video platform hot trends.
 *
 * Pipeline (mirrors agents-radar's structure, simplified for hot sources):
 *   1. Fetch all hot sources in parallel via DailyHotApi
 *   2. Generate ZH + EN reports in parallel (one report per source per language)
 *   3. Generate highlights for Telegram/Feishu notifications
 *   4. Create GitHub issues
 *
 * Env vars:
 *   LLM_PROVIDER        - "anthropic" | "openai" | "github-copilot" | "openrouter" | "deepseek"
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
import { type Lang } from "./i18n.ts";

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

  // 2. Generate + save all reports (zh + en in parallel, all sources in parallel)
  console.log("  Generating and saving reports in ZH and EN in parallel...");
  const reportContents: Record<Lang, Record<string, string>> = { zh: {}, en: {} };

  const savePromises: Promise<void>[] = [];
  for (const lang of ["zh", "en"] as const) {
    const footer = autoGenFooter(lang);
    for (const data of allHotData) {
      savePromises.push(
        (async () => {
          const content = await saveHotReport(data, utcStr, dateStr, digestRepo, footer, lang);
          if (content) {
            reportContents[lang][`ai-${data.source.id}`] = content;
          }
        })(),
      );
    }
  }
  await Promise.all(savePromises);

  // 3. Generate highlights for Telegram/Feishu notifications
  console.log("  Generating highlights for notifications...");
  const highlights: Record<Lang, ReportHighlights> = { zh: {}, en: {} };
  // zh and en are parsed independently so a failure in one language doesn't
  // wipe the other (a single bad LLM response used to leave both empty).
  const [zhRes, enRes] = await Promise.allSettled([
    callLlm(buildHighlightsPrompt(reportContents.zh, "zh"), 2048),
    callLlm(buildHighlightsPrompt(reportContents.en, "en"), 2048),
  ]);
  for (const [lang, res] of [
    ["zh", zhRes],
    ["en", enRes],
  ] as const) {
    if (res.status !== "fulfilled") {
      console.error(`  [highlights] ${lang} generation failed: ${res.reason}`);
      continue;
    }
    try {
      highlights[lang] = parseLlmJson<ReportHighlights>(res.value);
    } catch (err) {
      console.error(`  [highlights] ${lang} parse failed: ${err}`);
    }
  }

  const highlightsPath = saveFile(JSON.stringify(highlights, null, 2), dateStr, "highlights.json");
  console.log(`  Saved ${highlightsPath}`);

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
