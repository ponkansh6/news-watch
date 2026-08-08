// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppNav } from "@/components/layout/app-nav";
import "@testing-library/jest-dom/vitest";

// Mock usePathname
import { vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("AppNav", () => {
  it("marks current page with aria-current", () => {
    render(<AppNav />);
    const homeLink = screen.getByRole("link", { name: "ニュース" });
    expect(homeLink).toHaveAttribute("aria-current", "page");

    const bookmarkLink = screen.getByRole("link", { name: "ブックマーク" });
    expect(bookmarkLink).not.toHaveAttribute("aria-current");
  });
});
