import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchHatena } from "@/lib/news/hatena";
import { getActiveFeedUrls, recordFeedError, recordFeedSuccess } from "@/lib/news/hatena-discovery";

// searchHatena now reads feed URLs from the DB via hatena-discovery.
// Mock that module so this test stays DB-free and controls the feed list.
vi.mock("@/lib/news/hatena-discovery", () => ({
  getActiveFeedUrls: vi.fn(),
  recordFeedError: vi.fn(),
  recordFeedSuccess: vi.fn(),
}));

const FEEDS = [
  "https://example-user1.hatenablog.com/rss",
  "https://example-user2.hatenablog.com/rss",
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getActiveFeedUrls).mockResolvedValue(FEEDS);
});

describe("searchHatena", () => {
  test("happy path - aggregates multiple feeds read from DB", async () => {
    const mockXml1 = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Feed 1 Item 1</title><link>https://example1.com/1</link></item><item><title>Feed 1 Item 2</title><link>https://example1.com/2</link></item><item><title>Feed 1 Item 3</title><link>https://example1.com/3</link></item></channel></rss>`;
    const mockXml2 = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Feed 2 Item 1</title><link>https://example2.com/1</link></item><item><title>Feed 2 Item 2</title><link>https://example2.com/2</link></item><item><title>Feed 2 Item 3</title><link>https://example2.com/3</link></item></channel></rss>`;

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("example-user1")) return { ok: true, text: async () => mockXml1 };
      if (url.includes("example-user2")) return { ok: true, text: async () => mockXml2 };
      return { ok: false, status: 404 };
    });

    const result = await searchHatena(20);

    expect(result).toHaveLength(6);
    expect(result[0].title).toBe("Feed 1 Item 1");
    expect(result[3].title).toBe("Feed 2 Item 1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recordFeedSuccess).toHaveBeenCalledTimes(2);
    expect(recordFeedSuccess).toHaveBeenCalledWith("example-user1.hatenablog.com");
    expect(recordFeedSuccess).toHaveBeenCalledWith("example-user2.hatenablog.com");
  });

  test("partial failure - records error, returns only successful items", async () => {
    const mockXml1 = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Feed 1 Item 1</title><link>https://example1.com/1</link></item></channel></rss>`;

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("example-user1")) return { ok: true, text: async () => mockXml1 };
      return { ok: false, status: 500 };
    });

    const result = await searchHatena(20);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Feed 1 Item 1");
    expect(recordFeedSuccess).toHaveBeenCalledWith("example-user1.hatenablog.com");
    expect(recordFeedError).toHaveBeenCalledWith(
      "example-user2.hatenablog.com",
      expect.stringContaining("500"),
    );
  });

  test("fetch exception - records error, returns empty array", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const result = await searchHatena(20);

    expect(result).toEqual([]);
    expect(recordFeedError).toHaveBeenCalled();
  });

  test("no active feeds - returns empty without fetching", async () => {
    vi.mocked(getActiveFeedUrls).mockResolvedValueOnce([]);
    fetchMock.mockClear();

    const result = await searchHatena(20);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
