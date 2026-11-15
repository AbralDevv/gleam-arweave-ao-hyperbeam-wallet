import { formatPercent } from "../../format/currency";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DisplayCurrency, HeaderStyle, PortfolioScope } from "@gleam/core";
import { currencyStep, formatCurrencyParts, formatCurrencyValue, HIDDEN_AMOUNT, type CurrencyValueParts } from "../../format/currency";
import { animatedNumberTintStyle, useAnimatedNumber, type AnimatedNumberTrend } from "../../primitives/animated-number";
import { cn } from "../../primitives/cn";
import { NetworkErrorBanner } from "./NetworkErrorBanner";
import { useUiLabels, useUiLocale } from "../../labels";

/**
 * The main screen's total-portfolio-value chart — a hand-rolled SVG
 * line/area chart rather than a charting library, given extension
 * bundle-size sensitivity. No charting library appears anywhere in this
 * workspace's `pnpm-lock.yaml`.
 *
 * Purely presentational: `points` is the already-fetched, already-priced
 * series (`PortfolioHistory.series`, via `@gleam/core`'s barrel), and
 * the caller (`MainScreenView`) owns fetching per range and the
 * loading/error states. Switching `activeRange` is the caller's
 * responsibility too — this component only renders the 5 tabs and
 * reports clicks via `onRangeChange`, so range/chart/%-change/
 * period-label always update together from one fetch.
 *
 * `onRetry` (set by the caller when the active range's fetch failed)
 * swaps just the value/chart area for `NetworkErrorBanner` — the range
 * tabs always render regardless, so a failed range never strands the
 * user without a way to click back to a previously-cached range.
 *
 * Scope toggle: when the caller passes `onToggleScope` (only worth it with
 * more than one wallet), the chart area itself is the switch between the
 * active wallet's total and every wallet's. Nothing marks it at rest
 * beyond a pointer cursor. A click briefly crossfades the %-change to the
 * view now showing, so the note sits beside the figure it describes
 * rather than floating over the chart like a tooltip.
 *
 * Headline: the large figure is the total value unless the caller passes
 * `headline` (a token balance), which demotes the total to a smaller line
 * beside the %-change. `onToggleMasked` makes that figure a button that
 * hides or shows balances; `masked` swaps both figures for dots.
 *
 * `layout="compact"` moves the chart beside the figures as a small sparkline,
 * which leaves more of the popup for the token list. `layout="minimal"` drops
 * the chart and the range tabs, so the %-change names its range beside it.
 * Tapping that range steps to the next one, and the empty space beside the
 * figures takes over the chart's scope toggle. Neither is marked beyond a
 * pointer cursor; they're there for people who go looking.
 *
 * `loading` has nothing to show yet, so the chart shimmers. `refreshing`
 * has a cached figure on screen while it's read again: the figures dim
 * lightly if that takes over a moment, and the total ticks once to the new figure.
 *
 * Color rule: the %-change uses `--color-positive`/`--color-negative`,
 * never `--color-beam-red`/`--color-beam-green` (identity-only). The line
 * and area use `--color-chart-up`/`--color-chart-down`, which light maps to
 * those same two and dark maps to the foreground, so in dark only the
 * figure says which way it went. Referenced as raw CSS custom properties
 * since `isPositive` picks per render and SVG attributes need a color
 * value, not a class name.
 *
 * Dark also smooths the line, fades the area out toward the bottom, marks
 * the period's opening value with a dotted line and the current value
 * with a dot. These are `dark:` classes so light renders as before.
 */
export interface PortfolioChartPoint {
  timestamp: number;
  value: number;
}

export type PortfolioChartRange = "24H" | "7D" | "1M" | "1Y" | "ALL";

const RANGE_TABS: PortfolioChartRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

