// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
