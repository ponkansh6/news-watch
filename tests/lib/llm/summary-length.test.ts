import { describe, it, expect } from "vitest";
import { SCORING_PROMPT, BATCH_SCORING_PROMPT } from "@/lib/llm/prompts";
import { LLMResponseSchema } from "@/lib/llm";
import { z } from "zod/v4";

describe("Summary length and prompt constraints (20-40 characters)", () => {
  it("SCORING_PROMPT explicitly instructs 20-40 character summary in Japanese", () => {
    expect(SCORING_PROMPT).toContain("20-40 chars");
    expect(SCORING_PROMPT).toContain("summary");
  });

  it("BATCH_SCORING_PROMPT explicitly instructs 20-40 character summary in Japanese", () => {
    expect(BATCH_SCORING_PROMPT).toContain("20-40");
    expect(BATCH_SCORING_PROMPT).toContain("summary");
  });

  it("LLMResponseSchema enforces max length for summary", () => {
    // Valid summary within length
    const valid = {
      summary: "これは20文字から40文字の範囲内にある日本語のサマリーです。",
      usefulness: 8,
      reason: "有用な技術記事です",
    };
    const parsed = LLMResponseSchema.parse(valid);
    expect(parsed.summary).toBe(valid.summary);
  });

  it("LLMResponseSchema rejects summary exceeding max length", () => {
    const tooLong = {
      summary: "あ".repeat(200),
      usefulness: 8,
      reason: "理由",
    };
    expect(() => LLMResponseSchema.parse(tooLong)).toThrow();
  });
});
