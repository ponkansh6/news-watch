import { DEFAULT_REQUEST_TIMEOUT_MS } from "../constants";
import { SourceFetchError } from "./base/rss-fetcher";

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

async function fetchZenn(limit?: number): Promise<ZennArticle[]> {
  const url = "https://zenn.dev/api/articles?order=latest&page=1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new SourceFetchError("zenn", "http", `HTTP ${res.status}`, {
        status: res.status,
      });
    }
    let data: ZennApiResponse;
    try {
      data = (await res.json()) as ZennApiResponse;
    } catch (err) {
      throw new SourceFetchError("zenn", "parse", "Zenn response parsing failed", {
        cause: err,
      });
    }
    if (!data || !Array.isArray(data.articles)) {
      throw new SourceFetchError("zenn", "parse", "Zenn response has no articles list");
    }
    const articles = data.articles ?? [];
    // Filter for tech articles only
    const techArticles = articles.filter((a) => a.article_type === "tech");
    return limit === undefined ? techArticles : techArticles.slice(0, limit);
  } catch (err) {
    if (err instanceof SourceFetchError) throw err;
    const kind = controller.signal.aborted ? "timeout" : "network";
    throw new SourceFetchError("zenn", kind, "Zenn request failed", { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchZennForWorkflow(limit?: number): Promise<ZennArticle[]> {
  return fetchZenn(limit);
}

export async function searchZenn(limit?: number): Promise<ZennArticle[]> {
  try {
    return await fetchZenn(limit);
  } catch (err) {
    console.warn(`[zenn] fetch error:`, err);
    return [];
  }
}
