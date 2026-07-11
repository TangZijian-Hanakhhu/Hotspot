import { describe, it, expect } from "vitest";
import { parseLlmJson, stripThinkTags, extractFromFirstH2 } from "../report.ts";
import type { HotSource } from "../config.ts";
import type { HotData } from "../hot.ts";

describe("extractFromFirstH2", () => {
  it("keeps output that already starts at an H2", () => {
    expect(extractFromFirstH2("## 今日速览\n内容")).toBe("## 今日速览\n内容");
  });

  it("drops a duplicated H1 title before the first H2", () => {
    expect(extractFromFirstH2("# 抖音热搜日报（2026-07-12）\n\n## 今日速览\n内容")).toBe("## 今日速览\n内容");
  });

  it("drops stray prose / reasoning before the first H2", () => {
    expect(extractFromFirstH2("用户需要日报，先理清速览，要3-5句…\n\n## 今日速览\n内容")).toBe(
      "## 今日速览\n内容",
    );
  });

  it("accepts numbered H2 variants", () => {
    expect(extractFromFirstH2("# 标题\n## 1. 今日速览\n内容")).toBe("## 1. 今日速览\n内容");
  });

  it("returns null when no H2 exists (contract violation)", () => {
    expect(extractFromFirstH2("只有思考没有结构化正文")).toBeNull();
  });
});

describe("stripThinkTags", () => {
  it("keeps plain text unchanged", () => {
    expect(stripThinkTags("# 报告\n\n正文内容")).toBe("# 报告\n\n正文内容");
  });

  it("removes closed think blocks", () => {
    expect(stripThinkTags("<think>用户需要日报，先理清速览…</think>\n# 报告\n正文")).toBe("# 报告\n正文");
  });

  it("removes thinking-tag variant", () => {
    expect(stripThinkTags("<thinking>推敲过程</thinking>正文")).toBe("正文");
  });

  it("drops everything after an unclosed think tag", () => {
    expect(stripThinkTags("<think>只有思考没有正文")).toBe("");
  });

  it("removes multiple think blocks", () => {
    expect(stripThinkTags("<think>a</think>正文1<think>b</think>正文2")).toBe("正文1正文2");
  });
});

describe("parseLlmJson", () => {
  it("parses clean JSON", () => {
    expect(parseLlmJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("replaces raw control chars", () => {
    expect(parseLlmJson('{"a":"b\nc"}')).toEqual({ a: "b c" });
  });

  it("repairs trailing commas", () => {
    expect(parseLlmJson('{"a":1,}')).toEqual({ a: 1 });
  });

  it("narrows to outer object dropping prose", () => {
    expect(parseLlmJson('Here is the JSON: {"a":1} done')).toEqual({ a: 1 });
  });
});

describe("config defaults", () => {
  it("returns built-in hot sources when file missing", async () => {
    const { loadConfig } = await import("../config.ts");
    const cfg = loadConfig("nonexistent.yml");
    expect(cfg.hotSources.length).toBeGreaterThan(0);
    expect(cfg.hotSources.some((s) => s.id === "douyin")).toBe(true);
  });
});

describe("hot data shape", () => {
  it("HotData carries source and items", () => {
    const source: HotSource = {
      id: "douyin",
      platform: "douyin",
      name: "抖音热搜",
      limit: 50,
      contentType: "keywords",
    };
    const data: HotData = { source, items: [], fetchSuccess: false };
    expect(data.source.id).toBe("douyin");
    expect(data.fetchSuccess).toBe(false);
  });
});
