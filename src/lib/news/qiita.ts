import { XMLParser } from "fast-xml-parser";

const FEED_URL = "https://qiita.com/popular-items/feed";

export interface QiitaFeedItem {
  id: string;
  title: string;
  link: string | { "@_href": string };
  published: string;
  updated: string;
  author: { name: string };
  content: string;
}

export async function searchQiita(limit = 50): Promise<QiitaFeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(FEED_URL, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[qiita] HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    const parsed = parser.parse(xml);

    const entries = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];

    return entries.slice(0, limit).map((e: any) => ({
      id: getText(e.id),
      title: getText(e.title),
      link: e.link,
      published: getText(e.published),
      updated: getText(e.updated),
      author: { name: getText(e.author?.name) },
      content: getText(e.content),
    }));
  } catch (err) {
    console.warn(`[qiita] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function getText(node: any): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "#text" in node) return node["#text"];
  return String(node ?? "");
}
