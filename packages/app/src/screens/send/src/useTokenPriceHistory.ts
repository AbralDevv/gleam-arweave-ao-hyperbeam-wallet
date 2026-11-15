import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DisplayCurrency, PortfolioHistoryRange, RuntimePort, TokenPriceHistory } from "@gleam/core";

/** Same as the portfolio chart's: a range already loaded this session shows instantly. */
const STALE_TIME_MS = 5 * 60 * 1000;

export function useTokenPriceHistory(
  runtime: RuntimePort,
  processId: string | null,
  range: PortfolioHistoryRange,
  currency: DisplayCurrency | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled: enabled && currency !== undefined,
    queryKey: ["tokenPriceHistory", processId, range, currency] as const,
    queryFn: () =>
      runtime.send<{ processId: string | null; range: PortfolioHistoryRange; currency: DisplayCurrency }, TokenPriceHistory>({
        type: "getTokenPriceHistory",
        payload: { processId, range, currency: currency as DisplayCurrency },
      }),
    staleTime: STALE_TIME_MS,
    // The previous range's line stays up while the next one loads, so the chart doesn't collapse between tabs.
    placeholderData: keepPreviousData,
    retry: 1,
    retryDelay: 0,
  });
}
