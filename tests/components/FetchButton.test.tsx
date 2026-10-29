// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "../lib/test-utils";
import userEvent from "@testing-library/user-event";
import { useState, useEffect, useRef } from "react";
import FetchButton from "../../src/app/fetch-button";
import { NewsSection } from "@/components/news/news-section";
import { RefreshProvider } from "../../src/app/refresh-context";
import { SOURCES } from "@/lib/sources";
import type { ArticleListRow as Article } from "@/components/article/article-list";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockRefresh, mockInvalidateArticlesAfterFetch, useTransitionOverride } =
  vi.hoisted(() => ({
    mockPush: vi.fn(),
    mockRefresh: vi.fn(),
    mockInvalidateArticlesAfterFetch: vi.fn().mockResolvedValue({ ok: true }),
    useTransitionOverride: {
      current: null as (() => [boolean, (callback: () => void) => void]) | null,
    },
  }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => useTransitionOverride.current?.() ?? actual.useTransition(),
  };
});

vi.mock("@/app/actions", () => ({
  invalidateArticlesAfterFetch: mockInvalidateArticlesAfterFetch,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

// Shared mock articles used across tests
const initialMockArticles: Article[] = [
  {
    id: 1,
    title: "既存記事 1",
    url: "https://example.com/1",
    publishedAt: new Date().toISOString(),
    sourceName: "Source A",
    sourceId: "source-a",
    keyword: null,
    keywordLabel: null,
    summary: "サマリー1",
    relevance: 80,
    usefulness: 85,
    recency: 90,
    score: 85,
    reason: "理由1",
  },
  {
    id: 2,
    title: "既存記事 2",
    url: "https://example.com/2",
    publishedAt: new Date().toISOString(),
    sourceName: "Source B",
    sourceId: "source-b",
    keyword: null,
    keywordLabel: null,
    summary: "サマリー2",
    relevance: 90,
    usefulness: 90,
    recency: 95,
    score: 92,
    reason: "理由2",
  },
];

const newScoredArticle: Article = {
  id: 3,
  title: "スコアリング済み新着記事",
  url: "https://example.com/3",
  publishedAt: new Date().toISOString(),
  sourceName: "Source C",
  sourceId: "source-c",
  keyword: null,
  keywordLabel: null,
  summary: "新着サマリー",
  relevance: 88,
  usefulness: 92,
  recency: 99,
  score: 94,
  reason: "新着理由",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FetchButton", () => {
  const mockOnSourceChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSourceChange.mockClear();
    mockInvalidateArticlesAfterFetch.mockResolvedValue({ ok: true });
    useTransitionOverride.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders select dropdown with correct sources", () => {
    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    for (const source of SOURCES) {
      expect(screen.getByRole("option", { name: source.name })).toBeInTheDocument();
    }
  });

  it("displays the selected source", () => {
    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("zenn");
  });

  it("総合表示では単一ソース更新を送信しない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ job: null }));
    render(
      <RefreshProvider>
        <FetchButton selectedSource="all" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    expect(screen.getByRole("button", { name: "全ソースを一括更新" })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/refresh-jobs", expect.anything()),
    );
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          url === "/api/fetch-news" || (url === "/api/refresh-jobs" && init?.method === "POST"),
      ),
    ).toBe(false);
  });

  it("starts an aggregate job and follows its server status", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/refresh-jobs" && init?.method === "POST") {
        return jsonResponse(
          {
            jobId: "job-aggregate",
            status: "running",
            revision: 1,
            sources: [
              {
                sourceId: "zenn",
                status: "pending",
                resultCount: null,
                errorCode: null,
                cacheInvalidatedAt: null,
              },
            ],
          },
          202,
        );
      }
      if (input === "/api/refresh-jobs/job-aggregate") {
        return jsonResponse({
          job: {
            jobId: "job-aggregate",
            status: "completed",
            revision: 2,
            currentSourceId: null,
            errorCode: null,
            sources: [
              {
                sourceId: "zenn",
                status: "invalidated",
                resultCount: 3,
                errorCode: null,
                cacheInvalidatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        });
      }
      return jsonResponse({ job: null });
    });

    render(
      <RefreshProvider>
        <FetchButton selectedSource="all" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "全ソースを一括更新" }));

    expect(await screen.findByText("総合更新が完了しました")).toBeInTheDocument();
    const progress = screen.getByRole("region", { name: "総合更新の進捗" });
    expect(within(progress).getByText("Zenn")).toBeInTheDocument();
    expect(within(progress).getByText("完了 3件")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith("/api/refresh-jobs", { method: "POST" });
    expect(fetchSpy.mock.calls.some(([url]) => url === "/api/fetch-news")).toBe(false);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows candidate totals during collection and separates scoring failures", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/refresh-jobs" && init?.method === "POST") {
        return jsonResponse(
          {
            jobId: "job-progress",
            status: "running",
            revision: 1,
            sources: [
              {
                sourceId: "zenn",
                status: "executing",
                resultCount: null,
                errorCode: null,
                cacheInvalidatedAt: null,
              },
            ],
          },
          202,
        );
      }
      if (input === "/api/refresh-jobs/job-progress") {
        return jsonResponse({
          job: {
            jobId: "job-progress",
            status: "running",
            revision: 2,
            currentSourceId: "zenn",
            errorCode: null,
            articleProgress: {
              candidateTotal: 7,
              savedCount: 2,
              failedCount: 1,
              collectionComplete: false,
            },
            sources: [
              {
                sourceId: "zenn",
                status: "executing",
                resultCount: null,
                errorCode: null,
                cacheInvalidatedAt: null,
              },
            ],
          },
        });
      }
      return jsonResponse({ job: null });
    });

    render(
      <RefreshProvider>
        <FetchButton selectedSource="all" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "全ソースを一括更新" }));

    const progress = screen.getByRole("region", { name: "総合更新の進捗" });
    expect(await within(progress).findByText("採点対象（収集中） 7件")).toBeInTheDocument();
    expect(within(progress).getByText("失敗 1件")).toBeInTheDocument();
    expect(within(progress).getByText("取得・採点中...")).toBeInTheDocument();
  });

  it("shows a zero candidate total after collection", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/refresh-jobs" && init?.method === "POST") {
        return jsonResponse(
          {
            jobId: "job-empty",
            status: "running",
            revision: 1,
            sources: [],
          },
          202,
        );
      }
      if (input === "/api/refresh-jobs/job-empty") {
        return jsonResponse({
          job: {
            jobId: "job-empty",
            status: "completed",
            revision: 2,
            currentSourceId: null,
            errorCode: null,
            articleProgress: {
              candidateTotal: 0,
              savedCount: 0,
              failedCount: 0,
              collectionComplete: true,
            },
            sources: [],
          },
        });
      }
      return jsonResponse({ job: null });
    });

    render(
      <RefreshProvider>
        <FetchButton selectedSource="all" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "全ソースを一括更新" }));
    expect(await screen.findByText("保存済み 0 / 採点対象 0件")).toBeInTheDocument();
  });

  it("restores an active aggregate job when revisiting the page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "/api/refresh-jobs") {
        return jsonResponse({
          job: {
            jobId: "job-restored",
            status: "running",
            revision: 3,
            currentSourceId: "qiita",
            errorCode: null,
            sources: [
              {
                sourceId: "qiita",
                status: "executing",
                resultCount: null,
                errorCode: null,
                cacheInvalidatedAt: null,
              },
            ],
          },
        });
      }
      return jsonResponse({
        job: {
          jobId: "job-restored",
          status: "needs_reconciliation",
          revision: 4,
          currentSourceId: "qiita",
          errorCode: "enqueue_unknown",
          sources: [
            {
              sourceId: "qiita",
              status: "unknown",
              resultCount: null,
              errorCode: "enqueue_unknown",
              cacheInvalidatedAt: null,
            },
          ],
        },
      });
    });

    render(
      <RefreshProvider>
        <FetchButton selectedSource="all" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    expect(
      await screen.findByText(
        "更新状況を確認できません。自動再実行は行いません。管理者による確認が必要です。",
      ),
    ).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/refresh-jobs",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchSpy.mock.calls.some(([url]) => url === "/api/refresh-jobs/job-restored")).toBe(
      true,
    );
  });

  it("follows the aggregate job returned by a single-source busy response", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (input === "/api/fetch-news") {
        return jsonResponse(
          { error: "refresh already running", jobId: "job-busy", status: "running" },
          409,
        );
      }
      if (input === "/api/refresh-jobs/job-busy") {
        return jsonResponse({
          job: {
            jobId: "job-busy",
            status: "needs_reconciliation",
            revision: 4,
            currentSourceId: "qiita",
            errorCode: "enqueue_unknown",
            sources: [
              {
                sourceId: "qiita",
                status: "unknown",
                resultCount: null,
                errorCode: "enqueue_unknown",
                cacheInvalidatedAt: null,
              },
            ],
          },
        });
      }
      return jsonResponse({ job: null });
    });

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );
    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    expect(
      await screen.findByText("管理者の確認が終わるまで更新を停止しています"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ニュースを取得してスコアリング" })).toBeNull();
    expect(fetchSpy.mock.calls.some(([url]) => url === "/api/refresh-jobs/job-busy")).toBe(true);
    expect(fetchSpy.mock.calls.filter(([url]) => url === "/api/fetch-news")).toHaveLength(1);
  });

  it("calls onSourceChange when source is changed", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "qiita");

    await waitFor(() => {
      expect(mockOnSourceChange).toHaveBeenCalledWith("qiita");
    });
  });

  it("keeps source pending until the action finishes, then updates the URL", async () => {
    const user = userEvent.setup();
    let finishSourceChange: () => void = () => {};
    const sourceChange = new Promise<void>((resolve) => {
      finishSourceChange = resolve;
    });
    const steps: string[] = [];
    mockOnSourceChange.mockImplementation(async () => {
      steps.push("action-start");
      await sourceChange;
      steps.push("action-done");
    });
    mockPush.mockImplementation(() => steps.push("push"));

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "qiita");

    await waitFor(() => expect(select).toBeDisabled());
    expect(steps).toEqual(["action-start"]);
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => finishSourceChange());

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("?source=qiita", { scroll: false }));
    expect(steps).toEqual(["action-start", "action-done", "push"]);
    expect(select).toBeEnabled();
  });

  it("does not update the URL when the source action fails and restores the filter", async () => {
    const user = userEvent.setup();
    mockOnSourceChange.mockRejectedValue(new Error("source update failed"));
    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "qiita");

    await waitFor(() => expect(select).toBeEnabled());
    expect(select.value).toBe("zenn");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps source and API fetch pending states independent", async () => {
    const user = userEvent.setup();
    let finishSourceChange: () => void = () => {};
    const sourceChange = new Promise<void>((resolve) => {
      finishSourceChange = resolve;
    });
    let finishFetch: (response: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      finishFetch = resolve;
    });
    mockOnSourceChange.mockReturnValue(sourceChange);
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await user.selectOptions(select, "qiita");
    await waitFor(() => expect(select).toBeDisabled());

    const fetchButton = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchButton);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "取得・スコアリング中..." })).toBeInTheDocument();
    expect(select).toBeDisabled();

    await act(async () => finishSourceChange());
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.getByRole("button", { name: "取得・スコアリング中..." })).toBeInTheDocument();

    await act(async () =>
      finishFetch(jsonResponse({ ok: true, results: [{ fetched: 2, saved: 1, errors: [] }] })),
    );
    await waitFor(() => expect(screen.getByText("1件 スコアリング完了")).toBeInTheDocument());
  });

  it("shows loading state during API call", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    expect(screen.getByRole("button", { name: "取得・スコアリング中..." })).toBeInTheDocument();
    expect(screen.getByText("記事取得中...")).toBeInTheDocument();

    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, results: [{ fetched: 5, saved: 3, errors: [] }] }));
    });

    await waitFor(() => {
      expect(screen.getByText("3件 スコアリング完了")).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/fetch-news",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ source: "zenn" }),
      }),
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("reads progress across split NDJSON chunks and applies the final result once", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let releaseResult: () => void = () => {};
    const resultGate = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    const progressLine =
      JSON.stringify({
        type: "progress",
        stage: "scoring",
        scoring: { completed: 1, total: 2, failed: 0 },
      }) + "\n";
    const resultLine =
      JSON.stringify({
        type: "result",
        ok: true,
        message: "Scoring queued",
        results: [{ fetched: 2, saved: 1, errors: [] }],
        perSource: [{ source: "zenn", fetched: 2 }],
        cacheInvalidationToken: "signed-short-lived-token",
      }) + "\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            const splitAt = 17;
            controller.enqueue(encoder.encode(progressLine.slice(0, splitAt)));
            controller.enqueue(encoder.encode(progressLine.slice(splitAt)));
            await resultGate;
            controller.enqueue(encoder.encode(resultLine));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => expect(screen.getByText("採点中 1 / 2（失敗 0）")).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/fetch-news",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/x-ndjson" }),
      }),
    );
    expect(mockRefresh).not.toHaveBeenCalled();

    await act(async () => releaseResult());

    await waitFor(() => expect(screen.getByText("1件 スコアリング完了")).toBeInTheDocument());
    expect(mockInvalidateArticlesAfterFetch).toHaveBeenCalledWith("signed-short-lived-token");
    expect(mockInvalidateArticlesAfterFetch).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("waits for article cache invalidation before refreshing after the stream succeeds", async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let releaseAction: (value: { ok: true }) => void = () => {};
    mockInvalidateArticlesAfterFetch.mockImplementationOnce(
      () => new Promise((resolve) => (releaseAction = resolve)),
    );
    const resultLine =
      JSON.stringify({
        type: "result",
        ok: true,
        results: [{ fetched: 1, saved: 1, errors: [] }],
        cacheInvalidationToken: "signed-short-lived-token",
      }) + "\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(encoder.encode(resultLine), {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );
    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => expect(mockInvalidateArticlesAfterFetch).toHaveBeenCalledTimes(1));
    expect(mockRefresh).not.toHaveBeenCalled();

    await act(async () => releaseAction({ ok: true }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh the article list when cache invalidation fails", async () => {
    const user = userEvent.setup();
    mockInvalidateArticlesAfterFetch.mockRejectedValueOnce(new Error("Unauthorized"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `${JSON.stringify({
          type: "result",
          ok: true,
          results: [{ fetched: 1, saved: 1, errors: [] }],
          cacheInvalidationToken: "signed-short-lived-token",
        })}\n`,
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );
    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() =>
      expect(
        screen.getByText("一覧の更新を確認できませんでした。ページを再読み込みしてください。"),
      ).toBeInTheDocument(),
    );
    expect(mockInvalidateArticlesAfterFetch).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a stream error event",
      body: `${JSON.stringify({ type: "error", error: "ニュース取得に失敗しました" })}\n`,
    },
    {
      label: "a stream that closes before its result event",
      body: `${JSON.stringify({
        type: "progress",
        stage: "scoring",
        scoring: { completed: 1, total: 2, failed: 0 },
      })}\n`,
    },
  ])("shows an error for $label and releases loading state", async ({ body }) => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => expect(screen.getByText("ニュース取得に失敗しました")).toBeInTheDocument());
    expect(mockInvalidateArticlesAfterFetch).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "ニュースを取得してスコアリング" }),
    ).toBeInTheDocument();
  });

  it("displays error on API failure (ok: false)", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false }));

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("ニュース取得に失敗しました")).toBeInTheDocument();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText("記事取得中...")).not.toBeInTheDocument();
  });

  it.each([
    {
      label: "non-2xx JSON responses",
      responseOk: false,
      body: { ok: true, results: [{ fetched: 5, saved: 3 }] },
    },
    { label: "a null response body", responseOk: true, body: null },
    { label: "a response without results", responseOk: true, body: { ok: true } },
    {
      label: "a null result item",
      responseOk: true,
      body: { ok: true, results: [null] },
    },
    {
      label: "an empty result item",
      responseOk: true,
      body: { ok: true, results: [{}] },
    },
    {
      label: "a result item that is an array",
      responseOk: true,
      body: { ok: true, results: [[]] },
    },
    {
      label: "a result without fetched",
      responseOk: true,
      body: { ok: true, results: [{ errors: [] }] },
    },
    {
      label: "a string fetched count",
      responseOk: true,
      body: { ok: true, results: [{ fetched: "5" }] },
    },
    {
      label: "a result without errors",
      responseOk: true,
      body: { ok: true, results: [{ fetched: 5 }] },
    },
    {
      label: "a null saved count",
      responseOk: true,
      body: { ok: true, results: [{ saved: null }] },
    },
    {
      label: "a non-finite fetched count",
      responseOk: true,
      body: { ok: true, results: [{ fetched: Number.NaN }] },
    },
    {
      label: "counts whose sum is non-finite",
      responseOk: true,
      body: { ok: true, results: [{ fetched: 1e308 }, { fetched: 1e308 }] },
    },
    {
      label: "a malformed errors field",
      responseOk: true,
      body: { ok: true, results: [{ errors: [1] }] },
    },
  ])("rejects $label without refreshing", async ({ responseOk, body }) => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body, responseOk ? 200 : 500));

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => {
      expect(screen.getByText("ニュース取得に失敗しました")).toBeInTheDocument();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText("記事取得中...")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ニュースを取得してスコアリング" }),
    ).toBeInTheDocument();
  });

  it("treats invalid JSON as an error and releases the loading state", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Invalid JSON", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => {
      expect(screen.getByText("通信エラーが発生しました")).toBeInTheDocument();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText("記事取得中...")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ニュースを取得してスコアリング" }),
    ).toBeInTheDocument();
  });

  it("accepts a result without saved and refreshes", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, results: [{ fetched: 5, errors: [] }] }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => {
      expect(screen.getByText("0件 スコアリング完了")).toBeInTheDocument();
    });
    expect(mockInvalidateArticlesAfterFetch).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText("記事取得中...")).not.toBeInTheDocument();
    });
  });

  it("displays network error on fetch rejection", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network Error"));

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("通信エラーが発生しました")).toBeInTheDocument();
    });
  });

  it("displays success results correctly", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        results: [{ fetched: 5, saved: 3, errors: [] }],
      }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("3件 スコアリング完了")).toBeInTheDocument();
    });

    // Toggle details
    const detailsBtn = screen.getByRole("button", { name: "詳細を表示" });
    await user.click(detailsBtn);

    expect(screen.getByText("5件取得 / 3件スコアリング ✅")).toBeInTheDocument();
  });

  it("displays error results with warning indicator", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        results: [{ fetched: 5, saved: 2, errors: ["Some error"] }],
      }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("2件 スコアリング完了")).toBeInTheDocument();
    });

    const detailsBtn = screen.getByRole("button", { name: "詳細を表示" });
    await user.click(detailsBtn);

    expect(screen.getByText("5件取得 / 2件スコアリング ⚠")).toBeInTheDocument();
  });

  it("clearly labels scoring failures in the result summary", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        results: [
          {
            fetched: 5,
            saved: 2,
            errors: ["Scoring failed: Gemini API error: 429"],
            scoringErrors: ["採点サービスでエラーが発生しました。時間をおいて再試行してください。"],
          },
        ],
      }),
    );

    render(
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));

    await waitFor(() => {
      expect(screen.getByText(/採点エラー/)).toBeInTheDocument();
    });
    expect(
      screen.getByText("採点サービスでエラーが発生しました。時間をおいて再試行してください。"),
    ).toBeInTheDocument();
  });
});

