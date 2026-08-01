import { DEFAULT_REQUEST_TIMEOUT_MS } from "../../constants";

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function fetchRssText(
  url: string,
  sourceName: string,
  options?: FetchOptions,
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: options?.headers,
    });
    if (!res.ok) {
      console.warn(`[${sourceName}] HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[${sourceName}] fetch/parse error:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
