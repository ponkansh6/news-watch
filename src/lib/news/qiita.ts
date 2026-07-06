const BASE_URL = "https://qiita.com/api/v2";

export interface QiitaArticle {
  id: string;
  title: string;
  url: string;
  created_at: string;
  user: { name: string; id: string };
  tags: { name: string }[];
  likes_count: number;
  page_views_count: number;
}

export async function searchQiita(keyword: string): Promise<QiitaArticle[]> {
  const url = `${BASE_URL}/items?query=${encodeURIComponent(keyword)}&page=1&per_page=30`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const headers: HeadersInit = {};
  const token = process.env.QIITA_ACCESS_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) {
      console.warn(`[qiita] HTTP ${res.status}`);
      return [];
    }
    // /api/v2/items returns a direct JSON array (not wrapped in an object)
    const data = (await res.json()) as QiitaArticle[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`[qiita] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
