import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { politeFetch, recordFeedError, getActiveFeedUrls } from "@/lib/news/hatena-discovery";
import { searchHatena } from "@/lib/news/hatena";
import { db } from "@/lib/db";

// Mock DB
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

// Mock hatena-discovery
vi.mock("@/lib/news/hatena-discovery", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getActiveFeedUrls: vi.fn().mockResolvedValue(["https://test.hatenablog.com/rss"]),
    recordFeedError: vi.fn(),
    recordFeedSuccess: vi.fn(),
  };
});

describe("Hatena Connection Errors", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("politeFetch should reject on abort", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockImplementation((_, { signal }) => {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const promise = politeFetch("https://example.com");
    vi.advanceTimersByTime(15000);
    await expect(promise).rejects.toThrow("The operation was aborted");
    vi.useRealTimers();
  });

  it("politeFetch should reject on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(politeFetch("https://example.com")).rejects.toThrow("ECONNRESET");
  });

  it("searchHatena should record error on connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await searchHatena();

    expect(recordFeedError).toHaveBeenCalledWith("test.hatenablog.com", "ECONNREFUSED");
  });
});
