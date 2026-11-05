// ai-pricing-versions.vitest.spec — Constitution 10 §96 / §218.
import { describe, it, expect } from 'vitest';
import { PRICE_VERSIONS, priceVersionAt, costAt, supersede, NoPriceVersionError, AI_MODEL_PRICES, computeAiCostMicroUsd } from './ai-pricing';
import { AI_MODELS } from './ai-model-registry';

describe('§96 the cost registry carries provider, model, unit, rates and an effective date', () => {
  it('every routable model has a current price version', () => {
    for (const m of Object.values(AI_MODELS)) {
      const v = priceVersionAt(m.key, '2026-09-20');
      expect(v, m.key).not.toBeNull();
      expect(v!.provider, m.key).toBe(m.provider);
    }
  });
  it('exactly one OPEN-ENDED version per model — "today\'s price" cannot be ambiguous', () => {
    const open = PRICE_VERSIONS.filter((v) => v.effectiveTo === null);
    expect(new Set(open.map((v) => v.model)).size).toBe(open.length);
  });
  it('§93 the unit is explicit: Whisper bills per audio-second, not per token', () => {
    const w = priceVersionAt('whisper-1', '2026-09-20')!;
    expect(w.unit).toBe('audio_seconds');
    expect(w.sourceNote).toMatch(/per minute/);
    // 60 audio-seconds ≈ $0.006 = 6000 micro-USD
    expect(costAt('whisper-1', 60, 0, '2026-09-20').costMicroUsd).toBe(6000);
    for (const v of PRICE_VERSIONS) if (v.model !== 'whisper-1') expect(v.unit, v.model).toBe('tokens');
  });
  it('ids are stable and unique, so a usage row can reference one', () => {
    const ids = PRICE_VERSIONS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('§218 pricing is versioned — a rate change does not re-value history', () => {
  const hist = supersede(PRICE_VERSIONS, { id: 'pv-openai-gpt4omini-2027-01', provider: 'openai', model: 'gpt-4o-mini', unit: 'tokens', inPerM: 0.30, outPerM: 1.20, effectiveFrom: '2027-01-01' });

  it('a call made BEFORE the change is still priced at the old rate, afterwards', () => {
    const before = costAt('gpt-4o-mini', 100, 50, '2026-09-20', hist);
    const after = costAt('gpt-4o-mini', 100, 50, '2027-02-01', hist);
    expect(before.costMicroUsd).toBe(45);                  // 100×0.15 + 50×0.60
    expect(after.costMicroUsd).toBe(90);                   // doubled rate
    expect(before.priceVersionId).not.toBe(after.priceVersionId);
  });
  it('superseding CLOSES the old row rather than editing it — history is intact', () => {
    const old = hist.find((v) => v.id === 'pv-openai-gpt4omini-2024-07')!;
    expect(old.inPerM).toBe(0.15);                          // untouched
    expect(old.effectiveTo).toBe('2027-01-01');             // closed, not deleted
    expect(hist.filter((v) => v.model === 'gpt-4o-mini')).toHaveLength(2);
  });
  it('a duplicate id is refused — ids are never reused', () => {
    expect(() => supersede(hist, { id: 'pv-openai-gpt4omini-2027-01', provider: 'openai', model: 'gpt-4o-mini', unit: 'tokens', inPerM: 9, outPerM: 9, effectiveFrom: '2028-01-01' })).toThrow(/already exists/);
  });
  it('a date with no covering version returns null and costAt REFUSES rather than inventing a rate', () => {
    expect(priceVersionAt('gpt-4o-mini', '2020-01-01')).toBeNull();
    expect(() => costAt('gpt-4o-mini', 10, 10, '2020-01-01')).toThrow(NoPriceVersionError);
    expect(priceVersionAt('model-that-never-existed', '2026-09-20')).toBeNull();
  });
  it('a later correction for the same window supersedes an earlier row', () => {
    const corrected = [...PRICE_VERSIONS, { id: 'pv-fix', provider: 'openai', model: 'gpt-4o-mini', unit: 'tokens' as const, inPerM: 0.20, outPerM: 0.80, effectiveFrom: '2025-01-01', effectiveTo: null }];
    expect(priceVersionAt('gpt-4o-mini', '2026-09-20', corrected)!.id).toBe('pv-fix');
  });
});

describe('the flat current-price map and the versioned rows agree', () => {
  it('every entry in AI_MODEL_PRICES matches the current version — one source, two shapes', () => {
    for (const [model, price] of Object.entries(AI_MODEL_PRICES)) {
      const v = priceVersionAt(model, '2026-09-20');
      if (!v) continue;   // alternates kept in the flat map for adapter aliases
      expect(price.inPerM, model).toBe(v.inPerM);
      expect(price.outPerM, model).toBe(v.outPerM);
    }
  });
  it('the fast path and the dated path give the same figure for today', () => {
    expect(computeAiCostMicroUsd('gpt-4o-mini', 100, 50)).toBe(costAt('gpt-4o-mini', 100, 50, '2026-09-20').costMicroUsd);
    expect(computeAiCostMicroUsd('claude-3-5-sonnet-latest', 1000, 500)).toBe(costAt('claude-3-5-sonnet-latest', 1000, 500, '2026-09-20').costMicroUsd);
  });
});
