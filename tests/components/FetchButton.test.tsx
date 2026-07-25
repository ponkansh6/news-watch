// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, useEffect, useRef } from "react";
import FetchButton from "../../src/app/fetch-button";
import NewsSection from "../../src/app/news-section";
import { RefreshProvider } from "../../src/app/refresh-context";
import { SOURCES } from "@/lib/sources";
import type { Article } from "../../src/app/article-list";
import "@testing-library/jest-dom/vitest";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

// Shared mock articles used across tests
const initialMockArticles: Article[] = [
  {
    id: 1,
    title: "既存記事 1",
    description: "概要1",
    url: "https://example.com/1",
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName: "Source A",
    sourceId: "source-a",
    author: null,
    keyword: null,
    summary: "サマリー1",
    relevance: 80,
    usefulness: 85,
    recency: 90,
    score: 85,
    reason: "理由1",
    scoredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    title: "既存記事 2",
    description: "概要2",
    url: "https://example.com/2",
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName: "Source B",
    sourceId: "source-b",
    author: null,
    keyword: null,
    summary: "サマリー2",
    relevance: 90,
    usefulness: 90,
    recency: 95,
    score: 92,
    reason: "理由2",
    scoredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
];

const newScoredArticle: Article = {
  id: 3,
  title: "スコアリング済み新着記事",
  description: "新着の概要",
  url: "https://example.com/3",
  urlToImage: null,
  publishedAt: new Date().toISOString(),
  sourceName: "Source C",
  sourceId: "source-c",
  author: null,
  keyword: null,
  summary: "新着サマリー",
  relevance: 88,
  usefulness: 92,
  recency: 99,
  score: 94,
  reason: "新着理由",
  scoredAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

describe("FetchButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all source checkboxes with correct names", () => {
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    for (const source of SOURCES) {
      expect(screen.getByText(source.name)).toBeInTheDocument();
    }
  });

  it("all sources are selected by default", () => {
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    for (const source of SOURCES) {
      const checkbox = screen.getByRole("checkbox", { name: source.name });
      expect(checkbox).toBeChecked();
    }
    expect(screen.getByText(`${SOURCES.length} / ${SOURCES.length} を選択中`)).toBeInTheDocument();
  });

  it("source toggle works correctly", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const firstSource = SOURCES[0];
    const checkbox = screen.getByRole("checkbox", { name: firstSource.name });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByText(`${SOURCES.length - 1} / ${SOURCES.length} を選択中`),
    ).toBeInTheDocument();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(`${SOURCES.length} / ${SOURCES.length} を選択中`)).toBeInTheDocument();
  });

  it("Select All button works", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    // Deselect first source
    const firstSource = SOURCES[0];
    const checkbox = screen.getByRole("checkbox", { name: firstSource.name });
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // Click "すべて選択"
    const selectAllBtn = screen.getByRole("button", { name: "すべて選択" });
    await user.click(selectAllBtn);

    for (const source of SOURCES) {
      expect(screen.getByRole("checkbox", { name: source.name })).toBeChecked();
    }
  });

  it("Select None button works", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const selectNoneBtn = screen.getByRole("button", { name: "選択解除" });
    await user.click(selectNoneBtn);

    for (const source of SOURCES) {
      expect(screen.getByRole("checkbox", { name: source.name })).not.toBeChecked();
    }
    expect(screen.getByText(`0 / ${SOURCES.length} を選択中`)).toBeInTheDocument();
  });

  it("Fetch button is disabled when no sources selected", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const selectNoneBtn = screen.getByRole("button", { name: "選択解除" });
    await user.click(selectNoneBtn);

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    expect(fetchBtn).toBeDisabled();
  });

  it("shows loading state during API call", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise as Promise<Response>);

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    expect(screen.getByRole("button", { name: "取得・スコアリング中..." })).toBeInTheDocument();
    expect(screen.getByText("記事を更新中...")).toBeInTheDocument();

    resolveFetch({
      ok: true,
      json: async () => ({ ok: true, results: [{ fetched: 5, saved: 3, errors: [] }] }),
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "取得・スコアリング中..." }),
      ).not.toBeInTheDocument();
    });
  });

  it("displays error on API failure (ok: false)", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    } as Response);

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("ニュース取得に失敗しました")).toBeInTheDocument();
    });
  });

  it("displays network error on fetch rejection", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network Error"));

    render(
      <RefreshProvider>
        <FetchButton />
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ fetched: 5, saved: 3, errors: [] }],
      }),
    } as Response);

    render(
      <RefreshProvider>
        <FetchButton />
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ fetched: 5, saved: 2, errors: ["Some error"] }],
      }),
    } as Response);

    render(
      <RefreshProvider>
        <FetchButton />
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
});

describe("Refresh lifecycle integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Re-setup the router mock after clearing
    vi.mock("next/navigation", () => ({
      useRouter: () => ({
        replace: vi.fn(),
        refresh: mockRefresh,
      }),
    }));
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
      });
      // Expose setter so mockRefresh can trigger article updates
      useEffect(() => {
        rscRefresh = (newArticles: Article[]) => {
          setArticlesRef.current(newArticles);
        };
      }, []);

      return (
        <RefreshProvider>
          <FetchButton />
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
    let resolveFetch: (value: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise as Promise<Response>);

    render(<RscSimulatorPage />);

    // ----- Phase 1: Initial state -----
    expect(screen.getByText("既存記事 1")).toBeInTheDocument();
    expect(screen.getByText("既存記事 2")).toBeInTheDocument();
    expect(screen.getByText("(2件)")).toBeInTheDocument();
    expect(screen.queryByText("(更新中...)")).not.toBeInTheDocument();

    // ----- Phase 2: Click fetch → skeleton shows -----
    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    // Skeleton must be visible immediately
    expect(screen.getByText("(更新中...)")).toBeInTheDocument();
    // Old articles must NOT be visible during loading
    expect(screen.queryByText("既存記事 1")).not.toBeInTheDocument();
    expect(screen.queryByText("既存記事 2")).not.toBeInTheDocument();

    // ----- Phase 3: API completes, scoring done -----
    resolveFetch({
      ok: true,
      json: async () => ({ ok: true, results: [{ fetched: 3, saved: 1, errors: [] }] }),
    });

    // After API returns but before RSC data arrives:
    // skeleton must STILL be visible, old articles must NOT flash
    await waitFor(() => {
      expect(screen.getByText("(更新中...)")).toBeInTheDocument();
    });

    // OLD articles must NOT reappear
    expect(screen.queryByText("既存記事 1")).not.toBeInTheDocument();
    expect(screen.queryByText("既存記事 2")).not.toBeInTheDocument();

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
});
