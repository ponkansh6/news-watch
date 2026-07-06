import { XMLParser } from "fast-xml-parser";

const FEED_URL = "https://codezine.jp/rss/new/20/index.xml";

export interface CodeZineItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export async function searchCodeZine(keyword: string): Promise<CodeZineItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(FEED_URL, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[codezine] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    // RSS 2.0 structure: rss.channel.item (can be single item or array)
    const channel = parsed?.rss?.channel;
    if (!channel?.item) return [];

    const items: CodeZineItem[] = Array.isArray(channel.item) ? channel.item : [channel.item];

    // Filter by keyword match in title (case-insensitive)
    const kw = keyword.toLowerCase();
    return items.filter((item) => {
      const title = item.title ?? "";
      return title.toLowerCase().includes(kw);
    });
  } catch (err) {
    console.warn(`[codezine] fetch/parse error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
