import { describe, it, expect, beforeAll, vi } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerPayrollPeriodDetail } from './owner.dto';
import { hashPassword } from '@aipowersalon/auth';

// Owner payroll WRITE path: approve (finalize) / lock (markPaid) / reopen, each requiring owner.finance.view + branch
// scope + FRESH AUTHENTICATION (the owner's own PIN), then delegating to the canonical engine. These tests prove: a
// wrong/absent PIN is rejected and audited (and the engine is never called); a correct PIN delegates to the right engine
// method; an out-of-scope/unknown period is not_found; and a paid (locked) period cannot be reopened (engine guard).
const fin = (over: any = {}): OwnerPayrollPeriodDetail => ({
  period: { periodId: 'p2', branchId: 'b1', label: 'May 12 – May 18', periodStart: '2026-05-12', periodEnd: '2026-05-18', status: 'finalized', finalizedAt: '2026-05-19T00:00:00.000Z', paidAt: null, totalPayableCents: 2468000, totalCommissionCents: 1842000, totalTipsCents: 325000, ...over },
  totals: { grossSalesCents: 5000000, commissionCents: 1842000, retailCommissionCents: 0, cardTipCents: 0, cashTipCents: 0, tipsCents: 325000, guaranteeTopupCents: 0, adjustmentCents: 0, payableCents: 2468000, technicianCount: 1 },
  lines: [],
});

let PIN_HASH = '';
beforeAll(async () => { PIN_HASH = await hashPassword('1357'); });

const ownerCtx = (): OwnerContext => ({ tenantId: 't1', userId: 'u_owner', role: 'OWNER', permissions: ['owner.finance.view', 'payroll.manage', 'payroll.approve', 'payouts.manage'] } as any);

class FakePayroll {
  finalize = vi.fn(async () => ({ id: 'p2', status: 'finalized' }));
  markPaid = vi.fn(async () => ({ id: 'p2', status: 'paid' }));
  reopen = vi.fn(async () => ({ id: 'p2', status: 'draft' }));
}

class FakeRepo extends InMemoryOwnerRepository {
  audits: any[] = [];
  constructor(private pinHash: string | null, private period: OwnerPayrollPeriodDetail | null = fin()) { super(); }
  async allowedBranchIds() { return null; }
  async ownerUserPinHash() { return this.pinHash; }
  async ownerPayrollPeriod() { return this.period; }
  async writeAudit(_ctx: OwnerContext, e: any) { this.audits.push(e); }
}

const make = (repo: FakeRepo, payroll: any = new FakePayroll()) => ({ svc: new OwnerService(repo, undefined, payroll as any), payroll });

