// compensation-snapshot.vitest.spec.ts — §14 immutable snapshot. Pure mapper reconciliation + idempotent persist via a
// fake Kysely db (no live Postgres). Verifies Σ snapshot rows reconcile to the engine result.
import { describe, it, expect } from 'vitest';
import { computeTicketCompensation } from './compensation-engine';
import { snapshotRowsFromResult, CompensationSnapshotRepository } from './compensation-snapshot.repository';
import type { TicketCompensationInput } from './compensation.types';

const input: TicketCompensationInput = {
  tenantId: 't1', branchId: 'b1', ticketId: 'tk1', policyId: 'p1', policyVersion: 3,
  serviceLines: [
    { lineId: 'L1', serviceId: 'svc_gel', priceCents: 10000, supply: { method: 'fixed', value: 1000 },
      commission: { type: 'percent', value: 60, source: 'Technician + Service' },
      technicians: [{ technicianId: 'lead', method: 'percent', value: 80 }, { technicianId: 'asst', method: 'percent', value: 20 }] },
  ],
  tip: { method: 'equal', cardTipCents: 2000 },
};

describe('§14 immutable compensation snapshot', () => {
  const result = computeTicketCompensation(input);
  const rows = snapshotRowsFromResult(input, result, { tenantId: 't1', branchId: 'b1', snapshotAt: '2026-06-26T12:00:00Z', engineVersion: '1.0.0' });

  it('one row per (line, technician)', () => {
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.technician_id).sort()).toEqual(['asst', 'lead']);
  });

  it('Σ tech earnings rows == engine total; salon share attributed once (reconciles)', () => {
    const sumTech = rows.reduce((a, r) => a + r.tech_service_earnings_cents, 0);
    const sumSalon = rows.reduce((a, r) => a + r.salon_service_share_cents, 0);
    expect(sumTech).toBe(result.totals.techServiceEarningsCents);   // 5400
    expect(sumSalon).toBe(result.totals.salonServiceShareCents);    // 3600 (once, on first row)
    expect(sumTech + sumSalon).toBe(result.totals.commissionableCents); // 9000
  });

  it('captures provenance + carries policy id/version + engine version', () => {
    expect(rows[0].commission_source).toBe('Technician + Service');
    expect(rows[0].policy_id).toBe('p1');
    expect(rows[0].policy_version).toBe(3);
    expect(rows[0].engine_version).toBe('1.0.0');
  });

  it('tips attributed per technician, salon keeps none', () => {
    const lead = rows.find((r) => r.technician_id === 'lead')!;
    const asst = rows.find((r) => r.technician_id === 'asst')!;
    expect(lead.card_tip_cents + asst.card_tip_cents).toBe(2000);
  });

  it('persist is idempotent (ON CONFLICT DO NOTHING) via fake db', async () => {
    let lastConflict = false;
    const db: any = { insertInto: () => ({ values: () => ({ onConflict: (fn: any) => { fn({ columns: () => ({ doNothing: () => { lastConflict = true; return {}; } }) }); return { execute: async () => rows }; } }) }) };
    const repo = new CompensationSnapshotRepository(db);
    const n = await repo.persistSnapshot(rows);
    expect(n).toBe(2);
    expect(lastConflict).toBe(true); // conflict clause was wired
    expect(await repo.persistSnapshot([])).toBe(0); // empty no-op
  });
});
