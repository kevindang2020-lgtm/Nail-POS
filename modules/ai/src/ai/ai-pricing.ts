// ai-pricing.ts — turns logged token counts into a cost figure so you can see COGS per AI package. Costs are computed in
// micro-USD (millionths of a dollar) and stored as integers, because a single call costs a fraction of a cent and would
// round to 0 in integer cents. Prices are USD per 1,000,000 tokens and are APPROXIMATE — edit AI_MODEL_PRICES to match
// your providers' current rates.
export interface ModelPrice { inPerM: number; outPerM: number }

// USD per 1M tokens. Keys match the model strings the adapters use (and a few common alternates). EDIT to your rates.
export const AI_MODEL_PRICES: Record<string, ModelPrice> = {
  'mock-1': { inPerM: 0, outPerM: 0 },
  'gpt-4o-mini': { inPerM: 0.15, outPerM: 0.60 },
  'gpt-4o': { inPerM: 2.50, outPerM: 10.00 },
  'claude-3-5-haiku-latest': { inPerM: 0.80, outPerM: 4.00 },
  'claude-3-5-sonnet-latest': { inPerM: 3.00, outPerM: 15.00 },
  'gemini-1.5-flash': { inPerM: 0.075, outPerM: 0.30 },
  'gemini-1.5-pro': { inPerM: 1.25, outPerM: 5.00 },
  // Whisper is billed PER MINUTE OF AUDIO ($0.006/min), not per token. §93 says usage units differ by
  // capability; until the usage ledger carries an audio-seconds unit, the transcription adapter reports
  // 1 "token" per audio second and this row prices it so that 60 s ≈ $0.006. Found by the model-registry
  // invariant "every model has a price row" — before it, Whisper would have been billed at the placeholder.
  'whisper-1': { inPerM: 100.0, outPerM: 0 },
};

// Used when a model isn't in the table — a deliberately conservative placeholder so unknown models don't read as free.
export const DEFAULT_MODEL_PRICE: ModelPrice = { inPerM: 1.0, outPerM: 3.0 };

export function priceForModel(model: string | null | undefined): ModelPrice {
  if (!model) return DEFAULT_MODEL_PRICE;
  return AI_MODEL_PRICES[model] ?? DEFAULT_MODEL_PRICE;
}

/** Cost of one call in integer micro-USD (1e-6 USD). inTok/outTok are token counts. */
export function computeAiCostMicroUsd(model: string | null | undefined, inTok: number, outTok: number): number {
  const p = priceForModel(model);
  const micro = (Math.max(0, inTok) * p.inPerM) + (Math.max(0, outTok) * p.outPerM); // USD/1M * tokens = micro-USD
  return Math.round(micro);
}

/** micro-USD → a human dollar string (4 dp, enough for sub-cent per-call costs). */
export function formatMicroUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Constitution 10 §96 / §218 — VERSIONED pricing.
//
// The table above is a flat "what does this cost today" map with no effective date. That is exactly what §218
// forbids: when a provider changes its rates, every historical usage row silently re-values, because cost is
// recomputed from whatever the map says now. A month-over-month comparison spanning a price change is wrong and
// nothing says so.
//
// AI_MODEL_PRICES stays as the CURRENT-price fast path (it is read on every call and by the control plane), and
// it is derived from the current version below rather than maintained separately — one source, two shapes. The
// versioned rows are what a historical query and an invoice must use.
// ---------------------------------------------------------------------------------------------------------------

/** §96: provider, model, unit, rates, effective date. */
export interface PriceVersion {
  id: string;
  provider: string;
  model: string;
  /** §93/§96: not every capability bills per token. Naming the unit ends Whisper's token-shaped fudge. */
  unit: 'tokens' | 'audio_seconds' | 'images' | 'characters';
  inPerM: number;
  outPerM: number;
  effectiveFrom: string;   // YYYY-MM-DD
  effectiveTo: string | null;
  sourceNote?: string;
}

/**
 * The seed history. `id` values are stable so a usage row can reference one before any database write, and a
 * fresh database prices correctly before a Super Admin touches anything.
 */
