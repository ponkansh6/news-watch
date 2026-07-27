// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FeedDashboard from "../../src/app/dashboard/feeds/feed-dashboard";
import { hatenaFeeds } from "@/lib/db/schema";
import "@testing-library/jest-dom/vitest";

type Feed = typeof hatenaFeeds.$inferSelect;

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

const mockFeeds: Feed[] = [
  {
    id: 1,
    domain: "example.com",
    feedUrl: "https://example.com/rss",
    status: "active",
    bookmarkCount: 10,
    errorCount: 0,
    lastFetchedAt: "2026-03-30T00:00:00Z",
    lastError: null,
    discoveredAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    domain: "error.com",
    feedUrl: "https://error.com/rss",
    status: "error",
    bookmarkCount: 5,
    errorCount: 3,
    lastFetchedAt: "2026-03-29T00:00:00Z",
    lastError: "Timeout",
    discoveredAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 3,
    domain: "inactive.com",
    feedUrl: "https://inactive.com/rss",
    status: "inactive",
    bookmarkCount: 0,
    errorCount: 10,
    lastFetchedAt: null,
    lastError: "Too many errors",
    discoveredAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

describe("FeedDashboard", () => {
  it("renders list of feeds with status badges", () => {
    render(<FeedDashboard feeds={mockFeeds} />);

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("error.com")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("inactive.com")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
  });

  it("shows reactivate button only for error or inactive feeds", () => {
    render(<FeedDashboard feeds={mockFeeds} />);

    const buttons = screen.getAllByRole("button", { name: "Reactivate" });
    // error.com and inactive.com should have reactivate buttons; active.com should not.
    expect(buttons).toHaveLength(2);
  });

  it("shows empty state or handles empty feeds gracefully", () => {
    const { container } = render(<FeedDashboard feeds={[]} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(0);
  });

  it("calls reactivate API and refreshes router on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<FeedDashboard feeds={mockFeeds} />);

    const buttons = screen.getAllByRole("button", { name: "Reactivate" });
    fireEvent.click(buttons[0]); // error.com (id: 2)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 2 }),
      });
      expect(mockRefresh).toHaveBeenCalled();
    });

    vi.unstubAllGlobals();
  });
});
