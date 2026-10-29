import { fetchRssText, fetchRssTextStrict, SourceFetchError } from "./base/rss-fetcher";
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

async function fetchQiita(limit: number | undefined, strict: boolean): Promise<QiitaFeedItem[]> {
  const xml = strict
    ? await fetchRssTextStrict(FEED_URL, "qiita")
    : await fetchRssText(FEED_URL, "qiita");
  if (!xml) return [];
  let entries: Record<string, unknown>[];
  try {
    entries = parseAtomEntries(xml);
  } catch (err) {
    if (strict) {
      throw new SourceFetchError("qiita", "parse", "Qiita feed parsing failed", { cause: err });
    }
    throw err;
  }

  const mapped = entries.map((e: Record<string, unknown>) => ({
    id: getText(e.id),
    title: getText(e.title),
    link: e.link as string | { "@_href": string },
    published: getText(e.published),
    updated: getText(e.updated),
    author: { name: getText((e.author as Record<string, unknown>)?.name) },
    content: getText(e.content),
  }));

  return limit === undefined ? mapped : mapped.slice(0, limit);
}

export async function searchQiita(limit?: number): Promise<QiitaFeedItem[]> {
  return fetchQiita(limit, false);
}

export async function fetchQiitaForWorkflow(limit?: number): Promise<QiitaFeedItem[]> {
  return fetchQiita(limit, true);
}
