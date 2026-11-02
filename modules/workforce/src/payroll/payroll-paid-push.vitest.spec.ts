import { describe, it, expect } from 'vitest';
import { InMemoryPayrollRepository } from './payroll.repository';
import { PayrollService } from './payroll.service';

// §6.2 "payout events": marking a payroll period PAID pushes to every technician with a line in it.
// Deliberately no amounts in the push — a lock screen is not a payslip; the app shows the figures.
// The push port is structural, so a plain recording object stands in for PushService.

type Sent = { tenantId: string | null; userId: string; title: string; body?: string; reference?: string; data?: Record<string, string> };
const recorder = () => {
  const sent: Sent[] = [];
  return { sent, push: { async dispatchToUser(tenantId: string | null, userId: string, msg: any) { sent.push({ tenantId, userId, ...msg }); return { ok: true }; } } };
};

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.payroll.view', 'pos.payroll.manage'] };

const seedPeriod = async (svc: PayrollService, repo: InMemoryPayrollRepository) => {
  const p = await svc.createPeriod(ctx as any, { label: 'Jul 1–15', periodStart: '2026-07-01', periodEnd: '2026-07-15' });
  // lines are seeded straight into the repository (D7: the service has no manual-line path; PREPARE writes the canonical lines)
  await repo.upsertLine(ctx as any, p.id, { technicianId: 'tech1', technicianName: 'Sam', grossSalesCents: 100000, commissionType: 'percent', commissionValue: 50, servicesCount: 8, tipsCents: 15000 });
  await repo.upsertLine(ctx as any, p.id, { technicianId: 'tech2', technicianName: 'Ana', grossSalesCents: 80000, commissionType: 'percent', commissionValue: 40, servicesCount: 6, tipsCents: 9000 });
  return p;
};

describe('payroll period paid → payout push to each technician on the period', () => {
  it('pushes once per technician with the period reference and NO amounts', async () => {
    const { sent, push } = recorder();
    const repo = new InMemoryPayrollRepository();
    const svc = new PayrollService(repo, undefined, undefined, push);
    const p = await seedPeriod(svc, repo);
    await svc.finalize(ctx as any, p.id);
    expect(sent.length).toBe(0); // finalized alone is not a payout event
    await svc.markPaid(ctx as any, p.id);
    expect(sent.length).toBe(2);
    expect(new Set(sent.map((s) => s.userId))).toEqual(new Set(['user_tech1', 'user_tech2'])); // in-memory tech→user map
    for (const s of sent) {
      expect(s.tenantId).toBe('t_A');
      expect(s.title).toBe('Payroll paid');
      expect(s.reference).toBe('payroll_paid');
      expect(s.data?.periodId).toBe(p.id);
      expect(`${s.title} ${s.body ?? ''}`).not.toMatch(/\$|\d{3,}/); // no dollar figures on the lock screen
    }
  });

  it('an unlinked technician is skipped; the others still get their push', async () => {
    const { sent, push } = recorder();
    const repo = new InMemoryPayrollRepository();
    const real = repo.technicianUserIds.bind(repo);
    (repo as any).technicianUserIds = async (c: any, ids: string[]) => { const m = await real(c, ids); delete m['tech2']; return m; };
    const svc = new PayrollService(repo, undefined, undefined, push);
    const p = await seedPeriod(svc, repo);
    await svc.finalize(ctx as any, p.id);
    await svc.markPaid(ctx as any, p.id);
    expect(sent.map((s) => s.userId)).toEqual(['user_tech1']);
  });

  it('a push layer that throws never fails the paid transition (best-effort)', async () => {
    const boom = { async dispatchToUser() { throw new Error('push down'); } };
    const repo = new InMemoryPayrollRepository();
    const svc = new PayrollService(repo, undefined, undefined, boom as any);
    const p = await seedPeriod(svc, repo);
    await svc.finalize(ctx as any, p.id);
    const paid = await svc.markPaid(ctx as any, p.id);
    expect(paid.status).toBe('paid');
  });

  it('without a push layer wired (Nest-free construction), the lifecycle is unchanged', async () => {
    const repo = new InMemoryPayrollRepository();
    const svc = new PayrollService(repo);
    const p = await seedPeriod(svc, repo);
    await svc.finalize(ctx as any, p.id);
    expect((await svc.markPaid(ctx as any, p.id)).status).toBe('paid');
  });
});
