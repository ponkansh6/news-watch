import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchZenn } from "@/lib/news/zenn";

describe("searchZenn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return tech articles when fetch succeeds", async () => {
    const mockResponse = {
      articles: [
        {
          id: 1,
          title: "Zenn Tech Article",
          slug: "tech-slug",
          liked_count: 10,
          bookmarked_count: 5,
          article_type: "tech",
          emoji: "✨",
          published_at: "2026-03-30T00:00:00.000Z",
          path: "/articles/tech-slug",
          user: { username: "user1", name: "User One" },
        },
        {
          id: 2,
          title: "Zenn Idea Article",
          slug: "idea-slug",
          liked_count: 2,
          bookmarked_count: 1,
          article_type: "idea",
          emoji: "💡",
          published_at: "2026-03-30T00:00:00.000Z",
          path: "/articles/idea-slug",
          user: { username: "user2", name: "User Two" },
        },
      ],
      next_page: null,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }),
    );

    const articles = await searchZenn(10);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("Zenn Tech Article");
    expect(articles[0].article_type).toBe("tech");
  });

  it("should return empty array on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const articles = await searchZenn(10);
    expect(articles).toEqual([]);
  });

  it("should return empty array on fetch exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const articles = await searchZenn(10);
    expect(articles).toEqual([]);
  });
});
