const BASE_URL = "https://gnews.io/api/v4";

export interface GNewsArticle {
  title: string;
  description: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { name: string; url: string };
  author?: string;
}

interface GNewsResponse {
  status: string;
  totalArticles: number;
  articles: GNewsArticle[];
}

export async function searchGNews(keyword: string): Promise<GNewsArticle[]> {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) return [];

  const url = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}&apikey=${apiKey}&max=30&lang=ja&sortby=publishedAt`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[gnews] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as GNewsResponse;
    return data.articles ?? [];
  } catch (err) {
    console.warn(`[gnews] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
