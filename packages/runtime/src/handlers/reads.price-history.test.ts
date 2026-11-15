import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ReadsHandler } from "./reads";

const AO = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const originalFetch = globalThis.fetch;

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

/** AR went $10 → $20 (spot $22); AO went $4 → $5 (spot $6); EUR is 0.5 per dollar. */
function pricedFetch({ fxRate = 0.5 as number | null, arHistory = true } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("/prices/fx")) return { ok: true, status: 200, json: async () => ({ rate: fxRate }) };
    if (url.includes("/prices/history?id=arweave")) {
      const series = arHistory ? [{ timestamp: 1000, usd: 10 }, { timestamp: 2000, usd: 20 }] : [];
      return { ok: true, status: 200, json: async () => ({ series }) };
    }
    if (url.includes("/prices/history?id=ao-computer")) {
      return { ok: true, status: 200, json: async () => ({ series: [{ timestamp: 1000, usd: 4 }, { timestamp: 2000, usd: 5 }] }) };
    }
    if (url.includes("/prices?ids=arweave")) return { ok: true, status: 200, json: async () => ({ prices: { arweave: 22 } }) };
    if (url.includes("/prices?ids=ao-computer")) return { ok: true, status: 200, json: async () => ({ prices: { "ao-computer": 6 } }) };
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ReadsHandler: getTokenPriceHistory", () => {
  it("prices AR in a fiat currency and ends on the spot price", async () => {
    globalThis.fetch = pricedFetch();
    const history = await new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: null, range: "7D", currency: "EUR" });

    expect(history).toEqual({
      range: "7D",
      series: [
        { timestamp: 1000, value: 5 },
        { timestamp: 2000, value: 11 },
      ],
    });
  });

  it("prices AO against AR at each point", async () => {
    globalThis.fetch = pricedFetch();
    const history = await new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: AO, range: "1M", currency: "AR" });

    expect(history.series[0]).toEqual({ timestamp: 1000, value: 0.4 });
    expect(history.series[1]!.value).toBeCloseTo(6 / 22);
  });

  it("has nothing to chart for a token in its own unit", async () => {
    globalThis.fetch = pricedFetch();
    const history = await new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: AO, range: "7D", currency: "AO" });

    expect(history.series).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("has nothing to chart for a token without a price listing", async () => {
    globalThis.fetch = pricedFetch();
    const history = await new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: "L".repeat(43), range: "7D", currency: "USD" });

    expect(history.series).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("has nothing to chart when the history or the exchange rate is unavailable", async () => {
    globalThis.fetch = pricedFetch({ arHistory: false });
    expect((await new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: null, range: "7D", currency: "USD" })).series).toEqual([]);

    globalThis.fetch = pricedFetch({ fxRate: null });
    expect((await new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: null, range: "7D", currency: "GBP" })).series).toEqual([]);
  });

  it("refuses a range outside the tabs", async () => {
    globalThis.fetch = pricedFetch();
    await expect(
      new ReadsHandler(createFakeStorage()).getTokenPriceHistory({ processId: null, range: "5Y" as "7D", currency: "USD" }),
    ).rejects.toThrow(/Unrecognized price history range/);
  });
});
