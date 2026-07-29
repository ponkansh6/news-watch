import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchCloudWatch } from "@/lib/news/cloudwatch";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchCloudWatch", () => {
  test("happy path - RSS 1.0 (RDF) 形式をパースして全アイテムを返す", async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8" ?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://cloud.watch.impress.co.jp/data/rss/1.0/clw/feed.rdf">
<title>クラウド Watch</title>
<link>https://cloud.watch.impress.co.jp/</link>
<items><rdf:Seq>
<rdf:li rdf:resource="https://cloud.watch.impress.co.jp/docs/news/2128091.html" />
<rdf:li rdf:resource="https://cloud.watch.impress.co.jp/docs/news/2128092.html" />
</rdf:Seq></items>
</channel>
<item rdf:about="https://cloud.watch.impress.co.jp/docs/news/2128091.html">
<title><![CDATA[SCSK、大手製造業向けに各国拠点データの統合・活用を支援する「グローバルDSC事業」を提供]]></title>
<link>https://cloud.watch.impress.co.jp/docs/news/2128091.html</link>
<dc:date>2026-07-29T14:20:00+09:00</dc:date>
<dc:creator>三柳 英樹</dc:creator>
<description><![CDATA[　SCSK株式会社は27日、...]]></description>
</item>
<item rdf:about="https://cloud.watch.impress.co.jp/docs/news/2128092.html">
<title><![CDATA[テスト記事2]]></title>
<link>https://cloud.watch.impress.co.jp/docs/news/2128092.html</link>
<dc:date>2026-07-29T15:00:00+09:00</dc:date>
<dc:creator>編集部</dc:creator>
<description><![CDATA[テスト説明]]></description>
</item>
</rdf:RDF>`;
    const mockResponse = {
      ok: true,
      text: async () => mockXml,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchCloudWatch(20);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe(
      "SCSK、大手製造業向けに各国拠点データの統合・活用を支援する「グローバルDSC事業」を提供",
    );
    expect(result[0].link).toBe("https://cloud.watch.impress.co.jp/docs/news/2128091.html");
    expect(result[0].description).toContain("SCSK株式会社");
    expect(result[0].date).toBe("2026-07-29T14:20:00+09:00");
    expect(result[0].creator).toBe("三柳 英樹");
    expect(result[1].title).toBe("テスト記事2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.watch.impress.co.jp/data/rss/1.0/clw/feed.rdf",
      {
        signal: expect.any(Object),
        headers: expect.any(Object),
      },
    );
  });

  test("limit で指定した件数に制限される", async () => {
    const items = Array.from(
      { length: 5 },
      (_, i) => `
<item rdf:about="https://cloud.watch.impress.co.jp/docs/news/1${i}.html">
<title><![CDATA[Article ${i + 1}]]></title>
<link>https://cloud.watch.impress.co.jp/docs/news/1${i}.html</link>
<dc:date>2026-07-29T05:00:00+09:00</dc:date>
</item>`,
    ).join("\n");

    const liItems = Array.from(
      { length: 5 },
      (_, i) => `<rdf:li rdf:resource="https://cloud.watch.impress.co.jp/docs/news/1${i}.html" />`,
    ).join("\n");

    const mockXml = `<?xml version="1.0"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><items><rdf:Seq>${liItems}</rdf:Seq></items></channel>
${items}
</rdf:RDF>`;
    const mockResponse = {
      ok: true,
      text: async () => mockXml,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchCloudWatch(3);
    expect(result).toHaveLength(3);
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchCloudWatch(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchCloudWatch(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("malformed XML - パース不能なXMLでもエラーにならず空配列を返す", async () => {
    const mockResponse = {
      ok: true,
      text: async () => "not xml at all",
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchCloudWatch(20);

    expect(result).toEqual([]);
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
