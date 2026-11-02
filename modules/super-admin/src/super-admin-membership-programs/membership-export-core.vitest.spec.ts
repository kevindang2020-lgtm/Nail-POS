import { describe, it, expect } from 'vitest';
import { toCsv, sanitizeCell, programToExportRecord, selectColumns, CSV_COLUMNS, REPORTS, billingFailureToRecord, suspiciousToRecord, revenueTenantToRecord } from './membership-export-core';

describe('sanitizeCell', () => {
  it('neutralizes formula injection and CSV-quotes special chars', () => {
    expect(sanitizeCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCell('@x')).toBe("'@x");
    expect(sanitizeCell('a,b')).toBe('"a,b"');
    expect(sanitizeCell('VIP Membership')).toBe('VIP Membership');
  });
});

describe('toCsv', () => {
  it('refuses forbidden columns (card/cvv/email/phone/etc.)', () => {
    expect(() => toCsv([{ key: 'cardNumber', label: 'Card' }], [])).toThrow(/disallowed column/);
    expect(() => toCsv([{ key: 'x', label: 'Customer Email' }], [])).toThrow(/disallowed column/);
    expect(() => toCsv([{ key: 'phone', label: 'Phone' }], [])).toThrow(/disallowed column/);
  });
  it('builds header + rows with CRLF', () => {
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: '1' }, { a: '2' }])).toBe('A\r\n1\r\n2');
  });
});

describe('programToExportRecord', () => {
  const row = { name: 'VIP Membership', tenantName: 'Pilot Nail Salon', productType: 'premium', billingInterval: 'month', priceCents: 9900, activeMembers: 8, totalMembers: 12, revenueCents: 79200, status: 'active' };
  it('formats money as dollars and never emits card/contact fields', () => {
    const rec = programToExportRecord(row);
    expect(rec.price).toBe('99.00'); expect(rec.revenue).toBe('792.00');
    expect(Object.keys(rec).join(',')).not.toMatch(/card|cvv|email|phone|address/i);
  });
  it('round-trips through the default columns with no PAN', () => {
    const csv = toCsv(selectColumns(), [programToExportRecord(row)]);
    expect(csv.split('\r\n')[0]).toContain('Program');
    expect(csv).toContain('VIP Membership');
    expect(csv).not.toMatch(/\b\d{16}\b/);
  });
});

describe('selectColumns', () => {
  it('defaults to all safe columns and filters unknowns', () => {
    expect(selectColumns()).toEqual(CSV_COLUMNS);
    expect(selectColumns(['program', 'revenue', 'nope']).map((c) => c.key)).toEqual(['program', 'revenue']);
  });
});

describe('§54 report types', () => {
  it('every report column set is free of card/contact fields', () => {
    for (const [, def] of Object.entries(REPORTS)) {
      expect(() => toCsv(def.columns, [])).not.toThrow();
    }
  });
  it('billing-failure records format money and omit contact data', () => {
    const rec = billingFailureToRecord({ tenant: 'Pilot', program: 'VIP', memberNumber: 'MBR-1', amountCents: 9900, reason: 'card declined', attempt: 2, at: '2026-05-06T00:00:00Z' });
    expect(rec.amount).toBe('99.00'); expect(rec.at).toBe('2026-05-06');
    expect(Object.keys(rec).join(',')).not.toMatch(/email|phone|address|card/i);
  });
  it('suspicious records humanize the signal and carry no PII', () => {
    const rec = suspiciousToRecord({ type: 'benefit_redeemed_while_past_due', tenant: 'Pilot', count: 1, severity: 'high' });
    expect(rec.type).toBe('benefit redeemed while past due');
    expect(Object.keys(rec)).toEqual(['type', 'tenant', 'count', 'severity']);
  });
  it('revenue-by-tenant records render dollars', () => {
    expect(revenueTenantToRecord({ tenant: 'Pilot', revenueCents: 124200, mrrCents: 103500 })).toEqual({ tenant: 'Pilot', revenue: '1242.00', mrr: '1035.00' });
  });
});
