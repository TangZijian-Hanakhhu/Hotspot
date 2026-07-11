import { describe, it, expect } from "vitest";
import { parseLlmJson } from "../report.ts";
import type { HotSource } from "../config.ts";
import type { HotData } from "../hot.ts";

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
