import { describe, it, expect } from "vitest";
import { KEYWORDS, KEYWORD_LABELS, resolveKeywordLabel } from "@/lib/config";

describe("Config Keywords & Labels", () => {
  it("ensures all KEYWORDS entries exist as keys in KEYWORD_LABELS", () => {
    for (const keyword of KEYWORDS) {
      expect(KEYWORD_LABELS).toHaveProperty(keyword);
    }
  });

  it("resolves keyword label correctly or falls back", () => {
    expect(resolveKeywordLabel("NTT")).toBeDefined();
    expect(resolveKeywordLabel("UnknownKeyword")).toBe("UnknownKeyword");
  });
});