describe('Owner payroll write-path — fresh-auth gated, delegates to the engine', () => {
  it('rejects a wrong PIN, audits it as a security event, and never calls the engine', async () => {
    const repo = new FakeRepo(PIN_HASH);
    const { svc, payroll } = make(repo);
    await expect(svc.approvePayroll(ownerCtx(), 'p2', '0000')).rejects.toThrow(/incorrect pin/i);
    expect(payroll.finalize).not.toHaveBeenCalled();
    expect(repo.audits.some((a) => a.action === 'payroll_pin_rejected')).toBe(true);
  });

  it('requires a PIN to be set before allowing the action', async () => {
    const { svc, payroll } = make(new FakeRepo(null));
    await expect(svc.lockPayroll(ownerCtx(), 'p2', '1357')).rejects.toThrow(/set a security pin/i);
    expect(payroll.markPaid).not.toHaveBeenCalled();
  });

  it('approves with a correct PIN by delegating to finalize, and writes an owner audit', async () => {
    const repo = new FakeRepo(PIN_HASH);
    const { svc, payroll } = make(repo);
    await svc.approvePayroll(ownerCtx(), 'p2', '1357');
    expect(payroll.finalize).toHaveBeenCalledTimes(1);
    const pctx = payroll.finalize.mock.calls[0][0];
    // RE-PINNED (Payroll wave 2): the engine gets the owner's OWN keys (it re-checks payroll.approve) — nothing is granted
    expect(pctx.permissions).toContain('payroll.approve');
    expect(pctx.permissions).not.toContain('pos.payroll.manage');
    expect(pctx.tenantId).toBe('t1');
    expect(repo.audits.some((a) => a.action === 'payroll_approved')).toBe(true);
  });

  it('locks (marks paid) with a correct PIN by delegating to markPaid', async () => {
    const { svc, payroll } = make(new FakeRepo(PIN_HASH));
    await svc.lockPayroll(ownerCtx(), 'p2', '1357');
    expect(payroll.markPaid).toHaveBeenCalledTimes(1);
  });

  it('emits owner_payroll_updated on a successful transition so the Approvals tab and Home strip refresh live', async () => {
    const rt = { toOwner: vi.fn() };
    const svc = new OwnerService(new FakeRepo(PIN_HASH), rt as any, new FakePayroll() as any);
    await svc.approvePayroll(ownerCtx(), 'p2', '1357');
    expect(rt.toOwner).toHaveBeenCalledWith('t1', 'owner_payroll_updated', { periodId: 'p2', action: 'payroll_approved' });
  });

  it('returns not_found for an unknown or out-of-scope period (before any PIN check)', async () => {
    const { svc, payroll } = make(new FakeRepo(PIN_HASH, null));
    await expect(svc.approvePayroll(ownerCtx(), 'nope', '1357')).rejects.toThrow(/not found/i);
    expect(payroll.finalize).not.toHaveBeenCalled();
  });

  it("reopen carries the owner's written reason to the engine (Oct 12 2026 merge — the engine refuses a reopen without one)", async () => {
    const { svc, payroll } = make(new FakeRepo(PIN_HASH));
    await svc.reopenPayroll(ownerCtx(), 'p2', '1357', 'hours were entered on the wrong day');
    expect(payroll.reopen).toHaveBeenCalledTimes(1);
    expect(payroll.reopen.mock.calls[0][1]).toBe('p2');
    expect(payroll.reopen.mock.calls[0][2]).toBe('hours were entered on the wrong day');
  });

  it('surfaces an engine guard (e.g. a locked period) as a friendly error', async () => {
    const payroll = new FakePayroll();
    payroll.reopen = vi.fn(async () => { throw new Error('A paid period is locked'); });
    const { svc } = make(new FakeRepo(PIN_HASH, fin({ status: 'paid', paidAt: '2026-05-20T00:00:00.000Z' })), payroll);
    await expect(svc.reopenPayroll(ownerCtx(), 'p2', '1357')).rejects.toThrow(/locked/i);
  });

  it('a role that can SEE finances but not manage payroll (custom accountant template) cannot approve, lock or reopen', async () => {
    const { svc } = make(new FakeRepo());
    const viewOnly = { ...ownerCtx(), permissions: ['owner.finance.view'] } as any;
    for (const act of ['approvePayroll', 'lockPayroll', 'reopenPayroll'] as const) await expect((svc as any)[act](viewOnly, 'p2', '1357')).rejects.toThrow(/payroll\.manage/);
  });

  it('wave 2 (§71/§101): payroll.manage alone cannot approve / reopen (payroll.approve) or lock (payouts.manage)', async () => {
    const { svc, payroll } = make(new FakeRepo(PIN_HASH));
    const manager = { ...ownerCtx(), permissions: ['owner.finance.view', 'payroll.manage'] } as any;
    await expect(svc.approvePayroll(manager, 'p2', '1357')).rejects.toThrow(/payroll\.approve/);
    await expect(svc.reopenPayroll(manager, 'p2', '1357', 'fix tips')).rejects.toThrow(/payroll\.approve/);
    await expect(svc.lockPayroll(manager, 'p2', '1357')).rejects.toThrow(/payouts\.manage/);
    expect(payroll.finalize).not.toHaveBeenCalled();
  });

  it('blocks the action entirely without owner.finance.view', async () => {
    const { svc } = make(new FakeRepo(PIN_HASH));
    const noPerm = { ...ownerCtx(), permissions: ['owner.dashboard.view'] } as any;
    await expect(svc.approvePayroll(noPerm, 'p2', '1357')).rejects.toThrow(/permission/i);
  });
});

