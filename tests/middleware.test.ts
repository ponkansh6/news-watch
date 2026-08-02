import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function createMockRequest(url: string, headers?: Record<string, string>): NextRequest {
  const request = new Request(url, { headers: new Headers(headers) });
  return new NextRequest(request);
}

describe("middleware - Basic Auth for /admin/db", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", undefined);
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", undefined);
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows access when auth is not configured and NODE_ENV is not production", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", undefined);
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", undefined);
    vi.stubEnv("NODE_ENV", "development");

    const req = createMockRequest("http://localhost:3000/admin/db");
    const res = await middleware(req);

    expect(res.status).toBe(200);
  });

  it("returns 503 when auth is not configured and NODE_ENV is production", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", undefined);
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", undefined);
    vi.stubEnv("NODE_ENV", "production");

    const req = createMockRequest("http://localhost:3000/admin/db");
    const res = await middleware(req);

    expect(res.status).toBe(503);
  });

  it("returns 401 when Authorization header is missing", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");

    const req = createMockRequest("http://localhost:3000/admin/db");
    const res = await middleware(req);

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Basic realm="News Watch Admin"');
  });

  it("returns 401 for invalid credentials", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");

    const credentials = Buffer.from("admin:wrongpass").toString("base64");
    const req = createMockRequest("http://localhost:3000/admin/db", {
      authorization: `Basic ${credentials}`,
    });
    const res = await middleware(req);

    expect(res.status).toBe(401);
  });

  it("allows access for valid credentials", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");

    const credentials = Buffer.from("admin:password").toString("base64");
    const req = createMockRequest("http://localhost:3000/admin/db", {
      authorization: `Basic ${credentials}`,
    });
    const res = await middleware(req);

    expect(res.status).toBe(200);
  });

  it("skips middleware for non-admin paths", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");

    const req = createMockRequest("http://localhost:3000/");
    const res = await middleware(req);

    expect(res.status).toBe(200);
  });
});
