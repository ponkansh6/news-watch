import { describe, expect, test } from "vitest";
import { SCORING_PROMPT, BATCH_SCORING_PROMPT } from "@/lib/llm/prompts";

describe("スコアリングプロンプト: usefulness はエンジニア/テックリーダー向け（一般有用性除外）", () => {
  for (const [name, prompt] of [
    ["SCORING_PROMPT", SCORING_PROMPT],
    ["BATCH_SCORING_PROMPT", BATCH_SCORING_PROMPT],
  ] as const) {
    test(`${name}: エンジニア/テックリーダー視点であること`, () => {
      expect(prompt).toContain("技術者・テックリーダー");
    });
    test(`${name}: 一般的な有用性を除外していること`, () => {
      // 「一般的な有用性」という語を含み、一般向け評価を除外していることを検証
      expect(prompt).toContain("一般的な有用性");
    });
  }
});