describe("Refresh lifecycle integration", () => {
  const mockOnSourceChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTransitionOverride.current = null;
  });

  it("keeps fetch progress active when a source change supplies new article IDs", async () => {
    let replaceArticles: ((articles: Article[]) => void) | null = null;

    function RscSimulatorPage() {
      const [articles, setArticles] = useState<Article[]>(initialMockArticles);

      useEffect(() => {
        replaceArticles = setArticles;
      }, []);

      return (
        <RefreshProvider>
          <FetchButton selectedSource="qiita" onSourceChange={mockOnSourceChange} />
          <NewsSection articles={articles} />
        </RefreshProvider>
      );
    }

    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => {}));
    render(<RscSimulatorPage />);

    const fetchButton = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await act(async () => {
      fireEvent.click(fetchButton);
    });

    expect(screen.getByText("記事取得中...")).toBeInTheDocument();
    expect(fetchButton).toBeDisabled();

    await act(async () => {
      replaceArticles?.([...initialMockArticles, newScoredArticle]);
    });

    expect(screen.getByText("スコアリング済み新着記事")).toBeInTheDocument();
    expect(screen.getByText("記事取得中...")).toBeInTheDocument();
    expect(screen.getByText("(更新中...)")).toBeInTheDocument();
    expect(fetchButton).toBeDisabled();
  });

  it("clears refreshing when API returns saved=0 and no new article IDs appear", async () => {
    // This test reproduces the "never fires" bug:
    // When saved=0, RSC returns the same articles (no new IDs),
    // so NewsSection's hasNewIds check never fires setRefreshing(false).
    // The fallback timeout in handleFetch must clear it.

    vi.useFakeTimers({ shouldAdvanceTime: true });

    let rscRefresh: ((articles: Article[]) => void) | null = null;

    function RscSimulatorPage() {
      const [articles, setArticles] = useState<Article[]>(initialMockArticles);
      const setArticlesRef = useRef(setArticles);
      useEffect(() => {
        setArticlesRef.current = setArticles;
      }, []);
      useEffect(() => {
        rscRefresh = (newArticles: Article[]) => {
          setArticlesRef.current(newArticles);
        };
      }, []);

      return (
        <RefreshProvider>
          <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
          <NewsSection articles={articles} />
        </RefreshProvider>
      );
    }

    // mockRefresh returns SAME articles (no new IDs — simulates saved=0)
    mockRefresh.mockImplementation(() => {
      if (rscRefresh) {
        rscRefresh([...initialMockArticles]);
      }
    });

    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(<RscSimulatorPage />);

    // ----- Phase 1: Initial state -----
    expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    expect(screen.getByText("(2件)")).toBeInTheDocument();

    // ----- Phase 2: Click fetch → skeleton shows -----
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));
    });

    expect(screen.getByText("(更新中...)")).toBeInTheDocument();

    // ----- Phase 3: API responds with saved=0 -----
    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, results: [{ fetched: 5, saved: 0, errors: [] }] }));
    });

    // "0件 スコアリング完了" result appears
    expect(screen.getByText("0件 スコアリング完了")).toBeInTheDocument();

    // BUG: skeleton is still visible (stuck — no new IDs detected)
    // After the fix, the fallback timeout should clear it within ~5s.
    // For now, advance past the fallback to verify it fires.
    await vi.advanceTimersByTimeAsync(6_000);

    // After fix: articles should be visible again, skeleton gone
    await waitFor(() => {
      expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    });
    expect(screen.queryByText("(更新中...)")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("keeps skeleton visible until new articles arrive after refresh", async () => {
    const user = userEvent.setup();

    // ----- wrapper that simulates RSC page behavior -----
    // Manages articles state and reacts to router.refresh()
    let rscRefresh: ((articles: Article[]) => void) | null = null;

    function RscSimulatorPage() {
      const [articles, setArticles] = useState<Article[]>(initialMockArticles);
      const setArticlesRef = useRef(setArticles);
      useEffect(() => {
        setArticlesRef.current = setArticles;
      }, []);
      // Expose setter so mockRefresh can trigger article updates
      useEffect(() => {
        rscRefresh = (newArticles: Article[]) => {
          setArticlesRef.current(newArticles);
        };
      }, []);

      return (
        <RefreshProvider>
          <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
          <NewsSection articles={articles} />
        </RefreshProvider>
      );
    }

    // Wire mockRefresh to simulate RSC re-render with new articles
    mockRefresh.mockImplementation(() => {
      if (rscRefresh) {
        rscRefresh([...initialMockArticles, newScoredArticle]);
      }
    });

    // Controlled fetch promise
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise);

    render(<RscSimulatorPage />);

    // ----- Phase 1: Initial state -----
    expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    expect(screen.getByText("既存記事 2")).toBeInTheDocument();
    expect(screen.getByText("(2件)")).toBeInTheDocument();
    expect(screen.queryByText("(更新中...)")).not.toBeInTheDocument();

    // ----- Phase 2: Click fetch → skeleton shows -----
    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    // Updating indicator must be visible immediately
    expect(screen.getByText("(更新中...)")).toBeInTheDocument();
    // Old articles must still be visible but dimmed during loading
    expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    expect(screen.getByText("既存記事 2")).toBeInTheDocument();

    // ----- Phase 3: API completes, scoring done -----
    resolveFetch(jsonResponse({ ok: true, results: [{ fetched: 3, saved: 1, errors: [] }] }));

    // After API returns but before RSC data arrives:
    // updating indicator must STILL be visible, old articles stay dimmed
    await waitFor(() => {
      expect(screen.getByText("(更新中...)")).toBeInTheDocument();
    });

    // OLD articles remain visible but dimmed
    expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    expect(screen.getByText("既存記事 2")).toBeInTheDocument();

    // "0件" empty state must NOT appear during loading
    expect(screen.queryByText("(0件)")).not.toBeInTheDocument();

    // ----- Phase 4: RSC refresh delivers new articles -----
    // mockRefresh was already called inside startTransition.
    // It called rscRefresh which updated articles to include newScoredArticle.
    // Wait for the new article to appear (skeleton cleared).
    await waitFor(() => {
      expect(screen.getByText("スコアリング済み新着記事")).toBeInTheDocument();
    });

    // Once new article is visible, skeleton must be gone
    expect(screen.queryByText("(更新中...)")).not.toBeInTheDocument();
    // Article count must show 3
    expect(screen.getByText("(3件)")).toBeInTheDocument();
    // Old articles must also be visible
    expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    expect(screen.getByText("既存記事 2")).toBeInTheDocument();
  });

  it("does not let a timed-out refresh transition clear a later fetch indicator", async () => {
    vi.useFakeTimers();
    const transition = { pending: false };
    useTransitionOverride.current = () => [
      transition.pending,
      (callback: () => void) => {
        transition.pending = true;
        callback();
      },
    ];

    mockRefresh.mockImplementation(() => {});

    let resolveFirstFetch: (response: Response) => void = () => {};
    let resolveSecondFetch: (response: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFirstFetch = resolve)))
      .mockReturnValueOnce(new Promise<Response>((resolve) => (resolveSecondFetch = resolve)));

    const page = (
      <RefreshProvider>
        <FetchButton selectedSource="zenn" onSourceChange={mockOnSourceChange} />
      </RefreshProvider>
    );
    const { rerender } = render(page);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));
    });
    await act(async () => {
      resolveFirstFetch(
        jsonResponse({ ok: true, results: [{ fetched: 1, saved: 0, errors: [] }] }),
      );
    });

    await act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(
      screen.getByText("一覧の更新を確認できませんでした。ページを再読み込みしてください。"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ニュースを取得してスコアリング" }));
    });
    expect(screen.getByText("記事取得中...")).toBeInTheDocument();

    await act(async () => {
      transition.pending = false;
      rerender(page);
    });

    expect(screen.getByText("記事取得中...")).toBeInTheDocument();
    await act(async () => {
      resolveSecondFetch(
        jsonResponse({ ok: true, results: [{ fetched: 1, saved: 0, errors: [] }] }),
      );
    });
    useTransitionOverride.current = null;
    vi.useRealTimers();
  });
});
