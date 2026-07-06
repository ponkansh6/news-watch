const BASE_URL = "https://api.github.com/search/repositories";

export interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  owner: { login: string };
  created_at: string;
  stargazers_count: number;
  language: string | null;
}

export async function searchGitHub(keyword: string): Promise<GitHubRepo[]> {
  const url = `${BASE_URL}?q=${encodeURIComponent(keyword)}&sort=stars&order=desc&per_page=30`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) {
      console.warn(`[github] HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    // items is a direct array of repositories
    return Array.isArray(data.items) ? (data.items as GitHubRepo[]) : [];
  } catch (err) {
    console.warn(`[github] fetch error:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
