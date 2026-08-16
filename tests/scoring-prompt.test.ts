import { describe, expect, test } from "vitest";
import { SCORING_PROMPT, BATCH_SCORING_PROMPT } from "@/lib/llm/prompts";
import { buildPreferencePromptSection } from "@/lib/llm/preference";

describe("スコアリングプロンプト: usefulness はエンジニア/テックリーダー向け（一般有用性除外）", () => {
  for (const [name, prompt] of [
    ["SCORING_PROMPT", SCORING_PROMPT],
    ["BATCH_SCORING_PROMPT", BATCH_SCORING_PROMPT],
  ] as const) {
    test(`${name}: エンジニア/テックリーダー視点であること`, () => {
      expect(prompt).toContain("技術者・テックリーダー");
    });
    test(`${name}: 一般的な有用性を除外していること`, () => {
      expect(prompt).toContain("一般的な有用性");
    });
    test(`${name}: ntt_relevance を要求していること`, () => {
      expect(prompt).toContain("ntt_relevance");
    });
    test(`${name}: topic を要求していないこと（NTTタグは ntt_relevance の閾値判定で付与する）`, () => {
      expect(prompt).not.toContain("topic");
    });
  }

  test("両プロンプトが {{preferenceSection}} プレースホルダを含むこと", () => {
    expect(SCORING_PROMPT).toContain("{{preferenceSection}}");
    expect(BATCH_SCORING_PROMPT).toContain("{{preferenceSection}}");
  });

  test("プレースホルダの置換後に未置換の {{ が残らないこと", () => {
    const renderedScoring = SCORING_PROMPT.replace("{{title}}", () => "Title")
      .replace("{{description}}", () => "Description")
      .replace("{{preferenceSection}}", () => buildPreferencePromptSection(null));

    expect(renderedScoring).not.toContain("{{");

    const renderedBatch = BATCH_SCORING_PROMPT.replace("{{articleCount}}", () => "1")
      .replace("{{articles}}", () => "Articles")
      .replace("{{preferenceSection}}", () => buildPreferencePromptSection(null));

    expect(renderedBatch).not.toContain("{{");
  });

  test("buildPreferencePromptSection の空入力の挙動", () => {
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
});
