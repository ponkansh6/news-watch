import { XMLParser } from "fast-xml-parser";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../constants";

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

export async function searchXtech(limit = 20): Promise<XtechItem[]> {
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
