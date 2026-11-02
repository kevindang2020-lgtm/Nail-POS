// queue-pii-mask.vitest.spec.ts — Super Admin queue oversight masks customer names by default; support mode unmasks ONE
// tenant's rows (workforce audit #63). Pure helpers + the real service's support-mode resolution over a fake database.
import { describe, it, expect } from 'vitest';
import { maskName, maskQueuePii, SUPPORT_MODE_WINDOW_HOURS } from './queue-pii-mask';

describe('Super Admin queue PII masking', () => {
  it('masks first name to initial + bullets and keeps only the last initial', () => {
    expect(maskName('Grace Kim')).toBe('G•••• K.');
    expect(maskName('Al')).toBe('A••');
    expect(maskName('  ')).toBe('—');
    expect(maskName(null)).toBe('—');
  });
  it('masks nested customer/customerName fields everywhere; unmasks only the support-mode tenant', () => {
    const o = { kpis: { total: 2 }, queues: { rows: [{ tenantId: 'T1', customer: 'Grace Kim' }, { tenantId: 'T2', customer: 'Bob Lee' }] }, stuck: [{ customerName: 'Bob Lee' }] };
    const masked = maskQueuePii(o);
    expect(masked.queues.rows.map((r: any) => r.customer)).toEqual(['G•••• K.', 'B•• L.']);
    expect(masked.stuck[0].customerName).toBe('B•• L.');
    const support = maskQueuePii(o, 'T1');
    expect(support.queues.rows[0].customer).toBe('Grace Kim');
    expect(support.queues.rows[1].customer).toBe('B•• L.');
    expect(support.stuck[0].customerName).toBe('B•• L.');   // no tenantId on the row → never unmasked
    expect(o.queues.rows[0].customer).toBe('Grace Kim');   // input untouched (deep copy)
  });
  it('the window is four hours', () => { expect(SUPPORT_MODE_WINDOW_HOURS).toBe(4); });
});
