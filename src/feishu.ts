/**
 * Feishu (Lark) notification - reads manifest.json and sends a card message
 * with links to the latest reports. Skips silently if secrets are not set.
 *
 * Ported from agents-radar - only the branding and PAGES_URL default differ.
 * Chinese-only.
 *
 * Required env vars:
 *   FEISHU_WEBHOOK_URLS - comma-separated list of custom bot webhook URLs
 *                         (also accepts legacy FEISHU_WEBHOOK_URL for one URL)
 * Optional:
 *   PAGES_URL           - GitHub Pages base URL
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NOTIFY_LABELS } from "./i18n.ts";
import { loadConfig } from "./config.ts";
import type { ReportHighlights } from "./prompts-data.ts";

const PAGES_URL_DEFAULT = "https://tangzijian-hanakhhu.github.io/popular-radar";

function getWebhookUrls(): string[] {
  const raw = process.env["FEISHU_WEBHOOK_URLS"] ?? process.env["FEISHU_WEBHOOK_URL"] ?? "";
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

async function sendToOneWebhook(webhookUrl: string, title: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: title },
          template: "blue",
        },
        elements: [{ tag: "markdown", content }],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Feishu API ${res.status}: ${body}`);
  }
}

async function sendFeishu(title: string, content: string): Promise<void> {
  const urls = getWebhookUrls();
  const results = await Promise.allSettled(urls.map((url) => sendToOneWebhook(url, title, content)));
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) {
    const msgs = failures.map((r) => (r as PromiseRejectedResult).reason);
    console.error(`[feishu] ${failures.length}/${urls.length} webhook(s) failed:`, msgs);
    if (failures.length === urls.length) throw new Error("All Feishu webhooks failed");
  }
}

export function buildFeishuMessage(
  date: string,
  reports: string[],
  pagesUrl?: string,
  highlights?: ReportHighlights | null,
  includeReports?: string[] | null,
): string {
  const PAGES_URL = (pagesUrl ?? process.env["PAGES_URL"] ?? PAGES_URL_DEFAULT).replace(/\/$/, "");
  // Defensive: drop legacy -en entries from historical manifests
  let baseReports = reports.filter((r) => !r.endsWith("-en"));
  // Profile routing (P5): keep only the reports this creator cares about
  if (includeReports && includeReports.length > 0) {
    baseReports = baseReports.filter((r) => includeReports.includes(r));
  }
  const isWeekly = baseReports.includes("ai-weekly");
  const isMonthly = baseReports.includes("ai-monthly");

  const icon = isMonthly ? "📆" : isWeekly ? "📅" : "📡";
  const suffix = isMonthly ? " 月报" : isWeekly ? " 周报" : "";
  const lines: string[] = [`${icon} **popular-radar${suffix} · ${date}**`];

  const ordered = [
    ...baseReports.filter((r) => !r.includes("weekly") && !r.includes("monthly")),
    ...baseReports.filter((r) => r.includes("weekly") || r.includes("monthly")),
  ];

  for (const r of ordered) {
    const label = NOTIFY_LABELS[r] ?? r;
    const url = `${PAGES_URL}/#${date}/${r}`;

    lines.push("");
    lines.push(`• [${label}](${url})`);

    const items = highlights?.[r];
    if (items?.length) {
      for (const h of items) {
        lines.push(`  ◦ ${h}`);
      }
    }
  }

  lines.push(`\n[🌐 Web UI](${PAGES_URL})  ·  [⊕ RSS](${PAGES_URL}/feed.xml)`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const urls = getWebhookUrls();
  const hasProfileWebhook = loadConfig().creatorProfiles.some((p) =>
    (process.env[p.feishuWebhookEnv] ?? "").trim(),
  );
  if (!urls.length && !hasProfileWebhook) {
    console.log("[feishu] No FEISHU_WEBHOOK_URLS or profile webhooks set - skipping.");
    return;
  }

  if (!fs.existsSync("manifest.json")) {
    console.log("[feishu] manifest.json not found - skipping.");
    return;
  }

  const { dates } = JSON.parse(fs.readFileSync("manifest.json", "utf-8")) as {
    dates: { date: string; reports: string[] }[];
  };

  const latest = dates?.[0];
  if (!latest) {
    console.log("[feishu] manifest is empty - skipping.");
    return;
  }
  const { date, reports } = latest;

  let highlights: ReportHighlights | null = null;
  const highlightsPath = path.join("digests", date, "highlights.json");
  if (fs.existsSync(highlightsPath)) {
    try {
      highlights = JSON.parse(fs.readFileSync(highlightsPath, "utf-8")) as ReportHighlights;
    } catch {
      console.log("[feishu] Failed to parse highlights.json - sending without highlights.");
    }
  }

  const isMonthly = reports.some((r) => r === "ai-monthly");
  const isWeekly = reports.some((r) => r === "ai-weekly");
  const icon = isMonthly ? "📆" : isWeekly ? "📅" : "📡";
  const suffix = isMonthly ? " 月报" : isWeekly ? " 周报" : "";

  // 1. Full push to the default webhooks (unchanged behaviour)
  if (urls.length > 0) {
    const title = `${icon} popular-radar${suffix} · ${date}`;
    const content = buildFeishuMessage(date, reports, undefined, highlights);
    console.log(`[feishu] Sending to ${urls.length} webhook(s) for ${date} (${reports.length} reports)…`);
    await sendFeishu(title, content);
  }

  // 2. Profile-routed pushes (P5): each creator profile gets only the tag
  //    reports it cares about, on its own webhook. Unconfigured -> skip.
  const { creatorProfiles } = loadConfig();
  for (const profile of creatorProfiles) {
    const webhook = (process.env[profile.feishuWebhookEnv] ?? "").trim();
    if (!webhook) continue; // silently skip unconfigured profiles

    const includeReports = profile.cares.map((tag) => `ai-${tag}`);
    const matched = reports.filter((r) => includeReports.includes(r));
    if (matched.length === 0) {
      console.log(`[feishu] [${profile.id}] no matching reports today - skipping.`);
      continue;
    }

    const title = `${icon} popular-radar·${profile.name}${suffix} · ${date}`;
    const content = buildFeishuMessage(date, reports, undefined, highlights, includeReports);
    console.log(`[feishu] [${profile.id}] Sending ${matched.length} report(s)…`);
    try {
      await sendToOneWebhook(webhook, title, content);
    } catch (err) {
      // One profile failing must not block the others.
      console.error(`[feishu] [${profile.id}] push failed: ${err}`);
    }
  }

  console.log("[feishu] Done!");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error("[feishu]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
