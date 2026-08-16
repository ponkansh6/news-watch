// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBreakdown } from "@/components/article/score-popover";

describe("ScoreBreakdown component", () => {
  it("renders correct labels and weights", () => {
    render(<ScoreBreakdown score={8.3} relevance={5} usefulness={8} recency={10} />);

    expect(screen.getByText("関連性 (NTT との関連度)")).toBeDefined();
    expect(screen.getByText("有用性")).toBeDefined();
    expect(screen.getByText("新しさ")).toBeDefined();

    expect(screen.getByText("× 10%")).toBeDefined();
    expect(screen.getByText("× 60%")).toBeDefined();
    expect(screen.getByText("× 30%")).toBeDefined();
  });
});
