// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import "@testing-library/jest-dom/vitest";

const mockSetTheme = vi.fn();
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: mockSetTheme,
  }),
}));

describe("ThemeToggle", () => {
  it("toggles theme to dark", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "テーマ切り替え" });
    expect(button).toBeInTheDocument();

    await user.click(button);
    const darkItem = await screen.findByText("ダーク");
    await user.click(darkItem);
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("toggles theme to light", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "テーマ切り替え" });

    await user.click(button);
    const lightItem = await screen.findByText("ライト");
    await user.click(lightItem);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("toggles theme to system", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "テーマ切り替え" });

    await user.click(button);
    const systemItem = await screen.findByText("システム");
    await user.click(systemItem);
    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });
});
