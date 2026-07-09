const BASE_URL = "https://hn.algolia.com/api/v1";

export interface HackerNewsArticle {
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
  objectID: string;
  _tags: string[];
  story_text?: string;
}

interface HackerNewsResponse {
  hits: HackerNewsArticle[];
  nbHits: number;
  page: number;
  nbPages: number;
}

export async function searchHackerNews(limit = 50): Promise<HackerNewsArticle[]> {
  const url = `${BASE_URL}/search?tags=story&hitsPerPage=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[hackernews] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as HackerNewsResponse;
    return data.hits ?? [];
  } catch (err) {
    console.warn(`[hackernews] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
