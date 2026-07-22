import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchXtech } from "@/lib/news/xtech";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchXtech", () => {
  test("happy path - RSS 1.0 (RDF) 形式をパースして全アイテムを返す", async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8" ?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://xtech.nikkei.com/rss/xtech-it.rdf">
<title>IT（情報技術） - 日経クロステック</title>
<link>https://xtech.nikkei.com/</link>
<items><rdf:Seq>
<rdf:li rdf:resource="https://xtech.nikkei.com/atcl/nxt/column/18/00001/11908/" />
<rdf:li rdf:resource="https://xtech.nikkei.com/atcl/nxt/column/18/00001/11903/" />
</rdf:Seq></items>
</channel>
<item rdf:about="https://xtech.nikkei.com/atcl/nxt/column/18/00001/11908/">
<title><![CDATA[JR東日本が「みどりの窓口」で生成AI実証]]></title>
<link>https://xtech.nikkei.com/atcl/nxt/column/18/00001/11908/</link>
<description><![CDATA[　JR東日本は「みどりの窓口AI対応サービス」の実証実験を開始。]]></description>
<dc:date>2026-07-23T05:00:00+09:00</dc:date>
</item>
<item rdf:about="https://xtech.nikkei.com/atcl/nxt/column/18/00001/11903/">
<title><![CDATA[ソニーセミコン、スマホ向けイメージセンサーに新構造画素]]></title>
<link>https://xtech.nikkei.com/atcl/nxt/column/18/00001/11903/</link>
<description><![CDATA[　ソニーセミコンは新構造の画素を搭載したCMOSイメージセンサーを発売。]]></description>
<dc:date>2026-07-23T05:00:00+09:00</dc:date>
</item>
</rdf:RDF>`;
    const mockResponse = {
      ok: true,
      text: async () => mockXml,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchXtech(20);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("JR東日本が「みどりの窓口」で生成AI実証");
    expect(result[0].link).toBe("https://xtech.nikkei.com/atcl/nxt/column/18/00001/11908/");
    expect(result[0].description).toContain("みどりの窓口AI対応サービス");
    expect(result[0].date).toBe("2026-07-23T05:00:00+09:00");
    expect(result[1].title).toBe("ソニーセミコン、スマホ向けイメージセンサーに新構造画素");
    expect(fetchMock).toHaveBeenCalledWith("https://xtech.nikkei.com/rss/xtech-it.rdf", {
      signal: expect.any(Object),
      headers: expect.any(Object),
    });
  });

  test("limit で指定した件数に制限される", async () => {
    const items = Array.from(
      { length: 5 },
      (_, i) => `
<item rdf:about="https://xtech.nikkei.com/atcl/nxt/column/18/00001/1${i}/">
<title><![CDATA[Article ${i + 1}]]></title>
<link>https://xtech.nikkei.com/atcl/nxt/column/18/00001/1${i}/</link>
<dc:date>2026-07-23T05:00:00+09:00</dc:date>
</item>`,
    ).join("\n");

    const liItems = Array.from(
      { length: 5 },
      (_, i) =>
        `<rdf:li rdf:resource="https://xtech.nikkei.com/atcl/nxt/column/18/00001/1${i}/" />`,
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

    const result = await searchXtech(3);
    expect(result).toHaveLength(3);
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchXtech(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchXtech(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("malformed XML - パース不能なXMLでもエラーにならず空配列を返す", async () => {
    const mockResponse = {
      ok: true,
      text: async () => "not xml at all",
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchXtech(20);

    expect(result).toEqual([]);
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
