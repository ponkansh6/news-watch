import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  sanitizeForPrompt,
  buildFavoritesBlock,
  clampPreferencePayload,
  isUsablePreferenceAnalysis,
  analyzeFavorites,
  buildPreferencePromptSection,
} from "@/lib/llm/preference";
import { callGemini } from "@/lib/llm/client";

vi.mock("@/lib/llm/client", () => ({
  callGemini: vi.fn(),
  backoffMs: vi.fn(() => 0),
}));

describe("preference ユーティリティ & LLM分析のテスト", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("sanitizeForPrompt: 改行・制御文字・HTML/特殊文字の除去と長さ制限", () => {
    const input = "Hello\nWorld\r\t{test}<tag>`code`\x00\x1F  spaced   ";
    const result = sanitizeForPrompt(input, 50);
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\t");
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("`");
    expect(sanitizeForPrompt(null, 10)).toBe("");
    expect(sanitizeForPrompt("abcdef", 3)).toBe("abc");
  });

  test("buildFavoritesBlock: お気に入りリストの整形と最大件数制限", () => {
    const items = Array.from({ length: 105 }, (_, i) => ({
      title: `Title ${i + 1}`,
      summary: `Summary ${i + 1}`,
      keywordLabel: `Tag ${i + 1}`,
      reason: `Reason ${i + 1}`,
      score: 8.5,
    }));

    const block = buildFavoritesBlock(items);
    const lines = block.split("\n");
    expect(lines.length).toBe(100);
    expect(lines[0]).toContain("1. [Tag 1] score=8.5 | Title 1 | Summary 1 | Reason 1");

    // score null case
    const nullScoreBlock = buildFavoritesBlock([
      {
        title: "Title",
        summary: null,
        keywordLabel: null,
        reason: null,
        score: null,
      },
    ]);
    expect(nullScoreBlock).toContain("score=-");
  });

  test("clampPreferencePayload: 配列・文字列のクランプと未定義キーの補完", () => {
    const raw = {
      themes: Array.from({ length: 10 }, (_, i) => `theme-${i}`),
      traits: ["a".repeat(200)],
      dislikes: "not-an-array",
      scoringGuidance: [123, "guidance"],
      summary: "summary text",
      extraKey: "should be ignored",
    };

    const clamped = clampPreferencePayload(raw) as any;
    expect(clamped.themes.length).toBeLessThanOrEqual(6); // PREFERENCE_LIST_MAX_ITEMS
    expect(clamped.traits[0].length).toBeLessThanOrEqual(100); // PREFERENCE_ITEM_MAX_CHARS
    expect(clamped.dislikes).toEqual([]);
    expect(clamped.scoringGuidance).toEqual(["guidance"]);
    expect(clamped.summary).toBe("summary text");

    expect(clampPreferencePayload(null)).toBeNull();
    expect(clampPreferencePayload("string")).toBe("string");
  });

  test("isUsablePreferenceAnalysis: 利用可能な分析結果の判定", () => {
    expect(
      isUsablePreferenceAnalysis({
        themes: [],
        traits: [],
        dislikes: [],
        scoringGuidance: [],
        summary: "",
      }),
    ).toBe(false);
    expect(
      isUsablePreferenceAnalysis({
        themes: ["TS"],
        traits: [],
        dislikes: [],
        scoringGuidance: [],
        summary: "",
      }),
    ).toBe(true);
    expect(
      isUsablePreferenceAnalysis({
        themes: [],
        traits: [],
        dislikes: [],
        scoringGuidance: ["加点"],
        summary: "",
      }),
    ).toBe(true);
  });

  describe("analyzeFavorites", () => {
    test("空入力の場合は callGemini を呼ばず null を返す", async () => {
      const result = await analyzeFavorites([]);
      expect(result).toBeNull();
      expect(callGemini).not.toHaveBeenCalled();
    });

    test("有効な JSON が返された場合に PreferenceAnalysis を返す", async () => {
      const mockResponse = JSON.stringify({
        themes: ["TypeScript"],
        traits: ["ベンチマーク付き"],
        dislikes: [],
        scoringGuidance: ["〜な記事は加点"],
        summary: "TypeScript中心",
      });
      vi.mocked(callGemini).mockResolvedValueOnce(mockResponse);

      const items = [
        {
          title: "Test Article",
          summary: "Summary",
          keywordLabel: "TS",
          reason: "Good",
          score: 9.0,
        },
      ];

      const result = await analyzeFavorites(items);
      expect(result).toEqual({
        themes: ["TypeScript"],
        traits: ["ベンチマーク付き"],
        dislikes: [],
        scoringGuidance: ["〜な記事は加点"],
        summary: "TypeScript中心",
      });
      expect(callGemini).toHaveBeenCalledTimes(1);
    });

    test("無効な JSON の場合はリトライ後に null を返す", async () => {
      vi.mocked(callGemini).mockResolvedValue("not json at all");

      const items = [
        {
          title: "Test Article",
          summary: "Summary",
          keywordLabel: "TS",
          reason: "Good",
          score: 9.0,
        },
      ];

      const result = await analyzeFavorites(items);
      expect(result).toBeNull();
    });
  });

  describe("buildPreferencePromptSection", () => {
    test("null や空分析の場合は空文字を返す", () => {
      expect(buildPreferencePromptSection(null)).toBe("");
      expect(
        buildPreferencePromptSection({
          themes: [],
          traits: [],
          dislikes: [],
          scoringGuidance: [],
          summary: "",
        }),
      ).toBe("");
    });

    test("完全な分析結果からプロンプトセクションを構築する（dislikes無しなら除外される）", () => {
      const analysis = {
        themes: ["Next.js", "TypeScript"],
        traits: ["実践的"],
        dislikes: [],
        scoringGuidance: ["公式ドキュメントに言及しているものは加点"],
        summary: "モダンWeb開発重視",
      };

      const section = buildPreferencePromptSection(analysis);
      expect(section).toContain("関心テーマ");
      expect(section).toContain("Next.js / TypeScript");
      expect(section).toContain("好まれる性質");
      expect(section).not.toContain("避けられる傾向");
      expect(section).toContain("調整指針");
      expect(section).toContain("傾向要約");
      expect(section).not.toContain("{{");
    });

    test("非常に長い入力でも PREFERENCE_SECTION_MAX_CHARS (900文字) 以下に切り詰められること", () => {
      const analysis = {
        themes: Array.from({ length: 10 }, () => "VeryLongThemeName".repeat(5)),
        traits: ["Trait".repeat(20)],
        dislikes: ["Dislike".repeat(20)],
        scoringGuidance: ["Guidance".repeat(20)],
        summary: "Summary".repeat(100),
      };

      const section = buildPreferencePromptSection(analysis);
      expect(section.length).toBeLessThanOrEqual(900);
    });
  });
});