export interface PortfolioChartProps {
  points: PortfolioChartPoint[];
  currentValue: number;
  currency: DisplayCurrency;
  change: number;
  periodLabel: string;
  activeRange: PortfolioChartRange;
  onRangeChange: (range: PortfolioChartRange) => void;
  loading?: boolean;
  /**
   * The figures show restored data that fresh data hasn't replaced yet. They
   * render faded from the first frame, fade up when this goes false, and the
   * totals tick once at that switch. Keep it true until every input feeding
   * the total is fresh.
   */
  cached?: boolean;
  /** With `cached`: a live read is in flight, so the figures pulse; otherwise they rest at a still fade. */
  cachedFetching?: boolean;
  /** Tells this chart's figures apart across wallets; the range, scope and currency are added here. */
  walletKey?: string;
  /**
   * Set when the active range's fetch failed (thrown query error, or a
   * resolved-but-empty series). Replaces just the value/chart area with
   * `NetworkErrorBanner`; the range tabs below stay rendered regardless.
   */
  onRetry?: () => void;
  /** With `onRetry`: the retry is in flight, so the banner shows it's working. */
  retrying?: boolean;
  scope?: PortfolioScope;
  /** Makes the chart area toggle `scope`. Leave unset when there's only one wallet. */
  onToggleScope?: () => void;
  /**
   * Shown as the large figure in place of the total value, e.g.
   * `{ amount: "12.5", unit: "AR", value: 12.5 }`. `value` lets a change tick
   * over; without it the figure swaps.
   */
  headline?: CurrencyValueParts & { value?: number };
  masked?: boolean;
  onToggleMasked?: () => void;
  layout?: HeaderStyle;
  /** Extra classes for the chart box, e.g. to bleed it past the caller's padding. */
  chartClassName?: string;
  className?: string;
}

const CHART_WIDTH = 100;
const CHART_HEIGHT = 40;
/** Keeps the highest and lowest points off the box's edges, where half the stroke would be clipped flat. */
const CHART_INSET_Y = 3;

/**
 * Fed through the same `buildLinePath` used for real data — a gentle
 * hand-authored wave rather than a flat line, so the shimmer has a line
 * worth traveling along. Only for a zero-balance wallet; never alongside
 * real values.
 */
const EMPTY_STATE_POINTS: PortfolioChartPoint[] = [
  { timestamp: 0, value: 0.3 },
  { timestamp: 1, value: 0.55 },
  { timestamp: 2, value: 0.4 },
  { timestamp: 3, value: 0.7 },
  { timestamp: 4, value: 0.5 },
  { timestamp: 5, value: 0.8 },
  { timestamp: 6, value: 0.65 },
];

const SCOPE_FLASH_MS = 2500;

type ChartCoord = [x: number, y: number];

/** Maps a series into the `0..CHART_WIDTH x 0..CHART_HEIGHT` box, flat-lining a single-point or zero-range series at the vertical midpoint rather than dividing by zero. */
function chartCoords(points: PortfolioChartPoint[]): ChartCoord[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [
      [0, CHART_HEIGHT / 2],
      [CHART_WIDTH, CHART_HEIGHT / 2],
    ];
  }

  const minTimestamp = points[0]!.timestamp;
  const maxTimestamp = points[points.length - 1]!.timestamp;
  const timeRange = maxTimestamp - minTimestamp || 1;

  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;

  return points.map((point) => [
    ((point.timestamp - minTimestamp) / timeRange) * CHART_WIDTH,
    CHART_HEIGHT - CHART_INSET_Y - ((point.value - minValue) / valueRange) * (CHART_HEIGHT - 2 * CHART_INSET_Y),
  ]);
}

/** An SVG polyline's `points` for the series. */
function buildLinePath(points: PortfolioChartPoint[]): string {
  return toPolyline(chartCoords(points));
}

