import { describe, it, expect } from 'vitest';
import { buildInsightsCsv } from './AiInsightsExport';
import type { AiInsightRow } from '../api/superAdminApi';

const row = (o: Partial<AiInsightRow> & { id: string; reference: string; title: string }): AiInsightRow => ({
  tenant: 'Glamour Studio', branch: 'Downtown', category: 'BOOKING_DECLINE', severity: 'high', confidence: 84,
  confidenceMethod: 'calibrated_probability', recommendation: 'Launch re-engagement.', status: 'new', updatedAt: '2026-05-06T10:15:00Z', freshness: 'current', ...o,
});

describe('buildInsightsCsv', () => {
  it('emits header + a recommendations-only notice + one line per insight', () => {
    const csv = buildInsightsCsv([row({ id: '1', reference: 'AI-BKG-0001', title: 'Declining bookings' })], { generatedAt: '2026-05-06T00:00:00Z' });
    const lines = csv.split('\n');
    expect(lines[0]).toContain('AI Insights Report');
    expect(csv).toContain('Recommendations only');
    expect(lines.some((l) => l.startsWith('Insight ID,'))).toBe(true);
    expect(csv).toContain('AI-BKG-0001');
    expect(csv).toContain('84%');
  });

  it('renders N/A when confidence is null', () => {
    const csv = buildInsightsCsv([row({ id: '5', reference: 'AI-TXN-0005', title: 'Unusual txn', confidence: null, confidenceMethod: null })]);
    expect(csv).toContain('N/A');
  });

  it('neutralizes formula-injection attempts', () => {
    const csv = buildInsightsCsv([row({ id: 'x', reference: 'AI-1', title: '=cmd|calc' })]);
    expect(csv).toContain("'=cmd|calc");
  });

  it('quotes cells with commas', () => {
    const csv = buildInsightsCsv([row({ id: 'x', reference: 'AI-1', title: 'Down at Glamour, Downtown' })]);
    expect(csv).toContain('"Down at Glamour, Downtown"');
  });
});
