// compensation-security.vitest.spec.ts — §40 security & isolation sweep for the compensation system. Cross-cutting
// invariants: every tenant-scoped read filters by tenant_id; technician identity is server-resolved (a client-supplied
// id is ignored); the snapshot is write-once; the un-filtered platform oversight read is gone (SW-04); and the engine NEVER
// emits a non-reconciling result.
import { CompensationSnapshotRepository, CompensationController, CompensationPreviewService, CompensationReportsService, computeTicketCompensation, type TicketCompensationInput } from '@aipowersalon/workforce';
import { describe, it, expect } from 'vitest';
import { TechService } from './tech.service';
import { permissionsFor } from '@aipowersalon/permissions';
import { ForbiddenException } from '@nestjs/common';
import type { TechDataPort } from './tech.repository';

// fake Kysely that records which columns were filtered, for tenant-scope assertions
function recordingDb() {
  const wheres: string[] = [];
  const chain: any = {
    selectFrom: () => chain, select: () => chain, selectAll: () => chain,
    where: (col: string) => { wheres.push(col); return chain; },
    orderBy: () => chain, execute: async () => [], executeTakeFirst: async () => null,
  };
  return { db: chain, wheres };
}

describe('§40 tenant isolation — every tenant read filters by tenant_id', () => {
  it('getByTicket / sumByTechnicianPeriod / tipReport / reportRows / getByTicketForTechnician are tenant-scoped', async () => {
    for (const run of [
      (r: CompensationSnapshotRepository) => r.getByTicket('t1', 'tk'),
      (r: CompensationSnapshotRepository) => r.sumByTechnicianPeriod('t1', 'tech', 'a', 'b'),
      (r: CompensationSnapshotRepository) => r.tipReport('t1', 'a', 'b'),
      (r: CompensationSnapshotRepository) => r.reportRows('t1', 'a', 'b'),
      (r: CompensationSnapshotRepository) => r.getByTicketForTechnician('t1', 'tk', 'tech'),
    ]) {
      const { db, wheres } = recordingDb();
      await run(new CompensationSnapshotRepository(db));
      expect(wheres).toContain('tenant_id');
    }
  });

  it('the un-filtered platform oversight read is gone (w4 SW-04: no role could reach it, nothing called it)', () => {
    expect((CompensationSnapshotRepository.prototype as any).platformOversight).toBeUndefined();
  });
});

describe('§40 technician identity is server-resolved (browser-supplied id is ignored)', () => {
  it('getCanonicalEarnings queries with the resolved id even when ctx carries a forged technicianId', async () => {
    const port = { technicianAppEnabled: async () => true, resolveTechnicianId: async () => 'real-tech', recordAudit: async () => {} } as unknown as TechDataPort;
    let queried = '';
    const compReads = { sumByTechnicianPeriod: async (_t: string, tech: string) => { queried = tech; return { techServiceEarningsCents: 0, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, tickets: 0 }; }, getByTicketForTechnician: async () => [] };
    const svc = new TechService(port, undefined, undefined, compReads);
    const forgedCtx = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN'), technicianId: 'VICTIM' } as any;
    await svc.getCanonicalEarnings(forgedCtx, 'day');
    expect(queried).toBe('real-tech');   // NOT 'VICTIM'
  });
});

describe('§40 snapshot immutability (write-once)', () => {
  it('persistSnapshot uses ON CONFLICT DO NOTHING', async () => {
    let doNothing = false;
    const db: any = { insertInto: () => ({ values: () => ({ onConflict: (fn: any) => { fn({ columns: () => ({ doNothing: () => { doNothing = true; return {}; } }) }); return { execute: async () => [{}] }; } }) }) };
    await new CompensationSnapshotRepository(db).persistSnapshot([{ tenant_id: 't', ticket_id: 'k', service_line_id: 'l', technician_id: 'x' } as any]);
    expect(doNothing).toBe(true);
  });
});

describe('§40 permission gating', () => {
  const reports = new CompensationReportsService();
  const ctrl = new CompensationController(new CompensationPreviewService(), reports);
  it('owner preview/report blocked for a technician', () => {
    const tech = { ctx: { role: 'TECHNICIAN', permissions: [], tenantId: 't' } };
    expect(() => ctrl.preview(tech, {})).toThrow(ForbiddenException);
    expect(() => ctrl.reportCommission(tech, {})).toThrow(ForbiddenException);
  });
});

describe('§40 engine never emits a non-reconciling result', () => {
  it('splits + tips reconcile across many randomized tickets', () => {
    for (let i = 0; i < 200; i++) {
      const price = 100 + Math.floor(Math.random() * 50000);
      const discount = Math.floor(Math.random() * price * 0.6);
      const supply = Math.floor(Math.random() * price * 0.3);
      const pct = Math.floor(Math.random() * 101);
      const nTech = 1 + Math.floor(Math.random() * 3);
      const techs = Array.from({ length: nTech }, (_, k) => ({ technicianId: 't' + k, method: 'equal' as const }));
      const input: TicketCompensationInput = { tenantId: 'T', branchId: 'B', ticketId: 'k' + i,
        serviceLines: [{ lineId: 'L1', priceCents: price, discountCents: discount, supply: { method: 'fixed', value: supply }, taxCents: Math.floor(Math.random() * 1000), commission: { type: 'percent', value: pct }, technicians: techs }],
        tip: { method: 'equal', cardTipCents: Math.floor(Math.random() * 5000), cashTipCents: Math.floor(Math.random() * 5000) } };
      const r = computeTicketCompensation(input);
      expect(r.reconciliation.splitsReconcile).toBe(true);
      expect(r.reconciliation.tipsReconcile).toBe(true);
      expect(r.reconciliation.salonTipIsZero).toBe(true);
      expect(r.reconciliation.noNegativeCommissionable).toBe(true);
    }
  });
});
