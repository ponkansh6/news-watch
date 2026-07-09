const BASE_URL = "https://newsapi.org/v2";

export interface NewsApiArticle {
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  source: { name: string; id: string | null };
  author: string | null;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

export async function searchNewsApi(limit = 50): Promise<NewsApiArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  const url = `${BASE_URL}/top-headlines?country=us&apiKey=${apiKey}&pageSize=${limit}&language=en`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[newsapi] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as NewsApiResponse;
    return data.articles ?? [];
  } catch (err) {
    console.warn(`[newsapi] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
