// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ArticleList, { type Article } from "../../src/app/article-list";
import "@testing-library/jest-dom/vitest";

const mockArticles: Article[] = [
  {
    id: 1,
    title: "テスト記事 1",
    description: "説明 1",
    url: "https://example.com/1",
    urlToImage: null,
    publishedAt: "2026-03-30T00:00:00Z",
    sourceName: "Zenn",
    sourceId: "zenn",
    author: "Author 1",
    keyword: "ai",
    summary: "これは要約1です。",
    relevance: 8.0,
    usefulness: 9.0,
    recency: 7.0,
    score: 8,
    reason: "関連性が高いため",
    scoredAt: "2026-03-30T00:00:00Z",
    createdAt: "2026-03-30T00:00:00Z",
  },
  {
    id: 2,
    title: "テスト記事 2",
    description: "説明 2",
    url: "https://example.com/2",
    urlToImage: null,
    publishedAt: "2026-03-30T00:00:00Z",
    sourceName: "Qiita",
    sourceId: "qiita",
    author: "Author 2",
    keyword: null,
    summary: null,
    relevance: null,
    usefulness: null,
    recency: null,
    score: null,
    reason: null,
    scoredAt: null,
    createdAt: "2026-03-30T00:00:00Z",
  },
];

describe("ArticleList", () => {
  it("renders a list of articles with title, source, score, and summary", () => {
    render(<ArticleList articles={mockArticles} />);

    expect(screen.getByText("テスト記事 1")).toBeInTheDocument();
    expect(screen.getByText("Zenn")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("これは要約1です。")).toBeInTheDocument();
  });

  it("handles article with null score gracefully", () => {
    render(<ArticleList articles={mockArticles} />);

    expect(screen.getByText("テスト記事 2")).toBeInTheDocument();
    expect(screen.getByText("Qiita")).toBeInTheDocument();
    // null score badge should display "--"
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders correct links to source URLs", () => {
    render(<ArticleList articles={mockArticles} />);

    const link1 = screen.getByRole("link", { name: "テスト記事 1" });
    expect(link1).toHaveAttribute("href", "https://example.com/1");
    expect(link1).toHaveAttribute("target", "_blank");
    expect(link1).toHaveAttribute("rel", "noopener noreferrer");

    const link2 = screen.getByRole("link", { name: "テスト記事 2" });
    expect(link2).toHaveAttribute("href", "https://example.com/2");
  });

  it("shows score breakdown tooltip on score badge", () => {
    const { container } = render(<ArticleList articles={mockArticles} />);
    // The first article's ScoreBadge span has title containing "関連性: 8.0 (20%)\n有用性: 9.0 (50%)..."
    // Avoid matching the reason span (title="関連性が高いため") by using a more specific selector
    const scoreBadge = container.querySelector<HTMLSpanElement>("span[title*='関連性: ']");
    expect(scoreBadge).toBeInTheDocument();
    expect(scoreBadge?.getAttribute("title")).toContain("関連性: 8.0");
    expect(scoreBadge?.getAttribute("title")).toContain("有用性: 9.0");
    expect(scoreBadge?.getAttribute("title")).toContain("新しさ: 7.0");
    expect(scoreBadge?.getAttribute("title")).toContain("合成: 8.0");
  });
});
