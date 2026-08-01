import { describe, it, expect } from "vitest";
import { KEYWORDS, KEYWORD_LABELS } from "@/lib/config";

describe("Config Keywords & Labels", () => {
  it("includes updated NTT keyword string", () => {
    expect(KEYWORDS).toContain("NTT NTTデータ NTT東日本 NTT西日本 IOWN 光電融合");
  });

  it("includes updated docomo keyword string", () => {
    expect(KEYWORDS).toContain("docomo ドコモ ドコモビジネス business");
  });

  it("does not include old NTT and docomo keyword strings", () => {
    expect(KEYWORDS).not.toContain("NTT 日本電信電話 NTTデータ NTTドコモ");
    expect(KEYWORDS).not.toContain("docomo ドコモ NTTドコモ モバイル通信 キャリア");
  });

  it("ensures all KEYWORDS entries exist as keys in KEYWORD_LABELS", () => {
    for (const keyword of KEYWORDS) {
      expect(KEYWORD_LABELS).toHaveProperty(keyword);
    }
  });

  it("ensures KEYWORD_LABELS contains 'NTT' and 'docomo' values", () => {
    const values = Object.values(KEYWORD_LABELS);
    expect(values).toContain("NTT");
    expect(values).toContain("docomo");
  });

  it("ensures no overlapping words between NTT and docomo keywords", () => {
    const nttKeyword = "NTT NTTデータ NTT東日本 NTT西日本 IOWN 光電融合";
    const docomoKeyword = "docomo ドコモ ドコモビジネス business";

    const nttWords = new Set(nttKeyword.split(/\s+/));
    const docomoWords = new Set(docomoKeyword.split(/\s+/));

    for (const word of nttWords) {
      expect(docomoWords.has(word)).toBe(false);
    }
  });

  it("ensures each keyword has multiple space-separated words with no empty entries", () => {
    for (const keyword of KEYWORDS) {
      const trimmed = keyword.trim();
      expect(trimmed.length).toBeGreaterThan(0);
      const parts = trimmed.split(/\s+/);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
      }
    }
  });
});
