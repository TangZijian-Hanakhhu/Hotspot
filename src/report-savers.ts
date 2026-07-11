/**
 * Report orchestration layer - LLM call + file save + GitHub issue creation.
 *
 * A single generic `saveHotReport` handles all hot-source report types,
 * selecting the keyword vs video prompt builder based on the source config.
 * Follows the same guard -> LLM -> header -> saveFile -> issue -> catch
 * pattern as agents-radar's saveHnReport.
 */

import { type Lang, getReportMeta, ISSUE_LABELS } from "./i18n.ts";
import { buildKeywordsPrompt, buildVideosPrompt } from "./prompts-data.ts";
import { callLlm, saveFile } from "./report.ts";
import { createGitHubIssue } from "./github.ts";
import type { HotData } from "./hot.ts";

/**
 * Generate and save a hot-source daily report.
 *
 * @param data       - fetched hot data for one source
 * @param utcStr     - compact UTC timestamp for the header
 * @param dateStr    - CST date string (used for file path + issue title)
 * @param digestRepo - GitHub owner/repo for issue creation (empty = skip issues)
 * @param footer     - auto-generated footer markdown
 * @param lang       - "zh" | "en"
 */
export async function saveHotReport(
  data: HotData,
  utcStr: string,
  dateStr: string,
  digestRepo: string,
  footer: string,
  lang: Lang = "zh",
): Promise<string | null> {
  // 1. Guard - skip if fetch failed
  if (!data.fetchSuccess || data.items.length === 0) {
    console.log(`  [${data.source.id}/${lang}] No data available, skipping report.`);
    return null;
  }

  console.log(`  [${data.source.id}/${lang}] Calling LLM for report...`);
  try {
    // 2. LLM call - select prompt builder by data type
    const prompt =
      data.source.contentType === "keywords"
        ? buildKeywordsPrompt(data, dateStr, lang)
        : buildVideosPrompt(data, dateStr, lang);
    const summary = await callLlm(prompt);

    // 3. Filename: ai-<id>.md (zh) or ai-<id>-en.md (en)
    const suffix = lang === "en" ? "-en" : "";
    const fileName = `ai-${data.source.id}${suffix}.md`;

    // 4. Header
    const meta = getReportMeta(data.source);
    const count = data.items.length;
    const header =
      lang === "en"
        ? `# ${meta.title[lang]} ${dateStr}\n\n` +
          `> Source: ${data.source.name} | ${count} items | Generated: ${utcStr} UTC\n\n` +
          `---\n\n`
        : `# ${meta.title[lang]} ${dateStr}\n\n` +
          `> 数据来源: ${data.source.name} | 共 ${count} 条 | 生成时间: ${utcStr} UTC\n\n` +
          `---\n\n`;

    // 5. Assemble + save
    const content = header + summary + footer;
    console.log(`  Saved ${saveFile(content, dateStr, fileName)}`);

    // 6. GitHub issue (optional)
    if (digestRepo) {
      const title = meta.issueTitle(dateStr, lang);
      const label = ISSUE_LABELS[data.source.id]?.[lang] ?? data.source.id;
      const issueUrl = await createGitHubIssue(title, content, label);
      console.log(`  Created issue (${lang}): ${issueUrl}`);
    }

    // 7. Return content for highlights generation
    return content;
  } catch (err) {
    console.error(`  [${data.source.id}/${lang}] Report generation failed: ${err}`);
    return null;
  }
}
