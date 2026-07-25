// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import NewsSection from "../../src/app/news-section";
import { SkeletonList, type Article } from "../../src/app/article-list";
import { RefreshProvider, useRefresh } from "../../src/app/refresh-context";
import "@testing-library/jest-dom/vitest";

function RefreshSetter({ refreshing }: { refreshing: boolean }) {
  const { setRefreshing } = useRefresh();
  useEffect(() => {
    setRefreshing(refreshing);
  }, [refreshing, setRefreshing]);
  return null;
}

function Wrapper({ refreshing = false, children }: { refreshing?: boolean; children: ReactNode }) {
  return (
    <RefreshProvider>
      <RefreshSetter refreshing={refreshing} />
      {children}
    </RefreshProvider>
  );
}

const mockArticles: Article[] = [
  {
    id: 1,
    title: "テスト記事 1",
    description: "テスト記事の概要1",
    url: "https://example.com/1",
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName: "Test Source",
    sourceId: "test-source",
    author: null,
    keyword: null,
    summary: "これはテスト記事の概要です 1",
    relevance: 80,
    usefulness: 90,
    recency: 85,
    score: 85,
    reason: "非常に有用な記事です。",
    scoredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    title: "テスト記事 2",
    description: "テスト記事の概要2",
    url: "https://example.com/2",
    urlToImage: null,
    publishedAt: new Date().toISOString(),
    sourceName: "Test Source",
    sourceId: "test-source",
    author: null,
    keyword: null,
    summary: "これはテスト記事の概要です 2",
    relevance: 90,
    usefulness: 90,
    recency: 90,
    score: 90,
    reason: "極めて有用な記事です。",
    scoredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
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
});
