import { createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 5 * 60;
const TOKEN_PURPOSE = "articles-cache-invalidation:v1";
const BASIC_KEY_DERIVATION_ITERATIONS = 310_000;

function getSigningKey(): Buffer | null {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return createHmac("sha256", secret).update("news-watch:cache-invalidation-key:v1").digest();
  }

  const user = process.env.ADMIN_BASIC_AUTH_USER;
  const password = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!user || !password) return null;
  const salt = Buffer.from(`news-watch:cache-invalidation-key:v1:${user}`, "utf8");
  return pbkdf2Sync(password, salt, BASIC_KEY_DERIVATION_ITERATIONS, 32, "sha256");
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

/** Create a short-lived capability for invalidating the article list after an authorized fetch. */
export function issueArticlesInvalidationToken(now = Date.now()): string | null {
  const key = getSigningKey();
  if (!key) return null;

  const payload = Buffer.from(
    JSON.stringify({ purpose: TOKEN_PURPOSE, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, key).toString("base64url")}`;
}

/** Verify the purpose and expiry of a cache invalidation capability. */
export function verifyArticlesInvalidationToken(token: string, now = Date.now()): boolean {
  if (token.length > 1024) return false;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  const key = getSigningKey();
  if (!match || !key) return false;

  try {
    const [, payload, encodedSignature] = match;
    const actualSignature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = sign(payload, key);
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      return false;
    }

    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return false;
    const claims = decoded as Record<string, unknown>;
    return (
      claims.purpose === TOKEN_PURPOSE &&
      Number.isInteger(claims.exp) &&
      (claims.exp as number) >= Math.floor(now / 1000) &&
      (claims.exp as number) <= Math.floor(now / 1000) + TOKEN_TTL_SECONDS
    );
  } catch {
    return false;
  }
}
