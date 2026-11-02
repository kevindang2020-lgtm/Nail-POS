// forecast-core.ts — the pure numerical forecasting engine for ai_analytics_forecasting. NO DB, NO LLM, NO fabricated
// data: every function operates on a real historical series the caller supplies from authoritative sources (ReportsService
// trends, ai_inventory, appointments). Forecasts are produced by VALIDATED statistical methods (moving average,
// seasonal-naive, Holt linear trend) and every accuracy claim comes from rolling-origin BACKTESTING — never asserted.
// Forecasts carry prediction intervals and a confidence state so nothing is presented as a guaranteed outcome.

export interface SeriesPoint { date: string; value: number }

export type ForecastMethod = 'moving_average' | 'seasonal_naive' | 'holt_linear';
export type Confidence = 'high' | 'moderate' | 'low' | 'insufficient_data';
export type DataQuality = 'healthy' | 'limited_history' | 'partial_data' | 'insufficient_data';

export interface HorizonPoint { step: number; point: number; lower: number; upper: number }

export interface ForecastOutput {
  method: ForecastMethod;
  horizon: HorizonPoint[];
  confidence: Confidence;
  dataQuality: DataQuality;
  historyLength: number;
  intervalLevel: number; // e.g. 0.8 → 80% prediction interval
}

// ---- helpers ----
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
// z-scores for common two-sided prediction intervals.
const Z: Record<string, number> = { '0.8': 1.2816, '0.9': 1.6449, '0.95': 1.96 };
const zFor = (level: number) => Z[String(level)] ?? 1.2816;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Non-negative clamp — demand/revenue/appointment counts can't be negative. */
const nn = (n: number) => (n < 0 ? 0 : n);

// ---- point-forecast methods (return h raw point forecasts, no intervals) ----

/** Moving average of the last `window` observations, flat-extrapolated over the horizon. */
export function movingAveragePoints(values: number[], horizon: number, window = 7): number[] {
  const w = Math.min(window, values.length);
  const avg = w > 0 ? mean(values.slice(-w)) : 0;
  return Array.from({ length: horizon }, () => avg);
}

/** Seasonal-naive: repeat the value from one season ago (default weekly period 7). */
export function seasonalNaivePoints(values: number[], horizon: number, period = 7): number[] {
  if (values.length < period) return movingAveragePoints(values, horizon, values.length || 1);
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const idx = values.length - period + ((h - 1) % period);
    out.push(values[idx] ?? values[values.length - 1]);
  }
  return out;
}

/** Holt's linear trend (double exponential smoothing). Captures level + trend for short horizons. */
export function holtLinearPoints(values: number[], horizon: number, alpha = 0.4, beta = 0.2): number[] {
  if (values.length < 2) return movingAveragePoints(values, horizon, values.length || 1);
  let level = values[0];
  let trend = values[1] - values[0];
  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return Array.from({ length: horizon }, (_, i) => level + (i + 1) * trend);
}

export function pointsFor(method: ForecastMethod, values: number[], horizon: number, opts: { window?: number; period?: number } = {}): number[] {
  switch (method) {
    case 'seasonal_naive': return seasonalNaivePoints(values, horizon, opts.period ?? 7);
    case 'holt_linear': return holtLinearPoints(values, horizon);
    default: return movingAveragePoints(values, horizon, opts.window ?? 7);
  }
}

// ---- in-sample residual sigma (for interval widths) ----
/** One-step-ahead in-sample residual standard deviation for a method. */
export function residualSigma(method: ForecastMethod, values: number[], opts: { window?: number; period?: number } = {}): number {
  const residuals: number[] = [];
  const start = method === 'seasonal_naive' ? (opts.period ?? 7) : 2;
  for (let i = start; i < values.length; i++) {
    const pred = pointsFor(method, values.slice(0, i), 1, opts)[0];
    residuals.push(values[i] - pred);
  }
  return stddev(residuals);
}

// ---- data quality + confidence ----
export function classifyDataQuality(series: SeriesPoint[]): DataQuality {
  const n = series.length;
  if (n < 7) return 'insufficient_data';
  const zeros = series.filter((p) => p.value === 0).length;
  if (n < 21) return 'limited_history';
  if (zeros / n > 0.4) return 'partial_data';
  return 'healthy';
}

