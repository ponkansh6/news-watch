import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mockSet })),
}));

import { setSourceCookie } from "../../src/app/actions";

describe("setSourceCookie (Server Action)", () => {
  beforeEach(() => {
    mockSet.mockClear();
  });

  it("writes the source cookie via cookieStore.set", async () => {
    await setSourceCookie("qiita");
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      "source",
      "qiita",
      expect.objectContaining({
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      }),
    );
  });
});
