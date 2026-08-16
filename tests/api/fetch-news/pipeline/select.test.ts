import { describe, expect, test, vi, beforeEach } from "vitest";
import { selectForScoring } from "@/app/api/fetch-news/pipeline/select";
import { getScoringStateByUrls } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  getScoringStateByUrls: vi.fn(),
}));

describe("selectForScoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("selects articles correctly based on budget, hashes, and scoring state", async () => {
    const mockState = new Map();
    vi.mocked(getScoringStateByUrls).mockResolvedValue(mockState);

    const articles = Array.from({ length: 50 }, (_, i) => ({
      title: `Article ${i + 1}`,
      description: `Desc ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      urlToImage: null,
      publishedAt: new Date(Date.now() - i * 1000).toISOString(),
      sourceName: "Source",
      sourceId: "src",
      author: "Author",
    }));

    const result = await selectForScoring(articles, "tech", 40);
    expect(result.toScore.length).toBe(40);
    expect(result.deferred.length).toBe(10);
    expect(result.skipped.length).toBe(0);
  });
});