function toPolyline(coords: ChartCoord[]): string {
  return coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

/**
 * A monotone cubic (Fritsch–Carlson) path through the coordinates: smooth,
 * but never overshooting a peak or dip the data doesn't have.
 */
function toSmoothPath(coords: ChartCoord[]): string {
  const n = coords.length;
  if (n === 0) return "";
  const f = (value: number) => value.toFixed(2);
  if (n < 3) return `M${coords.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}`;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = coords[i + 1]![0] - coords[i]![0] || 1;
    slopes.push((coords[i + 1]![1] - coords[i]![1]) / dx);
  }
  const tangents = coords.map((_, i) => {
    if (i === 0) return slopes[0]!;
    if (i === n - 1) return slopes[n - 2]!;
    const before = slopes[i - 1]!;
    const after = slopes[i]!;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  let path = `M${f(coords[0]![0])} ${f(coords[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = coords[i]!;
    const [x1, y1] = coords[i + 1]!;
    const third = (x1 - x0) / 3;
    path += `C${f(x0 + third)} ${f(y0 + tangents[i]! * third)} ${f(x1 - third)} ${f(y1 - tangents[i + 1]! * third)} ${f(x1)} ${f(y1)}`;
  }
  return path;
}

/** Enough to keep the trend's shape without packing several points into each pixel, which reads as a thick, jagged line. */
const SPARKLINE_POINTS = 32;
const CHART_POINTS = 90;

/**
 * Averages a series into `maxPoints` equal buckets, keeping the last
 * point exact so the line still ends on the current value.
 */
function downsample(points: PortfolioChartPoint[], maxPoints: number): PortfolioChartPoint[] {
  if (points.length <= maxPoints) return points;
  const bucketSize = points.length / (maxPoints - 1);
  const result: PortfolioChartPoint[] = [];
  for (let bucket = 0; bucket < maxPoints - 1; bucket++) {
    const slice = points.slice(Math.floor(bucket * bucketSize), Math.floor((bucket + 1) * bucketSize));
    if (slice.length === 0) continue;
    result.push({
      timestamp: slice[0]!.timestamp,
      value: slice.reduce((sum, point) => sum + point.value, 0) / slice.length,
    });
  }
  result.push(points[points.length - 1]!);
  return result;
}

export function PortfolioChart({
  points,
  currentValue,
  currency,
  change,
  periodLabel,
  activeRange,
  onRangeChange,
  loading = false,
  cached = false,
  cachedFetching = false,
  walletKey = "",
  onRetry,
  retrying,
  scope = "wallet",
  onToggleScope,
  headline,
  masked = false,
  onToggleMasked,
  layout = "full",
  chartClassName,
  className,
}: PortfolioChartProps) {
  const compact = layout === "compact";
  const minimal = layout === "minimal";
  const labels = useUiLabels();
  const locale = useUiLocale();
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  // Keeps the scope text through its fade-out instead of blanking first.
  const lastFlashRef = useRef("");
  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

  const toggleScope = () => {
    if (!onToggleScope) return;
    const nextScope: PortfolioScope = scope === "all" ? "wallet" : "all";
    onToggleScope();
    setFlash(nextScope === "all" ? labels.chart.allWallets : labels.chart.thisWallet);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), SCOPE_FLASH_MS);
  };

  if (flash) lastFlashRef.current = flash;
  const isPositive = change >= 0;
  const isEmpty = currentValue === 0 && points.every((point) => point.value === 0);
  // A wallet holding nothing over this range has no change to show, so the % and range tabs give way to the placeholder.
  const showsHistory = loading || !isEmpty;
  const coords = chartCoords(downsample(points, compact ? SPARKLINE_POINTS : CHART_POINTS));
  const linePoints = toPolyline(coords);
  const areaPoints = linePoints ? `0,${CHART_HEIGHT} ${linePoints} ${CHART_WIDTH},${CHART_HEIGHT}` : "";
  const smoothPath = toSmoothPath(coords);
  const smoothArea = smoothPath ? `${smoothPath}L${CHART_WIDTH} ${CHART_HEIGHT}L0 ${CHART_HEIGHT}Z` : "";
  const openY = coords[0]?.[1];
  const lastCoord = coords[coords.length - 1];
  const fillId = `portfolio-chart-fill-${useId()}`;
  const changeColorVar = isPositive ? "var(--color-positive)" : "var(--color-negative)";
  const lineColorVar = isPositive ? "var(--color-chart-up)" : "var(--color-chart-down)";
  const totalText = masked ? HIDDEN_AMOUNT : formatCurrencyValue(currentValue, currency, locale);
  // Both run on every render so hook order holds; masked figures never show a frame.
  const totalParts = formatCurrencyParts(currentValue, currency, locale);
  // While loading, `currentValue` is a stand-in, so the first real figure swaps in rather than ticking up from it.
  const figureIdentity = `${walletKey}|${activeRange}|${scope}|${currency}`;
  const total = useAnimatedNumber({
    value: loading ? Number.NaN : currentValue,
    text: totalParts.amount,
    format: (value) => formatCurrencyParts(value, currency, locale).amount,
    step: currencyStep(currentValue, currency, locale),
    identity: figureIdentity,
    cached,
  });
  const headlineFigure = useAnimatedNumber({
    value: headline?.value ?? Number.NaN,
    text: headline?.amount ?? "",
    identity: `${figureIdentity}|${headline?.unit ?? ""}`,
    cached,
  });
  const faded = cached && !loading;
  const totalLabel = masked ? HIDDEN_AMOUNT : totalParts.unit ? `${total.text} ${totalParts.unit}` : total.text;
  const headlineParts: CurrencyValueParts = masked
    ? { amount: HIDDEN_AMOUNT }
    : headline
      ? { amount: headlineFigure.text, unit: headline.unit }
      : { amount: total.text, unit: totalParts.unit };
  const headlineTrend = masked ? null : headline ? headlineFigure.trend : total.trend;
  // The range tabs already name the period, so the scope note briefly takes the %-change's place instead.
  // The note is out of flow: sized into the badge, it would keep the badge as wide as itself after fading.
  const changeBadge = (
    <span className="relative text-label font-semibold tabular-nums">
      <span
        aria-hidden={flash ? true : undefined}
        className={cn("transition-opacity duration-300", flash && "opacity-0")}
        style={{ color: changeColorVar }}
      >
        {formatPercent(change, locale)}
      </span>
      <span
        aria-live="polite"
        className={cn("pointer-events-none absolute left-0 top-0 whitespace-nowrap text-muted transition-opacity duration-300", !flash && "opacity-0")}
      >
        {flash ?? lastFlashRef.current}
      </span>
    </span>
  );

  const nextRange = RANGE_TABS[(RANGE_TABS.indexOf(activeRange) + 1) % RANGE_TABS.length]!;
  const changeNote = minimal ? (
    <>
      {changeBadge}
      <button
        type="button"
        onClick={() => onRangeChange(nextRange)}
        className={cn(
          "-mx-1 cursor-pointer rounded-md px-1 text-label tabular-nums text-muted transition-opacity duration-300 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground phone:hit-target",
          flash && "opacity-0",
        )}
      >
        {activeRange}
      </button>
    </>
  ) : (
    changeBadge
  );

  const figures = (
    <div className={cn("flex min-w-0 flex-col gap-0.5 transition-opacity duration-500 ease-out", loading && "opacity-50", faded && (cachedFetching ? "gleam-cached-pulse" : "opacity-70"))}>
      <div className="flex items-baseline gap-2.5">
        <Headline parts={headlineParts} trend={headlineTrend} masked={masked} onToggle={onToggleMasked} />
        {headline === undefined && showsHistory ? changeNote : null}
      </div>
      {headline !== undefined ? (
        <div className="flex items-baseline gap-2.5">
          <span className="text-label tabular-nums text-muted" style={animatedNumberTintStyle(masked ? null : total.trend)}>
            {totalLabel}
          </span>
          {showsHistory ? changeNote : null}
        </div>
      ) : null}
    </div>
  );

  const chart = (
    <ChartArea onToggle={onToggleScope ? toggleScope : undefined} scope={scope} compact={compact} className={chartClassName} actionLabel={scope === "all" ? labels.chart.showThisWallet : labels.chart.showAllWallets}>
      {loading ? (
        // Faded: a chart is mostly white, so a full-strength block is heavier than what replaces it.
        <div className="h-full w-full gleam-shimmer rounded-md opacity-60" />
      ) : points.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-caption text-faint">
          {labels.chart.noChartData}
        </div>
      ) : isEmpty ? (
        <EmptyLine />
      ) : (
        // The dot is positioned against this box, so padding on the chart area insets both together.
        <div className="relative h-full w-full">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          role="img"
          aria-label={labels.chart.summary(totalText, formatPercent(change, locale), periodLabel)}
        >
          {compact ? null : (
            <>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={lineColorVar} style={{ stopOpacity: "var(--chart-fill-top)" }} />
                  <stop offset="0.75" stopColor={lineColorVar} style={{ stopOpacity: "var(--chart-fill-end)" }} />
                </linearGradient>
              </defs>
              <polygon className="dark:hidden" points={areaPoints} fill={`url(#${fillId})`} stroke="none" />
              <path className="hidden dark:inline" d={smoothArea} fill={`url(#${fillId})`} stroke="none" />
              {openY === undefined ? null : (
                <line
                  className="hidden text-faint dark:inline"
                  x1={0}
                  x2={CHART_WIDTH}
                  y1={openY}
                  y2={openY}
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </>
          )}
          <polyline
            className="dark:hidden"
            points={linePoints}
            fill="none"
            stroke={lineColorVar}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="hidden dark:inline"
            d={smoothPath}
            fill="none"
            stroke={lineColorVar}
            strokeOpacity={0.85}
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      {/* An HTML dot, since the SVG stretches and would draw a circle as an ellipse. */}
      {!compact && lastCoord ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute hidden h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_0_5px_color-mix(in_srgb,var(--color-foreground)_18%,transparent)] dark:block"
          style={{ left: `${(lastCoord[0] / CHART_WIDTH) * 100}%`, top: `${(lastCoord[1] / CHART_HEIGHT) * 100}%` }}
        />
      ) : null}
        </div>
      )}
    </ChartArea>
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {onRetry ? (
        <NetworkErrorBanner onRetry={onRetry} retrying={retrying} className="phone:mx-0 phone:mt-0" />
      ) : minimal ? (
        <div className="flex items-stretch gap-4">
          <div className="min-w-0">{figures}</div>
          {onToggleScope ? (
            <button
              type="button"
              onClick={toggleScope}
              aria-pressed={scope === "all"}
              aria-label={scope === "all" ? labels.chart.showThisWallet : labels.chart.showAllWallets}
              className="min-w-0 flex-1 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            />
          ) : null}
        </div>
      ) : compact ? (
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">{figures}</div>
          {chart}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {figures}
            {chart}
          </div>
          {isEmpty && <div className="text-center text-caption text-faint">{labels.chart.valueWillAppear}</div>}
        </>
      )}

      {minimal || !showsHistory ? null : (
        <div role="tablist" aria-label={labels.chart.rangeTabs} className="flex items-center gap-1 phone:-mx-2.5">
          {RANGE_TABS.map((range) => (
            <button
              key={range}
              type="button"
              role="tab"
              aria-selected={range === activeRange}
              onClick={() => onRangeChange(range)}
              className={cn(
                "rounded-md px-2.5 py-1 text-caption font-semibold phone:hit-target",
                range === activeRange
                  ? "bg-mist text-foreground"
                  : "text-muted hover:text-foreground dark:text-faint",
              )}
            >
              {range}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const HEADLINE_CLASS = "text-display font-semibold tracking-[-0.02em] tabular-nums text-foreground";

/** The large figure; a button that hides or shows balances when `onToggle` is set. */
function Headline({ parts, trend, masked, onToggle }: { parts: CurrencyValueParts; trend: AnimatedNumberTrend | null; masked: boolean; onToggle?: () => void }) {
  const labels = useUiLabels();
  const toggleLabel = masked ? labels.chart.showBalances : labels.chart.hideBalances;
  const label = (
    <>
      <span style={animatedNumberTintStyle(trend)}>{parts.amount}</span>
      {parts.unit ? (
        <>
          {" "}
          <span className="text-h3 tracking-normal">{parts.unit}</span>
        </>
      ) : null}
    </>
  );
  if (!onToggle) return <span className={HEADLINE_CLASS}>{label}</span>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={masked}
      aria-label={toggleLabel}
      title={toggleLabel}
      className={cn(HEADLINE_CLASS, "-mx-1 cursor-pointer rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-foreground")}
    >
      {label}
    </button>
  );
}

const EMPTY_LINE = buildLinePath(EMPTY_STATE_POINTS);

/** The empty chart: a faint beam-tinted wave with a light traveling along it. */
function EmptyLine() {
  const labels = useUiLabels();
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label={labels.chart.noHistory}
    >
      <defs>
        <linearGradient id="portfolio-chart-empty-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={CHART_WIDTH} y2="0">
          <stop offset="0%" stopColor="var(--color-beam-purple)" />
          <stop offset="35%" stopColor="var(--color-beam-sky)" />
          <stop offset="70%" stopColor="var(--color-beam-yellow)" />
          <stop offset="100%" stopColor="var(--color-beam-green)" />
        </linearGradient>
      </defs>
      <polyline
        points={EMPTY_LINE}
        fill="none"
        stroke="url(#portfolio-chart-empty-gradient)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.13}
      />
      <polyline
        className="gleam-chart-empty-shimmer"
        points={EMPTY_LINE}
        fill="none"
        stroke="url(#portfolio-chart-empty-gradient)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={100}
      />
    </svg>
  );
}

interface ChartAreaProps {
  onToggle?: () => void;
  scope: PortfolioScope;
  compact: boolean;
  actionLabel: string;
  className?: string;
  children: ReactNode;
}

/** The chart slot, full width or a sparkline beside the figures: a plain box, or a button over it when the scope toggle is enabled. */
function ChartArea({ onToggle, scope, compact, actionLabel, className, children }: ChartAreaProps) {
  const size = cn(compact ? "h-8 w-32 flex-shrink-0" : cn("h-16 w-full phone:[@media(max-height:700px)]:h-12", className));
  if (!onToggle) return <div className={size}>{children}</div>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={scope === "all"}
      aria-label={actionLabel}
      className={cn(
        size,
        "block cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
      )}
    >
      {children}
    </button>
  );
}
