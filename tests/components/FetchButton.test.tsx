// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FetchButton from "../../src/app/fetch-button";
import { RefreshProvider } from "../../src/app/refresh-context";
import { SOURCES } from "@/lib/sources";
import "@testing-library/jest-dom/vitest";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

describe("FetchButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all source checkboxes with correct names", () => {
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    for (const source of SOURCES) {
      expect(screen.getByText(source.name)).toBeInTheDocument();
    }
  });

  it("all sources are selected by default", () => {
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    for (const source of SOURCES) {
      const checkbox = screen.getByRole("checkbox", { name: source.name });
      expect(checkbox).toBeChecked();
    }
    expect(screen.getByText(`${SOURCES.length} / ${SOURCES.length} を選択中`)).toBeInTheDocument();
  });

  it("source toggle works correctly", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const firstSource = SOURCES[0];
    const checkbox = screen.getByRole("checkbox", { name: firstSource.name });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByText(`${SOURCES.length - 1} / ${SOURCES.length} を選択中`),
    ).toBeInTheDocument();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(`${SOURCES.length} / ${SOURCES.length} を選択中`)).toBeInTheDocument();
  });

  it("Select All button works", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    // Deselect first source
    const firstSource = SOURCES[0];
    const checkbox = screen.getByRole("checkbox", { name: firstSource.name });
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // Click "すべて選択"
    const selectAllBtn = screen.getByRole("button", { name: "すべて選択" });
    await user.click(selectAllBtn);

    for (const source of SOURCES) {
      expect(screen.getByRole("checkbox", { name: source.name })).toBeChecked();
    }
  });

  it("Select None button works", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const selectNoneBtn = screen.getByRole("button", { name: "選択解除" });
    await user.click(selectNoneBtn);

    for (const source of SOURCES) {
      expect(screen.getByRole("checkbox", { name: source.name })).not.toBeChecked();
    }
    expect(screen.getByText(`0 / ${SOURCES.length} を選択中`)).toBeInTheDocument();
  });

  it("Fetch button is disabled when no sources selected", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const selectNoneBtn = screen.getByRole("button", { name: "選択解除" });
    await user.click(selectNoneBtn);

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    expect(fetchBtn).toBeDisabled();
  });

  it("shows loading state during API call", async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: any) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchPromise as Promise<Response>);

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    expect(screen.getByRole("button", { name: "取得・スコアリング中..." })).toBeInTheDocument();
    expect(screen.getByText("記事を更新中...")).toBeInTheDocument();

    resolveFetch({
      ok: true,
      json: async () => ({ ok: true, results: [{ fetched: 5, saved: 3, errors: [] }] }),
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "取得・スコアリング中..." }),
      ).not.toBeInTheDocument();
    });
  });

  it("displays error on API failure (ok: false)", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    } as Response);

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("ニュース取得に失敗しました")).toBeInTheDocument();
    });
  });

  it("displays network error on fetch rejection", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network Error"));

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("通信エラーが発生しました")).toBeInTheDocument();
    });
  });

  it("displays success results correctly", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ fetched: 5, saved: 3, errors: [] }],
      }),
    } as Response);

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("3件 スコアリング完了")).toBeInTheDocument();
    });

    // Toggle details
    const detailsBtn = screen.getByRole("button", { name: "詳細を表示" });
    await user.click(detailsBtn);

    expect(screen.getByText("5件取得 / 3件スコアリング ✅")).toBeInTheDocument();
  });

  it("displays error results with warning indicator", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ fetched: 5, saved: 2, errors: ["Some error"] }],
      }),
    } as Response);

    render(
      <RefreshProvider>
        <FetchButton />
      </RefreshProvider>,
    );

    const fetchBtn = screen.getByRole("button", { name: "ニュースを取得してスコアリング" });
    await user.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByText("2件 スコアリング完了")).toBeInTheDocument();
    });

    const detailsBtn = screen.getByRole("button", { name: "詳細を表示" });
    await user.click(detailsBtn);

    expect(screen.getByText("5件取得 / 2件スコアリング ⚠")).toBeInTheDocument();
  });
});
