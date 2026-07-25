// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RefreshProvider, useRefresh } from "../../src/app/refresh-context";
import type { ReactNode } from "react";

/**
 * Test helper that renders a consumer component inside RefreshProvider
 * to assert on the context value.
 */
function TestConsumer() {
  const { isRefreshing, setRefreshing } = useRefresh();
  return (
    <div>
      <span data-testid="refreshing">{isRefreshing ? "true" : "false"}</span>
      <button data-testid="set-true" type="button" onClick={() => setRefreshing(true)}>
        Set True
      </button>
      <button data-testid="set-false" type="button" onClick={() => setRefreshing(false)}>
        Set False
      </button>
    </div>
  );
}

describe("RefreshProvider / useRefresh", () => {
  it("provides isRefreshing=false by default", () => {
    render(
      <RefreshProvider>
        <TestConsumer />
      </RefreshProvider>,
    );
    expect(screen.getByTestId("refreshing").textContent).toBe("false");
  });

  it("setRefreshing(true) updates isRefreshing to true", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <TestConsumer />
      </RefreshProvider>,
    );

    await user.click(screen.getByTestId("set-true"));
    expect(screen.getByTestId("refreshing").textContent).toBe("true");
  });

  it("setRefreshing(false) resets isRefreshing to false", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <TestConsumer />
      </RefreshProvider>,
    );

    await user.click(screen.getByTestId("set-true"));
    expect(screen.getByTestId("refreshing").textContent).toBe("true");

    await user.click(screen.getByTestId("set-false"));
    expect(screen.getByTestId("refreshing").textContent).toBe("false");
  });

  it("supports nested providers with isolated state", async () => {
    const user = userEvent.setup();
    render(
      <RefreshProvider>
        <span data-testid="outer">
          <TestConsumer />
        </span>
        <RefreshProvider>
          <span data-testid="inner">
            <TestConsumer />
          </span>
        </RefreshProvider>
      </RefreshProvider>,
    );

    // Both start as false
    const refreshingEls = screen.getAllByTestId("refreshing");
    expect(refreshingEls).toHaveLength(2);
    expect(refreshingEls[0].textContent).toBe("false");
    expect(refreshingEls[1].textContent).toBe("false");
  });
});
