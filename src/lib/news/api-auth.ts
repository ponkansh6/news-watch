import { timingSafeEqual } from "node:crypto";

/** The fetch APIs and refresh-job APIs share the existing admin/cron auth boundary. */
export function isNewsApiAuthorized(request: Request): boolean {
  const bearerSecret = process.env.CRON_SECRET;
  const adminUser = process.env.ADMIN_BASIC_AUTH_USER;
  const adminPassword = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  const authorization = request.headers.get("authorization") ?? "";

  if (bearerSecret && authorization.startsWith("Bearer ")) {
    const actual = Buffer.from(authorization.slice(7));
    const expected = Buffer.from(bearerSecret);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  if (adminUser && adminPassword && authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator < 0) return false;
      const username = Buffer.from(decoded.slice(0, separator));
      const password = Buffer.from(decoded.slice(separator + 1));
      const expectedUser = Buffer.from(adminUser);
      const expectedPassword = Buffer.from(adminPassword);
      return (
        username.length === expectedUser.length &&
        timingSafeEqual(username, expectedUser) &&
        password.length === expectedPassword.length &&
        timingSafeEqual(password, expectedPassword)
      );
    } catch {
      return false;
    }
  }

  return false;
}
