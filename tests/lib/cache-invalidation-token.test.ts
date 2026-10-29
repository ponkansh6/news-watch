import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueArticlesInvalidationToken,
  verifyArticlesInvalidationToken,
} from "@/lib/cache-invalidation-token";

describe("article cache invalidation tokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("issues a token that is valid for five minutes", () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const issuedAt = 1_800_000_000_000;
    const token = issueArticlesInvalidationToken(issuedAt);

    expect(token).toEqual(expect.any(String));
    expect(verifyArticlesInvalidationToken(token!, issuedAt)).toBe(true);
    expect(verifyArticlesInvalidationToken(token!, issuedAt + 299_000)).toBe(true);
    expect(verifyArticlesInvalidationToken(token!, issuedAt + 301_000)).toBe(false);
  });

  it("rejects malformed and modified tokens", () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const token = issueArticlesInvalidationToken(1_800_000_000_000)!;

    expect(verifyArticlesInvalidationToken("")).toBe(false);
    expect(verifyArticlesInvalidationToken(`${token}x`, 1_800_000_000_000)).toBe(false);
    expect(verifyArticlesInvalidationToken("not.a.valid.token", 1_800_000_000_000)).toBe(false);
  });

  it("requires a configured signing secret", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "");

    expect(issueArticlesInvalidationToken()).toBeNull();
    expect(verifyArticlesInvalidationToken("a.b")).toBe(false);
  });

  it("can derive a signing key from the configured Basic Auth credentials", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");
    const token = issueArticlesInvalidationToken(1_800_000_000_000)!;

    expect(verifyArticlesInvalidationToken(token, 1_800_000_000_000)).toBe(true);
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "rotated-password");
    expect(verifyArticlesInvalidationToken(token, 1_800_000_000_000)).toBe(false);
  });
});
