import { describe, it, expect } from 'vitest';
import { buildRefundsVoidsSummary, classifyReversal, isReversalStatus, type ReversalRow } from './refunds-voids.dto';
import { InMemoryRefundsVoidsRepository } from './refunds-voids.repository';
import { RefundsVoidsService, RefundsVoidsForbiddenError } from './refunds-voids.service';

const row = (o: Partial<ReversalRow> = {}): ReversalRow => ({ id: 'p1', kind: 'refund', status: 'refunded', method: 'card', amountCents: 5000, ticketId: 't1', ticketNumber: '#2001', processedByName: 'Ana', createdAt: '2026-07-01T00:00:00Z', ...o });

describe('refunds-voids — classification + summary', () => {
  it('classifies voided vs refunded', () => {
    expect(classifyReversal('voided')).toBe('void');
    expect(classifyReversal('void')).toBe('void');
    expect(classifyReversal('refunded')).toBe('refund');
    expect(classifyReversal('reversed')).toBe('refund');
    expect(isReversalStatus('refunded')).toBe(true);
    expect(isReversalStatus('approved')).toBe(false);
  });
  it('rolls up refunds and voids separately + total', () => {
    const s = buildRefundsVoidsSummary([
      row({ kind: 'refund', amountCents: 5000 }),
      row({ id: 'p2', kind: 'refund', amountCents: 2500 }),
      row({ id: 'p3', kind: 'void', status: 'voided', amountCents: 8000 }),
    ]);
    expect(s.refundCount).toBe(2); expect(s.refundedCents).toBe(7500);
    expect(s.voidCount).toBe(1); expect(s.voidedCents).toBe(8000);
    expect(s.totalReversalCount).toBe(3); expect(s.totalReversalCents).toBe(15500);
  });
  it('handles empty', () => { const s = buildRefundsVoidsSummary([]); expect(s.totalReversalCents).toBe(0); expect(s.totalReversalCount).toBe(0); });
});

describe('refunds-voids — service', () => {
  it('returns kpis + rows', async () => {
    const svc = new RefundsVoidsService(new InMemoryRefundsVoidsRepository([row(), row({ id: 'p2', kind: 'void', status: 'voided', amountCents: 3000 })]));
    const st = await svc.getState({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] });
    expect(st.rows).toHaveLength(2); expect(st.kpis.refundCount).toBe(1); expect(st.kpis.voidCount).toBe(1);
  });
  it('rejects unauthenticated', async () => {
    const svc = new RefundsVoidsService(new InMemoryRefundsVoidsRepository());
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(RefundsVoidsForbiddenError);
  });
});
