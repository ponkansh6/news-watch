// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import AnalyzeButton from "@/app/bookmarks/analyze-button";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("AnalyzeButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("idle / 有効状態", () => {
    render(<AnalyzeButton favoriteCount={5} lastAnalyzedAt={null} />);
    const button = screen.getByRole("button", { name: "傾向を分析" });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/お気に入りが/)).not.toBeInTheDocument();
  });

  it("件数不足 disabled", () => {
    render(<AnalyzeButton favoriteCount={3} lastAnalyzedAt={null} />);
    const button = screen.getByRole("button", { name: "傾向を分析" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/お気に入りが5件以上で分析できます（現在 3 件）/)).toBeInTheDocument();
  });

  it("loading 表示", async () => {
    let resolveFetch: (val: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    mockFetch.mockReturnValueOnce(fetchPromise);

    render(<AnalyzeButton favoriteCount={5} lastAnalyzedAt={null} />);
    const button = screen.getByRole("button", { name: "傾向を分析" });

    await userEvent.click(button);

    expect(screen.getByRole("button", { name: "分析中…（最大45秒）" })).toBeDisabled();

    resolveFetch({
      ok: true,
      json: async () => ({ reused: false }),
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "傾向を分析" })).not.toBeDisabled();
    });
  });

  it("成功時 router.refresh + 成功メッセージ", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reused: false }),
    });

    render(<AnalyzeButton favoriteCount={5} lastAnalyzedAt={null} />);
    const button = screen.getByRole("button", { name: "傾向を分析" });

    await userEvent.click(button);

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.getByText("嗜好プロファイルを更新しました")).toBeInTheDocument();
    });
  });

  it("429 メッセージ", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "Analysis cooldown active" }),
    });

    render(<AnalyzeButton favoriteCount={5} lastAnalyzedAt={null} />);
    const button = screen.getByRole("button", { name: "傾向を分析" });

    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Analysis cooldown active")).toBeInTheDocument();
    });
  });
});
