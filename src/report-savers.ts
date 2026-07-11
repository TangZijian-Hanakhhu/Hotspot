/**
 * Report orchestration layer - LLM call + file save + GitHub issue creation.
 *
 * A single generic `saveHotReport` handles all hot-source report types,
 * selecting the keyword vs video prompt builder based on the source config.
 * Follows the same guard -> LLM -> header -> saveFile -> issue -> catch
 * pattern as agents-radar's saveHnReport. Chinese-only.
 */

import { getReportMeta, ISSUE_LABELS } from "./i18n.ts";
import { buildKeywordsPrompt, buildVideosPrompt } from "./prompts-data.ts";
import { callLlm, saveFile, extractFromFirstH2 } from "./report.ts";
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
 */
export async function saveHotReport(
  data: HotData,
  utcStr: string,
  dateStr: string,
  digestRepo: string,
  footer: string,
): Promise<string | null> {
  // 1. Guard - skip if fetch failed
  if (!data.fetchSuccess || data.items.length === 0) {
    console.log(`  [${data.source.id}] No data available, skipping report.`);
    return null;
  }

  console.log(`  [${data.source.id}] Calling LLM for report...`);
  try {
    // 2. LLM call - select prompt builder by data type
    const prompt =
      data.source.contentType === "keywords"
        ? buildKeywordsPrompt(data, dateStr)
        : buildVideosPrompt(data, dateStr);
    const raw = await callLlm(prompt);

    // Output contract: body must start at its first "## " section. This
    // deterministically drops a duplicated H1 title or any stray prose /
    // reasoning text before the report proper.
    const summary = extractFromFirstH2(raw);
    if (!summary) {
      console.error(`  [${data.source.id}] Output has no "## " section anchor, skipping publish.`);
      return null;
    }

    // 3. Filename: ai-<id>.md
    const fileName = `ai-${data.source.id}.md`;

    // 4. Header
    const meta = getReportMeta(data.source);
    const count = data.items.length;
    const header =
      `# ${meta.title} ${dateStr}\n\n` +
      `> 数据来源: ${data.source.name} | 共 ${count} 条 | 生成时间: ${utcStr} UTC\n\n` +
      `---\n\n`;

    // 5. Assemble + save
    const content = header + summary + footer;
    console.log(`  Saved ${saveFile(content, dateStr, fileName)}`);

    // 6. GitHub issue (optional)
    if (digestRepo) {
      const title = meta.issueTitle(dateStr);
      const label = ISSUE_LABELS[data.source.id] ?? data.source.id;
      const issueUrl = await createGitHubIssue(title, content, label);
      console.log(`  Created issue: ${issueUrl}`);
    }

    // 7. Return content for highlights generation
    return content;
  } catch (err) {
    console.error(`  [${data.source.id}] Report generation failed: ${err}`);
    return null;
  }
}
