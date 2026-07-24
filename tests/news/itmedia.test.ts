import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchITmedia } from "@/lib/news/itmedia";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchITmedia", () => {
  test("happy path - returns all items without keyword filtering", async () => {
    const mockXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Test Article 1</title><link>https://example.com/1</link><description>Description 1</description><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><guid>https://example.com/1</guid><category>tech</category></item><item><title>Another Article</title><link>https://example.com/2</link><description>Description 2</description><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate><guid>https://example.com/2</guid></item><item><title>Test Article 2</title><link>https://example.com/3</link><description>Description 3</description><pubDate>Wed, 03 Jan 2024 00:00:00 GMT</pubDate><guid>https://example.com/3</guid><category>news</category></item></channel></rss>`;
    const mockResponse = {
      ok: true,
      text: async () => mockXml,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchITmedia(20);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe("Test Article 1");
    expect(result[1].title).toBe("Another Article");
    expect(result[2].title).toBe("Test Article 2");
    expect(fetchMock).toHaveBeenCalledWith("https://rss.itmedia.co.jp/rss/0.91/ait.xml", {
      signal: expect.any(Object),
    });
  });

  test("returns all items without keyword filtering", async () => {
    const mockXml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>JavaScript Article</title><link>https://example.com/1</link></item><item><title>TypeScript Article</title><link>https://example.com/2</link></item><item><title>python Article</title><link>https://example.com/3</link></item></channel></rss>`;
    const mockResponse = {
      ok: true,
      text: async () => mockXml,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchITmedia(20);

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe("JavaScript Article");
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchITmedia(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchITmedia(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