// Constitution 9 §246: technician_earnings_updated had NO PRODUCER for months — registered, routed, and
// compared by TechPayrollScreen, with nothing emitting it. These tests pin the producer so it cannot quietly
// go away again.
describe('§246 technician_earnings_updated reaches the technicians it is about', () => {
  const line = (technicianId: string) => ({
    technicianId, technicianName: 'T', servicesCount: 1, grossSalesCents: 1000, commissionType: 'percent',
    commissionValue: 60, commissionCents: 600, retailCommissionCents: 0, cardTipCents: 0, cashTipCents: 0,
    tipsCents: 0, guaranteeTopupCents: 0, adjustmentCents: 0, payableCents: 600,
  });
  // fin()'s `...over` spreads inside `period`, NOT at the top level, so fin({ lines }) silently leaves
  // lines: [] and every assertion here failed at once. Build the detail explicitly instead.
  const withLines = (lines: any[]) => ({ ...fin(), lines });

  const rtSpy = () => {
    const sent: Array<{ room: string; id: string; event: string; payload: any }> = [];
    return { sent, rt: {
      toTenant: () => undefined, toTicket: () => undefined, toCustomerDisplay: () => undefined, toPlatform: () => undefined,
      toOwner: (id: string, event: string, payload: any) => sent.push({ room: 'owner', id, event, payload }),
      toTechnician: (id: string, event: string, payload: any) => sent.push({ room: 'technician', id, event, payload }),
    } as never };
  };

  it('every technician on the period is told, in their OWN room', async () => {
    const repo = new FakeRepo(PIN_HASH, withLines([line('tech-1'), line('tech-2')]));
    const { sent, rt } = rtSpy();
    await new OwnerService(repo, rt, new FakePayroll() as any).approvePayroll(ownerCtx(), 'p2', '1357');
    const toTechs = sent.filter((s) => s.room === 'technician');
    expect(toTechs.map((s) => s.id).sort()).toEqual(['tech-1', 'tech-2']);
    expect(toTechs.every((s) => s.event === 'technician_earnings_updated')).toBe(true);
  });

  it('the owner event still fires — this ADDS an audience, it does not move one', async () => {
    const repo = new FakeRepo(PIN_HASH, withLines([line('tech-1')]));
    const { sent, rt } = rtSpy();
    await new OwnerService(repo, rt, new FakePayroll() as any).approvePayroll(ownerCtx(), 'p2', '1357');
    expect(sent.some((s) => s.room === 'owner' && s.event === 'owner_payroll_updated')).toBe(true);
  });

  it('a technician appearing on two lines is told ONCE, not twice', async () => {
    const repo = new FakeRepo(PIN_HASH, withLines([line('tech-1'), line('tech-1')]));
    const { sent, rt } = rtSpy();
    await new OwnerService(repo, rt, new FakePayroll() as any).approvePayroll(ownerCtx(), 'p2', '1357');
    expect(sent.filter((s) => s.room === 'technician')).toHaveLength(1);
  });

  it('ids only — no money rides the event', async () => {
    const repo = new FakeRepo(PIN_HASH, withLines([line('tech-1')]));
    const { sent, rt } = rtSpy();
    await new OwnerService(repo, rt, new FakePayroll() as any).approvePayroll(ownerCtx(), 'p2', '1357');
    const payload = sent.find((s) => s.room === 'technician')!.payload;
    expect(JSON.stringify(payload)).not.toMatch(/Cents|600|payable/i);
    expect(payload.periodId).toBe('p2');
  });

  it('locking and reopening notify too — all three change what a tech is owed', async () => {
    for (const [method, pin] of [['lockPayroll', '1357'], ['reopenPayroll', '1357']] as const) {
      const repo = new FakeRepo(PIN_HASH, withLines([line('tech-1')]));
      const { sent, rt } = rtSpy();
      await (new OwnerService(repo, rt, new FakePayroll() as any) as any)[method](ownerCtx(), 'p2', pin);
      expect(sent.some((s) => s.room === 'technician'), method).toBe(true);
    }
  });

  it('a period with no lines notifies nobody rather than throwing', async () => {
    const repo = new FakeRepo(PIN_HASH, withLines([]));
    const { sent, rt } = rtSpy();
    await new OwnerService(repo, rt, new FakePayroll() as any).approvePayroll(ownerCtx(), 'p2', '1357');
    expect(sent.filter((s) => s.room === 'technician')).toHaveLength(0);
  });
});
