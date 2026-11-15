import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimePort, TokenPriceHistory } from "@gleam/core";
import { hasPriceHistory, TokenPriceChart } from "./TokenPriceChart";

const AO = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const DAY = 24 * 60 * 60 * 1000;

afterEach(cleanup);

function renderChart(send: RuntimePort["send"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const runtime: RuntimePort = { send, onMessage: vi.fn(() => () => {}) };
  return render(
    <QueryClientProvider client={queryClient}>
      <TokenPriceChart runtime={runtime} processId={AO} currency="USD" />
    </QueryClientProvider>,
  );
}

function historySend(series: TokenPriceHistory["series"]) {
  return vi.fn(async ({ payload }: { payload: { range: TokenPriceHistory["range"] } }) => ({ range: payload.range, series })) as unknown as RuntimePort["send"];
}

describe("TokenPriceChart", () => {
  it("shows the latest price and the move over the range", async () => {
    renderChart(historySend([{ timestamp: Date.UTC(2026, 10, 8), value: 2 }, { timestamp: Date.UTC(2026, 10, 15), value: 2.5 }]));

    expect(await screen.findByText("$2.50")).toBeTruthy();
    expect(screen.getByText("+25.00%")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "7D" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows the price and date of the point under the keyboard cursor", async () => {
    renderChart(historySend([{ timestamp: Date.UTC(2026, 10, 8, 12), value: 2 }, { timestamp: Date.UTC(2026, 10, 15, 12), value: 2.5 }]));

    const chart = await screen.findByRole("img", { name: "Price chart" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });

    expect(screen.getByText("$2.00")).toBeTruthy();
    expect(screen.getByText(/Nov 8/)).toBeTruthy();
    expect(screen.queryByText("+25.00%")).toBeNull();
  });

  it("asks for the range a tab names", async () => {
    const send = historySend([{ timestamp: 0, value: 1 }, { timestamp: DAY, value: 1 }]);
    renderChart(send);
    fireEvent.click(await screen.findByRole("tab", { name: "1Y" }));

    expect(send).toHaveBeenLastCalledWith({ type: "getTokenPriceHistory", payload: { processId: AO, range: "1Y", currency: "USD" } });
  });

  it("renders nothing when there is no series to draw", async () => {
    const send = historySend([]);
    const { container } = renderChart(send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("charts only tokens with a price listing", () => {
    expect(hasPriceHistory(null)).toBe(true);
    expect(hasPriceHistory(AO)).toBe(true);
    expect(hasPriceHistory("L".repeat(43))).toBe(false);
  });
});
