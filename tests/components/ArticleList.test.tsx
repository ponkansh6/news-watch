// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ArticleList, type ArticleListRow as Article } from "@/components/article/article-list";
import "@testing-library/jest-dom/vitest";

const renderWithProviders = (component: React.ReactElement) => {
  return render(<TooltipProvider>{component}</TooltipProvider>);
};

const mockArticles: Article[] = [
  {
    id: 1,
    title: "テスト記事 1",
    url: "https://example.com/1",
    publishedAt: "2026-03-30T00:00:00Z",
    sourceName: "Zenn",
    sourceId: "zenn",
    keyword: "ai",
    keywordLabel: "AI",
    summary: "これは要約1です。",
    relevance: 8.0,
    usefulness: 9.0,
    recency: 7.0,
    score: 8,
    reason: "関連性が高いため",
  },
  {
    id: 2,
    title: "テスト記事 2",
    url: "https://example.com/2",
    publishedAt: "2026-03-30T00:00:00Z",
    sourceName: "Qiita",
    sourceId: "qiita",
    keyword: null,
    keywordLabel: null,
    summary: null,
    relevance: null,
    usefulness: null,
    recency: null,
    score: null,
    reason: null,
  },
];

describe("ArticleList", () => {
  it("renders a list of articles with title, source, score, and summary", () => {
    renderWithProviders(<ArticleList articles={mockArticles} />);

    expect(screen.getByText("テスト記事 1")).toBeInTheDocument();
    expect(screen.getByText("Zenn")).toBeInTheDocument();
    expect(screen.getByText("8.0")).toBeInTheDocument();
    expect(screen.getByText("これは要約1です。")).toBeInTheDocument();
  });

  it("handles article with null score gracefully", () => {
    renderWithProviders(<ArticleList articles={mockArticles} />);

    expect(screen.getByText("テスト記事 2")).toBeInTheDocument();
    expect(screen.getByText("Qiita")).toBeInTheDocument();
    // null score badge should display "--"
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders correct links to source URLs", () => {
    renderWithProviders(<ArticleList articles={mockArticles} />);

    const link1 = screen.getByRole("link", { name: "テスト記事 1" });
    expect(link1).toHaveAttribute("href", "https://example.com/1");
    expect(link1).toHaveAttribute("target", "_blank");
    expect(link1).toHaveAttribute("rel", "noopener noreferrer");

    const link2 = screen.getByRole("link", { name: "テスト記事 2" });
    expect(link2).toHaveAttribute("href", "https://example.com/2");
  });

  it("shows score breakdown tooltip on score badge", async () => {
    renderWithProviders(<ArticleList articles={mockArticles} />);
    const scoreButton = screen.getByRole("button", { name: /スコア 8、高スコア/ });
    expect(scoreButton).toBeInTheDocument();

    fireEvent.click(scoreButton);
    expect(await screen.findByText("関連性")).toBeInTheDocument();
    expect(screen.getByText(/有用性/)).toBeInTheDocument();
    expect(screen.getByText(/新しさ/)).toBeInTheDocument();
  });
});
