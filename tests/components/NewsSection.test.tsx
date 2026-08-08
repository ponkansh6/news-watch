// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, renderHook, act } from "../lib/test-utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NewsSection } from "@/components/news/news-section";
import { type ArticleListRow as Article } from "@/components/article/article-list";
import { SkeletonList } from "@/components/article/article-skeleton";
import { RefreshProvider, useRefresh } from "../../src/app/refresh-context";
import "@testing-library/jest-dom/vitest";

function RefreshSetter({ refreshing, filtering }: { refreshing?: boolean; filtering?: boolean }) {
  const { setRefreshing, setFiltering } = useRefresh();
  useEffect(() => {
    if (refreshing !== undefined) setRefreshing(refreshing);
    if (filtering !== undefined) setFiltering(filtering);
  }, [refreshing, filtering, setRefreshing, setFiltering]);
  return null;
}

function Wrapper({
  refreshing = false,
  filtering = false,
  children,
}: {
  refreshing?: boolean;
  filtering?: boolean;
  children: ReactNode;
}) {
  return (
    <RefreshProvider>
      <RefreshSetter refreshing={refreshing} filtering={filtering} />
      {children}
    </RefreshProvider>
  );
}

const mockArticles: Article[] = [
  {
    id: 1,
    title: "テスト記事 1",
    url: "https://example.com/1",
    publishedAt: new Date().toISOString(),
    sourceName: "Test Source",
    sourceId: "test-source",
    keyword: null,
    keywordLabel: null,
    summary: "これはテスト記事の概要です 1",
    relevance: 80,
    usefulness: 90,
    recency: 85,
    score: 85,
    reason: "非常に有用な記事です。",
  },
  {
    id: 2,
    title: "テスト記事 2",
    url: "https://example.com/2",
    publishedAt: new Date().toISOString(),
    sourceName: "Test Source",
    sourceId: "test-source",
    keyword: null,
    keywordLabel: null,
    summary: "これはテスト記事の概要です 2",
    relevance: 90,
    usefulness: 90,
    recency: 90,
    score: 90,
    reason: "極めて有用な記事です。",
  },
];

describe("SkeletonList", () => {
  it("renders custom number of skeleton cards", () => {
    const { container } = render(<SkeletonList count={3} />);
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(3);
    const pulseElements = container.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it("renders default 5 skeleton cards when count is not specified", () => {
    const { container } = render(<SkeletonList />);
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(5);
  });
});

describe("NewsSection", () => {
  it("shows skeleton when isRefreshing=true", () => {
    render(
      <Wrapper refreshing={true}>
        <NewsSection articles={[]} />
      </Wrapper>,
    );

    expect(screen.getByText("スコアリング済み記事")).toBeInTheDocument();
    expect(screen.getByText("(更新中...)")).toBeInTheDocument();
    const { container } = render(
      <Wrapper refreshing={true}>
        <NewsSection articles={[]} />
      </Wrapper>,
    );
    expect(container.querySelectorAll("article").length).toBeGreaterThan(0);
  });

  it("shows empty state when not refreshing and no articles", () => {
    render(
      <Wrapper refreshing={false}>
        <NewsSection articles={[]} />
      </Wrapper>,
    );

    expect(screen.getByText("(0件)")).toBeInTheDocument();
    expect(screen.getByText("まだ記事がありません")).toBeInTheDocument();
    expect(
      screen.getByText("「ニュースを取得」ボタンで最新ニュースを取得・スコアリングできます"),
    ).toBeInTheDocument();
  });

  it("shows custom emptyMessage when provided", () => {
    const customMessage = "カスタムの空メッセージです。";
    render(
      <Wrapper refreshing={false}>
        <NewsSection articles={[]} emptyMessage={customMessage} />
      </Wrapper>,
    );

    expect(screen.getByText(customMessage)).toBeInTheDocument();
  });

  it("renders ArticleList when articles exist and not refreshing", () => {
    render(
      <Wrapper refreshing={false}>
        <NewsSection articles={mockArticles} />
      </Wrapper>,
    );

    expect(screen.getByText("スコアリング済み記事")).toBeInTheDocument();
    expect(screen.getByText(`(${mockArticles.length}件)`)).toBeInTheDocument();
    expect(screen.getByText("テスト記事 1")).toBeInTheDocument();
    expect(screen.getByText("テスト記事 2")).toBeInTheDocument();
  });

  it("displays articles in server-provided order", () => {
    render(
      <Wrapper refreshing={false}>
        <NewsSection articles={mockArticles} />
      </Wrapper>,
    );

    const articles = screen.getAllByRole("article");
    expect(articles[0]).toHaveTextContent("テスト記事 1");
    expect(articles[1]).toHaveTextContent("テスト記事 2");
  });

  it("shows filtering indicator when isFiltering=true and keeps articles visible", () => {
    render(
      <Wrapper refreshing={false} filtering={true}>
        <NewsSection articles={mockArticles} />
      </Wrapper>,
    );

    expect(screen.getByText("スコアリング済み記事")).toBeInTheDocument();
    expect(screen.getByText("フィルタリング中...")).toBeInTheDocument();
    // Articles should still be visible (not skeleton)
    expect(screen.getByText("テスト記事 1")).toBeInTheDocument();
    expect(screen.getByText("テスト記事 2")).toBeInTheDocument();
  });

  it("does NOT prematurely clear refreshing when articles reference changes but NO new scored articles", () => {
    // This test reproduces the bug: when isRefreshing=true and the articles
    // reference changes (e.g., RSC re-created the same array) BEFORE new
    // scored articles actually arrive, the useEffect in NewsSection
    // prematurely calls setRefreshing(false) because it only checks
    // reference equality, not whether new articles appeared.

    // We use the Wrapper to set isRefreshing=true initially.
    // Then we change the articles reference (same data, new array),
    // simulating RSC returning the same articles during refresh.
    // The skeleton should STILL be visible because no scored articles arrived.

    const { rerender } = render(
      <Wrapper refreshing={true}>
        <NewsSection articles={mockArticles} />
      </Wrapper>,
    );

    // Verify skeleton is showing
    expect(screen.getByText("(更新中...)")).toBeInTheDocument();

    // Simulate RSC re-render that returns the SAME articles (new reference).
    // In production, router.refresh() triggers RSC which always creates
    // new object references even for the same data.
    rerender(
      <Wrapper refreshing={true}>
        <NewsSection articles={[...mockArticles]} />
      </Wrapper>,
    );

    // BUG: skeleton gets cleared because the articles reference changed
    // even though no new scored articles arrived.
    // Expected: skeleton should STILL be visible
    // Actual: skeleton disappears because setRefreshing(false) was called
    expect(screen.getByText("(更新中...)")).toBeInTheDocument();
  });
});
