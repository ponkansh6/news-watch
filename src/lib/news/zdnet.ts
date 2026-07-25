import { XMLParser } from "fast-xml-parser";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../constants";

const FEED_URL = "https://feeds.japan.zdnet.com/rss/zdnet/all.rdf";

export interface ZdnetItem {
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

export function parseZdnetRss(xml: string): ZdnetItem[] {
  const parsed = parser.parse(xml);
  const root = parsed["rdf:RDF"];
  if (!root?.item) return [];
  const items: Record<string, unknown>[] = Array.isArray(root.item) ? root.item : [root.item];
  return items.map((i) => ({
    title: String(i.title ?? ""),
    link: String(i.link ?? ""),
    description: typeof i.description === "string" ? i.description : undefined,
    date: typeof i["dc:date"] === "string" ? i["dc:date"] : undefined,
    creator: typeof i["dc:creator"] === "string" ? i["dc:creator"] : undefined,
    about: typeof i["@_rdf:about"] === "string" ? i["@_rdf:about"] : undefined,
  }));
}

export async function searchZdnet(limit = 50): Promise<ZdnetItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "news-watch/1.0 (+https://github.com/shunki/news-watch)",
      },
    });
    if (!res.ok) {
      console.warn(`[zdnet] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    return parseZdnetRss(xml).slice(0, limit);
  } catch (err) {
    console.warn(`[zdnet] fetch/parse error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
