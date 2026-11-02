// ai-ocr-receipt-accuracy.vitest — §147 / §197: the OCR quality evaluation set. Sixteen SYNTHETIC receipts / invoices
// (__fixtures__/receipts/*.json — hand-written AnalyzeExpense-shaped responses, no customer data) covering retail, restaurant,
// utility, equipment, subscription, landlord, nail supply and handwritten, under clean, crumpled, faded, angled, long,
// multi-page, discount, tax and refund conditions. Each runs through the REAL adapter chain (normalizeAnalyzeExpense →
// toFinancials → buildValidationReport → classifyDocument) and is scored field by field; the matrix is printed and the floors
// below fail the suite. Accuracy against the live provider on real photos stays BLOCKED_EXTERNAL (no Textract credentials);
// this proves the adapter, the validator and the review routing never accept a bad reading silently.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeAnalyzeExpense, toFinancials } from './ai-ocr-receipt.textract';
import { buildValidationReport } from './ai-ocr-receipt-validation';
import { classifyDocument } from './ai-ocr-receipt-core';

interface Fixture { name: string; type: string; condition: string; textract: unknown; expected: Record<string, unknown>; minOverallConfidence: number; reviewExpected: string | null; notes: string }
const DIR = join(__dirname, '__fixtures__', 'receipts');
const fixtures: Fixture[] = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

interface Row { name: string; condition: string; vendor: boolean; date: boolean; total: boolean; subtotal: boolean | null; tax: boolean | null; number: boolean | null; lines: boolean; type: boolean; validation: boolean; confidence: number; flags: string[] }
const rows: Row[] = [];

describe('§147/§197 OCR accuracy over the synthetic corpus', () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(16);
  for (const fx of fixtures) {
    it(`${fx.name} (${fx.type}, ${fx.condition}) — ${fx.notes}`, () => {
      const r = normalizeAnalyzeExpense(fx.textract, 'fixture');
      if (fx.expected.unavailable) { expect(r.unavailable).toBe(true); expect(r.fields).toEqual([]); return; }
      expect(r.unavailable).toBe(false);
      const fin = toFinancials(r);
      const v = buildValidationReport(fin, { lowConfidenceThreshold: 0.8 });
      const cls = classifyDocument(r.textRedacted);
      const e = fx.expected as { vendor: string; date: string; totalCents: number; subtotalCents?: number; taxCents?: number; feesCents?: number; discountCents?: number; documentNumber?: string; lines: number; type: string; validation: string; dateAmbiguous?: boolean; credit?: boolean; pages?: number; reviewPriority?: string; tipCents?: number };
      const field = (k: string) => r.fields.find((f) => f.key === k);
      const row: Row = {
        name: fx.name, condition: fx.condition,
        vendor: fin.vendor === e.vendor, date: fin.documentDate?.slice(0, 10) === e.date || (!!e.dateAmbiguous && fin.dateAmbiguous), total: fin.totalCents === e.totalCents,
        subtotal: e.subtotalCents == null ? null : fin.subtotalCents === e.subtotalCents, tax: e.taxCents == null ? null : fin.taxCents === e.taxCents,
        number: e.documentNumber == null ? null : field('document_number')?.text === e.documentNumber,
        lines: r.lineItems.length === e.lines, type: cls.type === e.type, validation: v.status === e.validation, confidence: Math.round(r.overallConfidence * 100) / 100, flags: v.flags,
      };
      rows.push(row);
      // the money read is exact or absent — never a near-miss that "looks right"
      expect(fin.totalCents).toBe(e.totalCents);
      if (e.subtotalCents != null) expect(fin.subtotalCents).toBe(e.subtotalCents);
      if (e.taxCents != null) expect(fin.taxCents).toBe(e.taxCents);
      if (e.feesCents != null) expect(fin.feesCents).toBe(e.feesCents);
      if (e.discountCents != null) expect(fin.discountCents).toBe(e.discountCents);
      if (e.tipCents != null) expect(fin.tipCents).toBe(e.tipCents);
      expect(fin.vendor).toBe(e.vendor);
      expect(r.lineItems).toHaveLength(e.lines);
      if (e.pages) expect(r.pages).toBe(e.pages);
      if (e.dateAmbiguous) expect(fin.dateAmbiguous).toBe(true); else expect(fin.documentDate?.slice(0, 10)).toBe(e.date);
      if (e.credit) expect(fin.isCreditOrRefund).toBe(true);
      expect(cls.type).toBe(e.type);
      expect(v.status).toBe(e.validation);
      if (e.reviewPriority) expect(v.reviewPriority).toBe(e.reviewPriority);          // a high amount is review-priority even when it reconciles (§96)
      expect(v.requiresHumanReview).toBe(true);                                    // ALWAYS — there is no auto-post (§31)
      expect(r.overallConfidence).toBeGreaterThanOrEqual(fx.minOverallConfidence);
      if (fx.reviewExpected) expect(v.flags).toContain(fx.reviewExpected);
      // a weak reading is never promoted: every fixture below 0.8 overall is at least needs_review
      if (r.overallConfidence < 0.8) expect(v.status).not.toBe('valid');
    });
  }

  it('accuracy matrix: 100 % on vendor / total / lines / type / routing; every degraded reading is routed to review with its reason', () => {
    const pct = (k: keyof Row) => { const m = rows.filter((r) => r[k] !== null); return m.length ? Math.round((m.filter((r) => r[k] === true).length / m.length) * 100) : 100; };
    const matrix = rows.map((r) => `${r.name.padEnd(22)} ${r.condition.padEnd(11)} vendor=${+r.vendor} date=${+r.date} total=${+r.total} subtotal=${r.subtotal == null ? '-' : +r.subtotal} tax=${r.tax == null ? '-' : +r.tax} no=${r.number == null ? '-' : +r.number} lines=${+r.lines} type=${+r.type} routing=${+r.validation} conf=${r.confidence} ${r.flags.join(',') || 'clean'}`);
    console.log(['OCR accuracy (synthetic corpus, adapter + validator):', ...matrix, `vendor ${pct('vendor')}% · date ${pct('date')}% · total ${pct('total')}% · subtotal ${pct('subtotal')}% · tax ${pct('tax')}% · number ${pct('number')}% · lines ${pct('lines')}% · type ${pct('type')}% · review routing ${pct('validation')}%`].join('\n'));
    expect(rows).toHaveLength(fixtures.length - 1);   // the unreadable one is 'unavailable', not scored
    for (const k of ['vendor', 'date', 'total', 'subtotal', 'tax', 'number', 'lines', 'type', 'validation'] as const) expect(pct(k)).toBe(100);
    const degraded = rows.filter((r) => ['crumpled', 'faded', 'handwritten', 'angled'].includes(r.condition));
    expect(degraded).toHaveLength(4);
    for (const r of degraded) expect(r.flags.length).toBeGreaterThan(0);
  });
});
