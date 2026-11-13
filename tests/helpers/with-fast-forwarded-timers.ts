import { vi } from "vitest";

/** Fast-forward deliberate pipeline delays in tests without changing production pacing. */
export async function withFastForwardedTimers<T>(operation: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const result = operation();
    await vi.runAllTimersAsync();
    return await result;
  } finally {
    vi.useRealTimers();
  }
}
