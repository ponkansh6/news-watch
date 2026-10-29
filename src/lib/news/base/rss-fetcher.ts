import { DEFAULT_REQUEST_TIMEOUT_MS } from "../../constants";

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export type SourceFetchFailureKind = "http" | "network" | "timeout" | "parse";

/** A source-specific failure that callers can distinguish from a healthy empty feed. */
export class SourceFetchError extends Error {
  readonly kind: SourceFetchFailureKind;
  readonly sourceName: string;
  readonly status?: number;

  constructor(
    sourceName: string,
    kind: SourceFetchFailureKind,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = "SourceFetchError";
    this.sourceName = sourceName;
    this.kind = kind;
    this.status = options?.status;
  }
}

export async function fetchRssTextStrict(
  url: string,
  sourceName: string,
  options?: FetchOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: options?.headers,
    });
    if (!res.ok) {
      throw new SourceFetchError(sourceName, "http", `HTTP ${res.status}`, {
        status: res.status,
      });
    }
    return await res.text();
  } catch (err) {
    if (err instanceof SourceFetchError) throw err;
    const kind = controller.signal.aborted ? "timeout" : "network";
    throw new SourceFetchError(sourceName, kind, "Feed request failed", { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRssText(
  url: string,
  sourceName: string,
  options?: FetchOptions,
): Promise<string | null> {
  try {
    return await fetchRssTextStrict(url, sourceName, options);
  } catch (err) {
    console.warn(`[${sourceName}] fetch/parse error:`, err);
    return null;
  }
}
