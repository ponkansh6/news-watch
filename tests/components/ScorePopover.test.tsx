// @vitest-environment happy-dom
import React from "react";
import { render, screen } from "../lib/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import ScorePopover from "@/components/article/score-popover";

describe("ScorePopover", () => {
  it("renders -- and no button when score is null", () => {
    render(<ScorePopover score={null} relevance={null} usefulness={null} recency={null} />);
    const fallback = screen.getByText("--");
    expect(fallback).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders trigger with correct aria-label and styling when score is present", () => {
    render(<ScorePopover score={8.4} relevance={8.0} usefulness={9.0} recency={7.5} />);
    const button = screen.getByRole("button", { name: /スコア 8.4、高スコア/ });
    expect(button).toBeDefined();
    expect(button.textContent).toBe("8.4");
  });

  it("shows breakdown details when trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<ScorePopover score={8.4} relevance={8.0} usefulness={9.0} recency={7.5} />);

    const button = screen.getByRole("button", { name: /スコア 8.4、高スコア/ });
    await user.click(button);

    expect(screen.getByText("関連性")).toBeDefined();
    expect(screen.getByText("有用性")).toBeDefined();
    expect(screen.getByText("新しさ")).toBeDefined();
    expect(screen.getByText("合成")).toBeDefined();

    // Check that synthesized score appears inside the breakdown/popover (getAllByText since trigger also has 8.4)
    const scores = screen.getAllByText("8.4");
    expect(scores.length).toBeGreaterThanOrEqual(2);
  });
});
