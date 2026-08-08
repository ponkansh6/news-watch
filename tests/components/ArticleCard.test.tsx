// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleCard } from "@/components/article/article-card";
import "@testing-library/jest-dom/vitest";

describe("ArticleCard", () => {
  it("renders correctly with missing summary, keywords, and score", () => {
    render(
      <ArticleCard
        id={1}
        title="テストカード"
        url="https://example.com"
        source="Zenn"
        publishedAt="2026-03-30T00:00:00Z"
      />,
    );

    expect(screen.getByText("テストカード")).toBeInTheDocument();
    expect(screen.getByText("Zenn")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument(); // null score
  });

  it("renders reason in a Popover and opens it on click", async () => {
    render(
      <ArticleCard
        id={2}
        title="理由付き記事"
        url="https://example.com"
        source="Qiita"
        publishedAt="2026-03-30T00:00:00Z"
        reason="この記事は非常に有用で最新のトレンドです"
      />,
    );

    const button = screen.getByRole("button", { name: /スコアの理由:/ });
    expect(button).toBeInTheDocument();
    // truncate は CSS による省略のため、DOM の textContent には全文が含まれる
    expect(button).toHaveTextContent("この記事は非常に有用で最新のトレンドです");

    fireEvent.click(button);

    // Popover content should appear (use getAllByText since trigger also has it)
    const matches = await screen.findAllByText("この記事は非常に有用で最新のトレンドです");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
