import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchHatena } from "@/lib/news/hatena";
import { getActiveFeedUrls, recordFeedError, recordFeedSuccess } from "@/lib/news/hatena-discovery";

// searchHatena now reads feed URLs from the DB via hatena-discovery.
// Mock that module so this test stays DB-free and controls the feed list.
vi.mock("@/lib/news/hatena-discovery", () => ({
  HATENA_HOTENTRY_RSS_URL: "https://b.hatena.ne.jp/hotentry/it.rss",
  HATENA_ENTRYLIST_RSS_URL: "https://b.hatena.ne.jp/entrylist/it.rss",
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchHatena", () => {
  test("happy path - aggregates multiple feeds", async () => {
    const mockXml1 = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><item rdf:about="https://example1.com/1"><title>Feed 1 Item 1</title><link>https://example1.com/1</link></item></rdf:RDF>`;
    const mockXml2 = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Feed 2 Item 1</title><link>https://example2.com/1</link></item></channel></rss>`;

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("hotentry")) return { ok: true, text: async () => mockXml1 };
      if (url.includes("entrylist")) return { ok: true, text: async () => mockXml2 };
      return { ok: false, status: 404 };
    });

    const result = await searchHatena(20);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Feed 1 Item 1");
    expect(result[1].title).toBe("Feed 2 Item 1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("partial failure - returns only successful items", async () => {
    const mockXml1 = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Feed 1 Item 1</title><link>https://example1.com/1</link></item></channel></rss>`;

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("hotentry")) return { ok: true, text: async () => mockXml1 };
      return { ok: false, status: 500 };
    });

    const result = await searchHatena(20);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Feed 1 Item 1");
  });

  test("fetch exception - returns empty array", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const result = await searchHatena(20);

    expect(result).toEqual([]);
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
