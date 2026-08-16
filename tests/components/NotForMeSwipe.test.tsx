// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "../lib/test-utils";
import { ArticleList, type ArticleListRow as Article } from "@/components/article/article-list";
import "@testing-library/jest-dom/vitest";

const mockArticle: Article = {
  id: 42,
  title: "Test Article Title",
  url: "https://example.com/article",
  publishedAt: "2026-01-01T00:00:00Z",
  sourceName: "Zenn",
  sourceId: "zenn",
  keyword: "test",
  keywordLabel: "Test",
  summary: "Test summary",
  relevance: 8,
  usefulness: 8,
  recency: 8,
  score: 8,
  reason: "This is a great reason for testing",
};

describe("NotForMeSwipe Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call /api/not-for-me/toggle on 4 swipes", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    for (let i = 0; i < 4; i++) {
      fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });
    }

    const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/not-for-me/toggle");
    expect(calls).toHaveLength(0);
  });

  it("calls /api/not-for-me/toggle on 5 swipes", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });
    }

    const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/not-for-me/toggle");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ articleId: 42 }),
    });
  });

  it("resets swipe counter after timeout", () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    for (let i = 0; i < 4; i++) {
      fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });
    }

    vi.advanceTimersByTime(4500);

    fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });

    const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/not-for-me/toggle");
    expect(calls).toHaveLength(0);
  });

  it("does not trigger NFM when swiping summary, source, or date", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);

    const summaryEl = screen.getByText("Test summary");
    const sourceEl = screen.getByText("Zenn");
    const dateEl = screen.getByText("01/01");

    for (const el of [summaryEl, sourceEl, dateEl]) {
      for (let i = 0; i < 5; i++) {
        fireEvent.pointerDown(el, { clientX: 0, clientY: 0 });
        fireEvent.pointerUp(el, { clientX: 100, clientY: 0 });
      }
    }

    const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/not-for-me/toggle");
    expect(calls).toHaveLength(0);
  });

  it("does not trigger favorite on title taps", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(link);
    }

    const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(calls).toHaveLength(0);
  });

  it("triggers favorite on source and date taps", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const sourceEl = screen.getByText("Zenn");
    const dateEl = screen.getByText("01/01");

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(sourceEl);
    }
    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(dateEl);
    }

    const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/favorites/toggle");
    expect(calls).toHaveLength(2);
  });

  it("prevents click when swipe occurs", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const dispatched = link.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(dispatched).toBe(false);
  });

  it("allows normal click when no swipe occurs", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const dispatched = link.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(dispatched).toBe(true);
  });

  it("shows success toasts for NFM add and remove", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });
    }

    await waitFor(() => {
      expect(screen.getByText("NFM に登録しました")).toBeInTheDocument();
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ notForMe: false }),
    });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });
    }

    await waitFor(() => {
      expect(screen.getByText("NFM を解除しました")).toBeInTheDocument();
    });
  });

  it("shows error toast when NFM toggle fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const link = screen.getByRole("link", { name: "Test Article Title" });

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(link, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(link, { clientX: 100, clientY: 0 });
    }

    await waitFor(() => {
      expect(screen.getByText(/NFM の更新に失敗しました/)).toBeInTheDocument();
    });
  });

  it("works with favorite taps on summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ favorited: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ArticleList articles={[mockArticle]} />);
    const summaryEl = screen.getByText("Test summary");

    for (let i = 0; i < 5; i++) {
      fireEvent.pointerDown(summaryEl);
    }

    await waitFor(() => {
      expect(screen.getByText("お気に入りに登録しました")).toBeInTheDocument();
    });
  });
});
