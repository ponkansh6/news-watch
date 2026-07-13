import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { searchQiita } from "@/lib/news/qiita";

let fetchMock: ReturnType<typeof vi.fn>;

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>1</id>
    <title>Test Qiita Article 1</title>
    <link href="https://qiita.com/1" />
    <published>2024-01-01T00:00:00Z</published>
    <updated>2024-01-01T00:00:00Z</updated>
    <author><name>user1</name></author>
    <content>Content 1</content>
  </entry>
  <entry>
    <id>2</id>
    <title>Test Qiita Article 2</title>
    <link href="https://qiita.com/2" />
    <published>2024-01-02T00:00:00Z</published>
    <updated>2024-01-02T00:00:00Z</updated>
    <author><name>user2</name></author>
    <content>Content 2</content>
  </entry>
</feed>`;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("searchQiita", () => {
  test("happy path - returns articles when fetch succeeds", async () => {
    const mockResponse = {
      ok: true,
      text: async () => ATOM_XML,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchQiita(20);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Test Qiita Article 1");
    expect(result[1].title).toBe("Test Qiita Article 2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qiita.com/popular-items/feed",
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  test("HTTP error - returns empty array when response is not ok", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };
    fetchMock.mockResolvedValue(mockResponse as any);

    const result = await searchQiita(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("fetch exception - returns empty array when fetch rejects", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValue(error);

    const result = await searchQiita(20);

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
