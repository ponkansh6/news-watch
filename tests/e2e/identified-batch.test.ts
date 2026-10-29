import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreArticlesById } from "@/lib/llm";

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = vi.fn().mockReturnValue({ generateContent: mockGenerateContent });
  },
}));

const articles = [
  { id: "article-a", title: "Article A", description: "Description A" },
  { id: "article-b", title: "Article B", description: "Description B" },
];

function response(results: unknown) {
  return { response: { text: () => JSON.stringify({ results }) } };
}

describe("scoreArticlesById", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_API_KEY = "test-api-key";
  });

  it("matches scores by id when the model changes result order", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      response([
        { id: "article-b", summary: "B", usefulness: 7, ntt_relevance: 2, reason: "B reason" },
        { id: "article-a", summary: "A", usefulness: 9, ntt_relevance: 4, reason: "A reason" },
      ]),
    );

    const results = await scoreArticlesById(articles, "", { retries: 0 });

    expect(results.map(({ id, score }) => [id, score.usefulness])).toEqual([
      ["article-a", 9],
      ["article-b", 7],
    ]);
    const sentPrompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(sentPrompt).toContain('"id":"article-a"');
    expect(sentPrompt).toContain('"id":"article-b"');
  });

  it.each([
    ["missing", [{ id: "article-a", summary: "A", usefulness: 8, ntt_relevance: 1, reason: "A" }]],
    [
      "duplicate",
      [
        { id: "article-a", summary: "A", usefulness: 8, ntt_relevance: 1, reason: "A" },
        { id: "article-a", summary: "A2", usefulness: 7, ntt_relevance: 1, reason: "A2" },
      ],
    ],
    [
      "unknown",
      [
        { id: "article-a", summary: "A", usefulness: 8, ntt_relevance: 1, reason: "A" },
        { id: "other", summary: "B", usefulness: 7, ntt_relevance: 1, reason: "B" },
      ],
    ],
  ])(
    "rejects an entire response with %s ids and never falls back per article",
    async (_case, results) => {
      mockGenerateContent.mockResolvedValueOnce(response(results));

      await expect(scoreArticlesById(articles, "", { retries: 0 })).rejects.toThrow(
        "Identified batch scoring failed",
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    },
  );

  it("retries a malformed batch response as a whole within the configured bound", async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => "not json" } })
      .mockResolvedValueOnce(
        response([
          { id: "article-a", summary: "A", usefulness: 8, ntt_relevance: 1, reason: "A" },
          { id: "article-b", summary: "B", usefulness: 7, ntt_relevance: 1, reason: "B" },
        ]),
      );

    const results = await scoreArticlesById(articles, "", { retries: 1 });

    expect(results).toHaveLength(2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("allows short tail batches and rejects batches above fifty", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      response([{ id: "article-a", summary: "A", usefulness: 8, ntt_relevance: 1, reason: "A" }]),
    );
    await expect(scoreArticlesById([articles[0]], "", { retries: 0 })).resolves.toHaveLength(1);

    await expect(
      scoreArticlesById(
        Array.from({ length: 51 }, (_, index) => ({ ...articles[0], id: `article-${index}` })),
      ),
    ).rejects.toThrow("at most 50 articles");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
