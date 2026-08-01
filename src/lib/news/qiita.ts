import { fetchRssText } from "./base/rss-fetcher";
import { parseAtomEntries, getText } from "./base/atom-parser";

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
  const xml = await fetchRssText(FEED_URL, "qiita");
  if (!xml) return [];
  const entries = parseAtomEntries(xml);

  return entries.slice(0, limit).map((e: Record<string, unknown>) => ({
    id: getText(e.id),
    title: getText(e.title),
    link: e.link as string | { "@_href": string },
    published: getText(e.published),
    updated: getText(e.updated),
    author: { name: getText((e.author as Record<string, unknown>)?.name) },
    content: getText(e.content),
  }));
}