/** Confidence never overclaims: it degrades with short history, long horizon, poor backtest accuracy, and bad data. */
export function classifyConfidence(historyLength: number, horizon: number, wape: number | null, dq: DataQuality): Confidence {
  if (dq === 'insufficient_data' || historyLength < 7) return 'insufficient_data';
  if (wape == null) return 'low';
  const longHorizon = horizon > 30;
  if (dq === 'healthy' && wape <= 0.15 && historyLength >= 56 && !longHorizon) return 'high';
  if (wape <= 0.30 && historyLength >= 21) return longHorizon ? 'low' : 'moderate';
  return 'low';
}

// ---- full forecast with intervals ----
export function forecast(series: SeriesPoint[], method: ForecastMethod, horizon: number, opts: { window?: number; period?: number; intervalLevel?: number; wape?: number | null } = {}): ForecastOutput {
  const values = series.map((p) => p.value);
  const level = opts.intervalLevel ?? 0.8;
  const z = zFor(level);
  const sigma = residualSigma(method, values, opts);
  const pts = pointsFor(method, values, horizon, opts);
  const dq = classifyDataQuality(series);

  const horizonPts: HorizonPoint[] = pts.map((p, i) => {
    const spread = z * sigma * Math.sqrt(i + 1); // interval widens with horizon step
    return { step: i + 1, point: round2(nn(p)), lower: round2(nn(p - spread)), upper: round2(nn(p + spread)) };
  });

  return {
    method, horizon: horizonPts,
    confidence: classifyConfidence(series.length, horizon, opts.wape ?? null, dq),
    dataQuality: dq, historyLength: series.length, intervalLevel: level,
  };
}

// ---- backtesting (rolling origin) ----
export interface BacktestMetrics { mae: number; wape: number; bias: number; coverage: number; folds: number }

/** Rolling-origin backtest: for each fold, fit on a prefix and score the next `step` actuals. Returns MAE/WAPE/bias and
 *  prediction-interval coverage. This is the ONLY source of accuracy claims — no accuracy is asserted without it. */
export function backtest(series: SeriesPoint[], method: ForecastMethod, opts: { minTrain?: number; step?: number; intervalLevel?: number; window?: number; period?: number } = {}): BacktestMetrics | null {
  const values = series.map((p) => p.value);
  const minTrain = opts.minTrain ?? 14;
  const step = opts.step ?? 1;
  const level = opts.intervalLevel ?? 0.8;
  const z = zFor(level);
  if (values.length < minTrain + step) return null;

  let absErr = 0, absActual = 0, signedErr = 0, covered = 0, count = 0;
  for (let origin = minTrain; origin + step <= values.length; origin += step) {
    const train = values.slice(0, origin);
    const preds = pointsFor(method, train, step, opts);
    const sigma = residualSigma(method, train, opts);
    for (let k = 0; k < step; k++) {
      const actual = values[origin + k];
      const pred = nn(preds[k]);
      const err = actual - pred;
      absErr += Math.abs(err);
      absActual += Math.abs(actual);
      signedErr += err;
      const spread = z * sigma * Math.sqrt(k + 1);
      if (actual >= pred - spread && actual <= pred + spread) covered++;
      count++;
    }
  }
  if (count === 0) return null;
  return {
    mae: round2(absErr / count),
    wape: absActual > 0 ? round2(absErr / absActual) : 0,
    bias: round2(signedErr / count),
    coverage: round2(covered / count),
    folds: count,
  };
}

// ---- model selection ----
export interface ModelSelection {
  selected: ForecastMethod;
  reason: string;
  candidates: { method: ForecastMethod; metrics: BacktestMetrics | null }[];
}

/** Compare candidate methods by backtest WAPE and pick the best; ties/failures fall back to moving average (robust). */
export function selectModel(series: SeriesPoint[], opts: { minTrain?: number; step?: number; period?: number; window?: number } = {}): ModelSelection {
  const candidateMethods: ForecastMethod[] = series.length >= (opts.period ?? 7) * 2
    ? ['moving_average', 'seasonal_naive', 'holt_linear']
    : ['moving_average', 'holt_linear'];
  const candidates = candidateMethods.map((method) => ({ method, metrics: backtest(series, method, opts) }));
  const scored = candidates.filter((c) => c.metrics != null) as { method: ForecastMethod; metrics: BacktestMetrics }[];
  if (scored.length === 0) {
    return { selected: 'moving_average', reason: 'Not enough history to backtest — using a robust moving-average fallback.', candidates };
  }
  scored.sort((a, b) => a.metrics.wape - b.metrics.wape);
  const best = scored[0];
  return {
    selected: best.method,
    reason: `Selected ${best.method} — lowest backtest WAPE (${(best.metrics.wape * 100).toFixed(1)}%) across ${best.metrics.folds} folds.`,
    candidates,
  };
}
