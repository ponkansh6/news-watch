import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchHatena } from "@/lib/news/hatena";

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

  test("dedupes identical links across hotentry and entrylist", async () => {
    const mockXml1 = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><item rdf:about="https://example.com/shared"><title>Shared Item</title><link>https://example.com/shared</link></item></rdf:RDF>`;
    const mockXml2 = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Shared Item Entrylist</title><link>https://example.com/shared</link></item></channel></rss>`;

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("hotentry")) return { ok: true, text: async () => mockXml1 };
      if (url.includes("entrylist")) return { ok: true, text: async () => mockXml2 };
      return { ok: false, status: 404 };
    });

    const result = await searchHatena();

    expect(result).toHaveLength(1);
    expect(result[0].link).toBe("https://example.com/shared");
  });

  test("searchHatena without limit returns all fetched items", async () => {
    const mockXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Item 1</title><link>https://example.com/1</link></item><item><title>Item 2</title><link>https://example.com/2</link></item></channel></rss>`;
    fetchMock.mockResolvedValue({ ok: true, text: async () => mockXml });

    const result = await searchHatena();
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test("searchHatena with limit returns restricted items", async () => {
    const mockXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Item 1</title><link>https://example.com/1</link></item><item><title>Item 2</title><link>https://example.com/2</link></item><item><title>Item 3</title><link>https://example.com/3</link></item></channel></rss>`;
    fetchMock.mockResolvedValue({ ok: true, text: async () => mockXml });

    const result = await searchHatena(2);
    expect(result).toHaveLength(2);
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