export const PRICE_VERSIONS: readonly PriceVersion[] = Object.freeze([
  { id: 'pv-openai-gpt4omini-2024-07', provider: 'openai', model: 'gpt-4o-mini', unit: 'tokens', inPerM: 0.15, outPerM: 0.60, effectiveFrom: '2024-07-18', effectiveTo: null },
  { id: 'pv-openai-gpt4o-2024-08', provider: 'openai', model: 'gpt-4o', unit: 'tokens', inPerM: 2.50, outPerM: 10.00, effectiveFrom: '2024-08-06', effectiveTo: null },
  // Whisper bills per MINUTE of audio. Expressed in its own unit at last: $0.006/min = $6.00 per 1M audio-seconds
  // /60 … stated directly as per-1M audio-seconds so no caller has to know the fudge.
  { id: 'pv-openai-whisper-2023-03', provider: 'openai', model: 'whisper-1', unit: 'audio_seconds', inPerM: 100.0, outPerM: 0, effectiveFrom: '2023-03-01', effectiveTo: null, sourceNote: '$0.006 per minute = $100 per 1M audio-seconds' },
  { id: 'pv-anthropic-haiku35-2024-11', provider: 'anthropic', model: 'claude-3-5-haiku-latest', unit: 'tokens', inPerM: 0.80, outPerM: 4.00, effectiveFrom: '2024-11-04', effectiveTo: null },
  { id: 'pv-anthropic-sonnet35-2024-10', provider: 'anthropic', model: 'claude-3-5-sonnet-latest', unit: 'tokens', inPerM: 3.00, outPerM: 15.00, effectiveFrom: '2024-10-22', effectiveTo: null },
  { id: 'pv-gemini-flash15-2024-10', provider: 'gemini', model: 'gemini-1.5-flash', unit: 'tokens', inPerM: 0.075, outPerM: 0.30, effectiveFrom: '2024-10-01', effectiveTo: null },
  { id: 'pv-gemini-pro15-2024-10', provider: 'gemini', model: 'gemini-1.5-pro', unit: 'tokens', inPerM: 1.25, outPerM: 5.00, effectiveFrom: '2024-10-01', effectiveTo: null },
  { id: 'pv-mock-1', provider: 'mock', model: 'mock-1', unit: 'tokens', inPerM: 0, outPerM: 0, effectiveFrom: '2020-01-01', effectiveTo: null },
]);

export class NoPriceVersionError extends Error {
  readonly status = 500;
  constructor(readonly model: string, readonly at: string) {
    super(`No price version for "${model}" effective ${at} — refusing to invent a rate (§218)`);
    this.name = 'NoPriceVersionError';
  }
}

/**
 * §218: the rate that was in force on a given date. Returns null rather than guessing when a model has no
 * version covering that date — a usage row priced by a guessed rate is worse than one that admits it cannot be
 * priced, because the guess is indistinguishable from a real figure afterwards.
 */
export function priceVersionAt(model: string, at: string | Date, versions: readonly PriceVersion[] = PRICE_VERSIONS): PriceVersion | null {
  const day = typeof at === 'string' ? at.slice(0, 10) : at.toISOString().slice(0, 10);
  const candidates = versions.filter((v) => v.model === model && v.effectiveFrom <= day && (v.effectiveTo === null || v.effectiveTo > day));
  if (!candidates.length) return null;
  // Most recent effective_from wins, so a correction issued later supersedes an earlier row for the same window.
  return candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
}

/** Cost using the rate in force at `at`, with the version that priced it — for the usage row to record (§218). */
export function costAt(model: string, inUnits: number, outUnits: number, at: string | Date, versions: readonly PriceVersion[] = PRICE_VERSIONS): { costMicroUsd: number; priceVersionId: string; unit: PriceVersion['unit'] } {
  const v = priceVersionAt(model, at, versions);
  if (!v) throw new NoPriceVersionError(model, typeof at === 'string' ? at : at.toISOString());
  const micro = Math.max(0, inUnits) * v.inPerM + Math.max(0, outUnits) * v.outPerM;
  return { costMicroUsd: Math.round(micro), priceVersionId: v.id, unit: v.unit };
}

/** Supersede a rate without editing history (§218): close the current row, open a new one. */
export function supersede(current: readonly PriceVersion[], next: Omit<PriceVersion, 'effectiveTo'>): PriceVersion[] {
  const out = current.map((v) => (v.model === next.model && v.effectiveTo === null ? { ...v, effectiveTo: next.effectiveFrom } : v));
  if (out.some((v) => v.id === next.id)) throw new Error(`price version id "${next.id}" already exists — ids are stable and never reused`);
  return [...out, { ...next, effectiveTo: null }];
}
