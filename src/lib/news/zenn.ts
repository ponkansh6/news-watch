import { DEFAULT_REQUEST_TIMEOUT_MS } from "../constants";

export interface ZennArticle {
  id: number;
  title: string;
  slug: string;
  liked_count: number;
  bookmarked_count: number;
  article_type: string;
  emoji: string | null;
  published_at: string;
  path: string;
  user: {
    username: string;
    name: string;
    avatar_image_url?: string | null;
  };
}

interface ZennApiResponse {
  articles: ZennArticle[];
  next_page: number | null;
}

export async function searchZenn(limit = 20): Promise<ZennArticle[]> {
  const url = "https://zenn.dev/api/articles?order=latest&page=1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[zenn] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as ZennApiResponse;
    const articles = data.articles ?? [];
    // Filter for tech articles only
    const techArticles = articles.filter((a) => a.article_type === "tech");
    return techArticles.slice(0, limit);
  } catch (err) {
    console.warn(`[zenn] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
