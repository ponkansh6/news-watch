import { XMLParser } from "fast-xml-parser";

const FEED_URL = "https://xtech.nikkei.com/rss/xtech-it.rdf";

export interface XtechItem {
  title: string;
  link: string;
  description?: string;
  date?: string; // dc:date
  creator?: string; // dc:creator
  about?: string; // rdf:about 属性
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export function parseXtechRss(xml: string): XtechItem[] {
  const parsed = parser.parse(xml);
  const root = parsed["rdf:RDF"];
  if (!root?.item) return [];
  const items: any[] = Array.isArray(root.item) ? root.item : [root.item];
  return items.map((i) => ({
    title: i.title,
    link: i.link,
    description: i.description,
    date: i["dc:date"],
    creator: i["dc:creator"],
    about: i["@_rdf:about"],
  }));
}

export async function searchXtech(limit = 20): Promise<XtechItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
      },
    });
    if (!res.ok) {
      console.warn(`[xtech] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    return parseXtechRss(xml).slice(0, limit);
  } catch (err) {
    console.warn(`[xtech] fetch/parse error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
