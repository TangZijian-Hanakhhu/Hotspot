import { describe, it, expect } from "vitest";
import { classifyItemWithRules, mergeKeywordTags, aggregateByTag, type ClassifiedData } from "../classify.ts";
import type { HotItem } from "../hot.ts";
import type { HotSource } from "../config.ts";

function item(title: string): HotItem {
  return { id: title, title, url: "https://example.com", mobileUrl: "https://example.com" };
}

function source(id: string, tags?: string[]): HotSource {
  const s: HotSource = {
    id,
    platform: id,
    name: `${id}源`,
    limit: 10,
    contentType: "keywords",
    report: false,
  };
  if (tags) s.tags = tags;
  return s;
}

describe("classifyItemWithRules", () => {
  const kw = mergeKeywordTags({ 水果派: ["meme"], 节奏天国: ["game"] });

  it("entertainment keyword beats social-news keyword (no false filtering)", () => {
    const r = classifyItemWithRules(item("原神台风救援主题活动上线"), [], kw);
    expect(r.tags).toContain("game");
    expect(r.tags).not.toContain("social-news");
  });

  it("pure social-news title is tagged social-news", () => {
    const r = classifyItemWithRules(item("某地台风红色预警政策通报"), [], kw);
    expect(r.tags).toEqual(["social-news"]);
  });

  it("source priors preset tags without keyword match", () => {
    const r = classifyItemWithRules(item("完全普通的标题"), ["dance"], kw);
    expect(r.tags).toEqual(["dance"]);
  });

  it("config keyword_tags extend built-ins (抽象梗可配置追加)", () => {
    expect(classifyItemWithRules(item("杨明熙水果派名场面"), [], kw).tags).toContain("meme");
    expect(classifyItemWithRules(item("节奏天国新关卡"), [], kw).tags).toContain("game");
  });

  it("unmatched title falls back to other (kept, not filtered)", () => {
    expect(classifyItemWithRules(item("看不出类别的标题"), [], kw).tags).toEqual(["other"]);
  });

  it("mergeKeywordTags drops invalid tag names from config", () => {
    const merged = mergeKeywordTags({ 某词: ["not-a-tag"], 好词: ["meme"] });
    expect(merged["某词"]).toBeUndefined();
    expect(merged["好词"]).toEqual(["meme"]);
  });
});

describe("aggregateByTag", () => {
  it("groups across sources, keeps source name, dedupes by title", () => {
    const d1: ClassifiedData = {
      source: source("a"),
      fetchSuccess: true,
      items: [{ ...item("热门舞蹈A"), tags: ["dance"] }],
    };
    const d2: ClassifiedData = {
      source: source("b"),
      fetchSuccess: true,
      items: [
        { ...item("热门舞蹈A"), tags: ["dance"] }, // duplicate title -> deduped
        { ...item("某抽象梗"), tags: ["meme"] },
        { ...item("社会新闻"), tags: ["social-news"] }, // non-content tag -> ignored
      ],
    };

    const byTag = aggregateByTag([d1, d2]);
    expect(byTag.dance).toHaveLength(1);
    expect(byTag.dance[0]?.sourceName).toBe("a源");
    expect(byTag.meme).toHaveLength(1);
    expect(byTag.bgm).toHaveLength(0);
    expect(byTag.game).toHaveLength(0);
    expect(byTag.fandom).toHaveLength(0);
  });
});
