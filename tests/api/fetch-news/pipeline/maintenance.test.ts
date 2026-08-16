import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cleanupOrphaned,
  refreshRecency,
  gcStaleArticles,
} from "@/app/api/fetch-news/pipeline/maintenance";
import { deleteStaleLowScored, refreshRecencyForSources } from "@/lib/db";
import { type NormalizedArticle } from "@/lib/types";

vi.mock("@/lib/db", () => ({
  deleteStaleLowScored: vi.fn(),
  refreshRecencyForSources: vi.fn(),
}));

describe("pipeline/maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cleanupOrphaned", () => {
    it("is a NO-OP", async () => {
      await expect(cleanupOrphaned()).resolves.toBeUndefined();
    });
  });

  describe("refreshRecency", () => {
    it("calls refreshRecencyForSources when selectedSource is provided", async () => {
      const articles: NormalizedArticle[] = [
        {
          title: "Test",
          description: null,
          url: "https://example.com/1",
          urlToImage: null,
          publishedAt: new Date().toISOString(),
          sourceName: "Zenn",
          sourceId: "zenn",
          author: null,
        },
      ];
      const result = { errors: [] as string[] };

      await refreshRecency(
        "zenn",
        articles.map((a) => a.url),
        result,
      );

      expect(refreshRecencyForSources).toHaveBeenCalledTimes(1);
      expect(refreshRecencyForSources).toHaveBeenCalledWith(["zenn"], ["https://example.com/1"]);
      expect(result.errors).toHaveLength(0);
    });

    it("does not call refreshRecencyForSources when selectedSource is empty", async () => {
      const result = { errors: [] as string[] };

      await refreshRecency("", [], result);

      expect(refreshRecencyForSources).not.toHaveBeenCalled();
      expect(result.errors).toHaveLength(0);
    });

    it("catches errors and pushes to result.errors when refreshRecencyForSources fails", async () => {
      vi.mocked(refreshRecencyForSources).mockRejectedValueOnce(new Error("DB Connection Error"));
      const articles: NormalizedArticle[] = [
        {
          title: "Test",
          description: null,
          url: "https://example.com/1",
          urlToImage: null,
          publishedAt: new Date().toISOString(),
          sourceName: "Zenn",
          sourceId: "zenn",
          author: null,
        },
      ];
      const result = { errors: [] as string[] };

      await refreshRecency(
        "zenn",
        articles.map((a) => a.url),
        result,
      );

      expect(refreshRecencyForSources).toHaveBeenCalledTimes(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Recency refresh failed: Error: DB Connection Error");
    });
  });

  describe("gcStaleArticles", () => {
    it("calls deleteStaleLowScored", async () => {
      await gcStaleArticles();
      expect(deleteStaleLowScored).toHaveBeenCalledTimes(1);
    });
  });
});
