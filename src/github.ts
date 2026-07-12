/**
 * GitHub API helpers for issue management.
 *
 * This is a slimmed-down version of agents-radar's github.ts - it keeps only
 * the issue creation / label management / stale-issue cleanup helpers, since
 * popular-radar does not track any GitHub repositories.
 *
 * Reads GITHUB_TOKEN and DIGEST_REPO from environment at call time.
 */

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env["GITHUB_TOKEN"] ?? ""}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubGet<T>(url: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const resp = await fetch(u.toString(), { headers: headers() });
  if (!resp.ok) throw new Error(`GitHub API error ${resp.status} (${url}): ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

export async function ensureLabel(name: string, color: string): Promise<void> {
  const digestRepo = process.env["DIGEST_REPO"] ?? "";
  const resp = await fetch(`https://api.github.com/repos/${digestRepo}/labels`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  if (!resp.ok && resp.status !== 422) {
    throw new Error(`Failed to create label "${name}": ${await resp.text()}`);
  }
}

const GITHUB_ISSUE_BODY_LIMIT = 65536;
const TRUNCATION_NOTICE = "\n\n---\n> ⚠️ 内容超过 GitHub Issue 上限，完整报告见提交的 Markdown 文件。";

/** GitHub label colors by label name. Default: "0075ca". */
const LABEL_COLORS: Record<string, string> = {
  douyin: "000000",
  bili: "fb7299",
  "bili-music": "ff6b9d",
  bgm: "f97316",
  dance: "ec4899",
  meme: "eab308",
  game: "22c55e",
  fandom: "a855f7",
  weekly: "7c3aed",
  monthly: "0d9488",
};

/**
 * Break GitHub URLs in issue body to prevent cross-repository references.
 * Inserts a zero-width space in "github.com" so GitHub's auto-linker
 * won't create "mentioned this issue" notifications on external repos.
 */
function neutralizeGitHubRefs(text: string): string {
  return (
    text
      // Prevent "mentioned this issue" cross-references
      .replace(/https:\/\/github\.com\//g, "https://github\u200B.com/")
      // Prevent @mention notifications - insert zero-width space after @
      .replace(/@([a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38})/g, "@\u200B$1")
  );
}

/**
 * Close open issues created more than `days` days ago.
 * Uses pagination to handle large backlogs. Returns the number of issues closed.
 */
export async function closeStaleIssues(days: number): Promise<number> {
  const digestRepo = process.env["DIGEST_REPO"] ?? "";
  if (!digestRepo) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  let closed = 0;

  // Always re-fetch page 1: closing issues shifts pagination, so incrementing
  // pages would skip items.
  while (true) {
    const issues = await githubGet<{ number: number; created_at: string }[]>(
      `https://api.github.com/repos/${digestRepo}/issues`,
      { state: "open", sort: "created", direction: "asc", per_page: "100" },
    );
    if (issues.length === 0) break;

    const stale = issues.filter((i) => new Date(i.created_at) < cutoff);
    if (stale.length === 0) break;

    await Promise.all(
      stale.map(async (i) => {
        const resp = await fetch(`https://api.github.com/repos/${digestRepo}/issues/${i.number}`, {
          method: "PATCH",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ state: "closed" }),
        });
        if (!resp.ok) console.error(`[github] Failed to close #${i.number}: ${resp.status}`);
      }),
    );
    closed += stale.length;
  }
  return closed;
}

export async function createGitHubIssue(title: string, body: string, label: string): Promise<string> {
  const digestRepo = process.env["DIGEST_REPO"] ?? "";
  body = neutralizeGitHubRefs(body);
  if (body.length > GITHUB_ISSUE_BODY_LIMIT) {
    body = body.slice(0, GITHUB_ISSUE_BODY_LIMIT - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
  }
  await ensureLabel(label, LABEL_COLORS[label] ?? "0075ca");
  const resp = await fetch(`https://api.github.com/repos/${digestRepo}/issues`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, labels: [label] }),
  });
  if (!resp.ok) throw new Error(`Failed to create issue: ${await resp.text()}`);
  const data = (await resp.json()) as { html_url: string };
  return data.html_url;
}
