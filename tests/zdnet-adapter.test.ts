import { describe, expect, test } from "vitest";
import { parseZdnetRss } from "@/lib/news/zdnet";

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://feeds.japan.zdnet.com/rss/zdnet/all.rdf">
    <title>ZDNet Japan</title>
    <link>https://japan.zdnet.com/</link>
  </channel>
  <item rdf:about="https://japan.zdnet.com/article/123/">
    <title>テスト記事1</title>
    <link>https://japan.zdnet.com/article/123/</link>
    <description>説明1</description>
    <dc:date>2026-07-14T09:00:00Z</dc:date>
    <dc:creator>山田太郎</dc:creator>
  </item>
  <item rdf:about="https://japan.zdnet.com/article/456/">
    <title>テスト記事2</title>
    <link>https://japan.zdnet.com/article/456/</link>
    <description>説明2</description>
    <dc:date>2026-07-13T10:30:00Z</dc:date>
    <dc:creator>鈴木一郎</dc:creator>
  </item>
</rdf:RDF>`;

describe("parseZdnetRss", () => {
  test("should parse RDF feed correctly", () => {
    const items = parseZdnetRss(fixture);
    expect(items).toHaveLength(2);

    expect(items[0].title).toBe("テスト記事1");
    expect(items[0].link).toBe("https://japan.zdnet.com/article/123/");
    expect(items[0].date).toBe("2026-07-14T09:00:00Z");
    expect(items[0].creator).toBe("山田太郎");

    expect(items[1].title).toBe("テスト記事2");
  });
});
