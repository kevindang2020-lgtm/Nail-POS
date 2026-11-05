// ai-ocr-receipt-pipeline.vitest.spec.ts — the pipeline state machine structurally enforces mandatory review (the only
// edge into 'posted' is from 'approved', reachable only through review); quarantine/infected never reach extraction;
// duplicates hold; and an unconnected OCR provider yields 'unavailable', never fabricated extraction.
import { describe, it, expect } from 'vitest';
import { transition, canPost, isTerminal, routeOcr, runOcrWithFallback, type OcrProvider, type PipelineState } from './ai-ocr-receipt-pipeline';

const mk = (key: string, connected: boolean, cost: number, supports = true): OcrProvider => ({ key, connected, costRank: cost, supports: () => supports, async extract() { return { unavailable: false, providerKey: key, textRedacted: 'ok', pages: 1, fields: [], lineItems: [], overallConfidence: 0.9 }; } });

describe('pipeline state machine', () => {
  it('walks the happy path only through review + approval', () => {
    let s: PipelineState = 'uploaded';
    const step = (e: any) => { s = transition(s, e).state; return s; };
    expect(step('scan_clean')).toBe('extracting');
    expect(step('extract_ok')).toBe('validating');
    expect(step('validate_ok')).toBe('review_required');
    expect(step('start_review')).toBe('in_review');
    expect(step('approve')).toBe('approved');
    expect(step('post_ok')).toBe('posted');
    expect(isTerminal('posted')).toBe(true);
  });
  it('forbids skipping review/approval', () => {
    expect(transition('validating', 'post_ok' as any).ok).toBe(false);
    expect(transition('review_required', 'approve').ok).toBe(false);
    expect(transition('review_required', 'post_ok' as any).ok).toBe(false);
    expect(transition('extracting', 'post_ok' as any).ok).toBe(false);
    expect(canPost('approved')).toBe(true);
    expect(canPost('review_required')).toBe(false);
  });
  it('handles scan outcomes, duplicates, unavailability, and retries', () => {
    expect(transition('uploaded', 'scan_infected').state).toBe('rejected');
    expect(transition('uploaded', 'scan_quarantine').state).toBe('quarantined');
    expect(transition('validating', 'duplicate_detected').state).toBe('duplicate_hold');
    expect(transition('extracting', 'extract_unavailable').state).toBe('manual_entry_required');
    expect(transition('extraction_failed', 'retry').state).toBe('extracting');
    expect(transition('failed', 'retry').state).toBe('approved');
  });
});

describe('OCR provider routing + fallback', () => {
  it('routes connected+supporting providers cheapest first', () => {
    expect(routeOcr([mk('b', true, 5), mk('a', true, 1), mk('c', false, 0)], { mime: 'image/png' }).map((x) => x.key)).toEqual(['a', 'b']);
  });
  it('falls back on error and reports unavailable when nothing is connected', async () => {
    const throwing: OcrProvider = { key: 'x', connected: true, costRank: 0, supports: () => true, async extract() { throw new Error('down'); } };
    const input = { tenantId: 'T', documentId: 'D', storageKey: 'k', mime: 'image/png', pageCount: 1 };
    expect((await runOcrWithFallback([throwing, mk('backup', true, 2)], input)).providerKey).toBe('backup');
    const none = await runOcrWithFallback([mk('off', false, 0)], input);
    expect(none.unavailable).toBe(true);
    expect(none.fields).toHaveLength(0);
  });
});
