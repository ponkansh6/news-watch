import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLatestPreferenceProfile: vi.fn(),
  stageRefreshCandidates: vi.fn(),
  selectForScoring: vi.fn(),
}));

vi.mock("@/lib/news/registry", () => ({
  getSourceAdapter: (sourceId: string) => ({
    id: sourceId,
    fetch: async () => [{ id: "article" }],
    fetchForWorkflow: async () => [{ id: "article" }],
    toArticle: () => ({
      title: "A title",
      description: "A description",
      url: "https://example.com/article",
      publishedAt: "2026-01-01T00:00:00.000Z",
      source: sourceId,
    }),
  }),
}));
vi.mock("@/lib/db", () => ({ getLatestPreferenceProfile: mocks.getLatestPreferenceProfile }));
vi.mock("@/lib/llm", () => ({
  buildPreferencePromptSection: (analysis: { summary?: string } | null) => analysis?.summary ?? "",
}));
vi.mock("@/app/api/fetch-news/pipeline/select", () => ({
  selectForScoring: mocks.selectForScoring,
}));
vi.mock("@/lib/db/repository/refresh-candidate-repository", () => ({
  stageRefreshCandidates: mocks.stageRefreshCandidates,
  getBatchCandidates: vi.fn(),
  listRefreshJobCandidates: vi.fn(),
}));

import { collectRefreshCandidates } from "@/lib/news/fetch-service";

describe("collectRefreshCandidates preference profile refresh", () => {
  it("uses the latest profile and signature independently for each sequential source", async () => {
    mocks.getLatestPreferenceProfile
      .mockResolvedValueOnce({ analysis: { summary: "profile-v1" } })
      .mockResolvedValueOnce({ analysis: { summary: "profile-v2" } });
    const article = {
      title: "A title",
      description: "A description",
      url: "https://example.com/article",
      publishedAt: "2026-01-01T00:00:00.000Z",
      source: "zenn",
    };
    mocks.selectForScoring.mockResolvedValue({ toScore: [article], skipped: [], deferred: [] });
    mocks.stageRefreshCandidates.mockResolvedValue({ inserted: 1, merged: 0 });
    const checkpoint = {
      strictAdapterErrors: true,
      sourceAttemptCount: 1,
      beforeAdapterStart: async () => true,
      onAdapterStart: async () => true,
    };

    const first = await collectRefreshCandidates("zenn", "job", "owner", checkpoint);
    const second = await collectRefreshCandidates("qiita", "job", "owner", checkpoint);

    expect(mocks.getLatestPreferenceProfile).toHaveBeenCalledTimes(2);
    expect(first.signature).not.toBe(second.signature);
    const stagedInputs = mocks.stageRefreshCandidates.mock.calls.map((call) => call[3][0]);
    expect(mocks.stageRefreshCandidates.mock.calls.map((call) => call[2])).toEqual([
      "zenn",
      "qiita",
    ]);
    expect(stagedInputs.map((input) => input.payload.preferenceSection)).toEqual([
      "profile-v1",
      "profile-v2",
    ]);
    expect(stagedInputs.map((input) => input.scoringSignature)).toEqual([
      first.signature,
      second.signature,
    ]);
  });
});
