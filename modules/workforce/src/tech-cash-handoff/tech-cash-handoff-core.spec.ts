// tech-cash-handoff-core.spec.ts — Nest-free harness for TechCashHandoffService. Fake repo + fake realtime exercise the
// technician-side guards (must be a technician; nothing to hand off), the POS day-board aggregation, and the reconcile
// variance flow (reconciled vs discrepancy → tenant + technician events + a discrepancy alert). esbuild + node, ok() style.
import { TechCashHandoffService } from './tech-cash-handoff.service';
import { TechCashHandoffError, TechCashHandoffVersionConflict, TCH_EVENTS, CashHandoff, CashHandoffDetail, HandoffStatus } from './tech-cash-handoff.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof TechCashHandoffError && e.code === code); }
}

const TECH = '22222222-2222-4222-8222-222222222222';

function detail(over: Partial<CashHandoffDetail> = {}): CashHandoffDetail {
  return {
    technicianId: TECH, technicianName: 'Ava', businessDate: '2026-06-18', expectedCents: 4000, paymentCount: 2,
    countedCents: null, varianceCents: null, status: 'open' as HandoffStatus, lines: [], ...over,
  };
}

// Fake repo. `techId`/`expectedCents` are configurable; reconcile derives status/variance from counted vs expected.
function makeRepo(opts: { techId?: string | null; expectedCents?: number } = {}) {
  const techId = opts.techId === undefined ? TECH : opts.techId;
  const expectedCents = opts.expectedCents ?? 4000;
  const audits: any[] = []; const alerts: any[] = []; const submits: any[] = [];
  const exp = { expectedCents, paymentCount: 2, lines: [] as any[] };
  return {
    audits, alerts, submits,
    async resolveTechnicianId() { return techId; },
    async expectedCashForTech() { return exp; },
    async handoffForTech() { return detail({ expectedCents }); },
    async listForDay(): Promise<CashHandoff[]> {
      return [
        { technicianId: 'a', technicianName: 'A', businessDate: '2026-06-18', expectedCents: 5000, paymentCount: 2, countedCents: 5000, varianceCents: 0, status: 'reconciled' },
        { technicianId: 'b', technicianName: 'B', businessDate: '2026-06-18', expectedCents: 3000, paymentCount: 1, countedCents: null, varianceCents: null, status: 'submitted' },
        { technicianId: 'c', technicianName: 'C', businessDate: '2026-06-18', expectedCents: 2000, paymentCount: 1, countedCents: 1500, varianceCents: -500, status: 'discrepancy' },
      ];
    },
    async submit(_c: any, tid: string, d: string, e: any) { submits.push({ tid, d, e }); },
    counted: null as number | null, version: 1, resolved: null as string | null, status: 'open' as HandoffStatus,
    async reconcile(this: any, _c: any, _tid: string, _d: string, e: { expectedCents: number }, counted: number, _n: string | null, opts: any = {}) {
      // the real repository: version check, partial accumulation, one event per idempotency key
      if (opts.expectedVersion != null && opts.expectedVersion !== this.version) throw new TechCashHandoffVersionConflict(this.version, this.counted, this.status);
      const total = opts.mode === 'add' ? (this.counted ?? 0) + counted : counted;
      const varianceCents = total - e.expectedCents;
      const status: HandoffStatus = varianceCents === 0 ? 'reconciled' : 'discrepancy';
      this.counted = total; this.version += 1; this.status = status; this.resolved = null;
      return { status, varianceCents, countedCents: total, version: this.version, eventId: 'ev', drawerMovementId: opts.transferToDrawer ? 'mv' : null, replayed: false };
    },
    async resolve(this: any, _c: any, _tid: string, _d: string, reason: string, expectedVersion: number | null) {
      if (expectedVersion != null && expectedVersion !== this.version) throw new TechCashHandoffVersionConflict(this.version, this.counted, this.status);
      if (this.status !== 'discrepancy') throw new TechCashHandoffError('not_under_review', 'Only a hand-off under review can be resolved.', 409);
      this.status = 'reconciled'; this.resolved = reason; this.version += 1;
      return { version: this.version, varianceCents: (this.counted ?? 0) - (expectedCents) };
    },
    async audit(_c: any, action: string, entityId: string | null, metadata: any) { audits.push({ action, entityId, metadata }); },
    async alert(_c: any, severity: string, code: string, message: string, meta: any) { alerts.push({ severity, code, message, meta }); },
  };
}

function makeRealtime() {
  const tenant: any[] = []; const tech: any[] = [];
  return { tenant, tech, toTenant: (_c: any, e: string, p: any) => tenant.push({ e, p }), toTechnician: (id: string, e: string, p: any) => tech.push({ id, e, p }) };
}

const identityLess = { tenantId: '', userId: '', role: 'STAFF', permissions: [] as string[] };
const viewer = { tenantId: 't1', userId: 'u1', role: 'STAFF', permissions: ['pos.reports.view'] };
const cashier = { tenantId: 't1', userId: 'u1', role: 'STAFF', permissions: ['pos.checkout.take_payment'] };

(async () => {
  // ---- technician-side guards ----
  await throwsCode('techMyHandoff requires a technician account', () => new TechCashHandoffService(makeRepo({ techId: null }) as any).techMyHandoff(cashier), 'not_a_technician');
  await throwsCode('techSubmit requires a technician account', () => new TechCashHandoffService(makeRepo({ techId: null }) as any).techSubmit(cashier), 'not_a_technician');
  await throwsCode('techSubmit blocks when there is no cash', () => new TechCashHandoffService(makeRepo({ expectedCents: 0 }) as any).techSubmit(cashier), 'no_cash');
  {
    const repo = makeRepo({ expectedCents: 4000 }); const rt = makeRealtime();
    const d = await new TechCashHandoffService(repo as any, rt as any).techSubmit(cashier, '2026-06-18');
    ok('techSubmit records the hand-off + audit + event', repo.submits.length === 1 && repo.audits.some((a) => a.action === 'tech_cash_handoff_submitted') && rt.tenant.some((e) => e.e === TCH_EVENTS.handoffSubmitted));
    ok('techSubmit returns the detail', d.technicianId === TECH);
  }

  // ---- POS day board ----
  await throwsCode('posList denied for identity-less ctx', () => new TechCashHandoffService(makeRepo() as any).posList(identityLess), 'forbidden');
  {
    const board = await new TechCashHandoffService(makeRepo() as any).posList(viewer, '2026-06-18');
    ok('posList totals expected cash', board.totalExpectedCents === 10000);
    ok('posList totals counted cash (nulls as 0)', board.totalCountedCents === 6500);
    ok('posList counts reconciled (incl. discrepancy) vs open', board.reconciledCount === 2 && board.openCount === 1 && board.technicianCount === 3);
  }

  // ---- posTechDetail + posReconcile guards ----
  await throwsCode('posTechDetail denied without view', () => new TechCashHandoffService(makeRepo() as any).posTechDetail(identityLess, TECH), 'forbidden');
  await throwsCode('posTechDetail rejects a non-uuid technician', () => new TechCashHandoffService(makeRepo() as any).posTechDetail(viewer, 'nope'), 'bad_request');
  await throwsCode('posReconcile denied without take_payment', () => new TechCashHandoffService(makeRepo() as any).posReconcile(viewer, TECH, { countedCents: 4000 }), 'forbidden');
  await throwsCode('posReconcile rejects a non-uuid technician', () => new TechCashHandoffService(makeRepo() as any).posReconcile(cashier, 'nope', { countedCents: 4000 }), 'bad_request');
  await throwsCode('posReconcile rejects a negative count', () => new TechCashHandoffService(makeRepo() as any).posReconcile(cashier, TECH, { countedCents: -1 }), 'bad_amount');

  // ---- reconcile variance flow ----
  {
    const repo = makeRepo({ expectedCents: 4000 }); const rt = makeRealtime();
    await new TechCashHandoffService(repo as any, rt as any).posReconcile(cashier, TECH, { countedCents: 4000 });
    ok('exact count reconciles, no alert', rt.tenant.some((e) => e.e === TCH_EVENTS.handoffReconciled) && !rt.tenant.some((e) => e.e === TCH_EVENTS.handoffDiscrepancy) && repo.alerts.length === 0);
    ok('reconcile notifies the technician too', rt.tech.some((e) => e.id === TECH && e.e === TCH_EVENTS.handoffReconciled));
  }
  {
    const repo = makeRepo({ expectedCents: 4000 }); const rt = makeRealtime();
    await new TechCashHandoffService(repo as any, rt as any).posReconcile(cashier, TECH, { countedCents: 3500 }); // -500 short
    ok('short count flags discrepancy + "short" alert', rt.tenant.some((e) => e.e === TCH_EVENTS.handoffDiscrepancy) && repo.alerts.length === 1 && /short/.test(repo.alerts[0].message) && repo.alerts[0].meta.varianceCents === -500);
  }
  {
    const repo = makeRepo({ expectedCents: 4000 }); const rt = makeRealtime();
    await new TechCashHandoffService(repo as any, rt as any).posReconcile(cashier, TECH, { countedCents: 4600 }); // +600 over
    ok('over count flags an "over" alert', repo.alerts.length === 1 && /over/.test(repo.alerts[0].message) && repo.alerts[0].meta.varianceCents === 600);
  }

  // ---- End-of-Day Cash (Oct 29 2026): partial hand-offs, count sheet, version conflict, resolution ----
  {
    const repo = makeRepo({ expectedCents: 30000 }); const svc = new TechCashHandoffService(repo as any, makeRealtime() as any);
    const a = await svc.posReconcile(cashier, TECH, { countedCents: 20000, mode: 'add' });
    const b = await svc.posReconcile(cashier, TECH, { countedCents: 10000, mode: 'add', expectedVersion: a.result.version });
    ok('two partial hand-offs ($200 + $100) reconcile $300 exactly once', a.result.status === 'discrepancy' && a.result.varianceCents === -10000 && b.result.status === 'reconciled' && b.result.varianceCents === 0 && repo.counted === 30000);
    await throwsCode('a stale version is refused (another counter saved first)', () => svc.posReconcile(cashier, TECH, { countedCents: 30000, expectedVersion: 1 }), 'version_conflict');
    await throwsCode('a count sheet that does not add up is refused', () => svc.posReconcile(cashier, TECH, { countedCents: 30000, denominations: [{ denominationCents: 10000, quantity: 2 }] }), 'bad_amount');
    const c = await svc.posReconcile(cashier, TECH, { countedCents: 30000, denominations: [{ denominationCents: 10000, quantity: 2 }, { denominationCents: 5000, quantity: 2 }], transferToDrawer: true });
    ok('a matching count sheet counts; the drawer transfer is linked', c.result.status === 'reconciled' && c.result.drawerMovementId === 'mv');
  }
  {
    const repo = makeRepo({ expectedCents: 4000 }); const svc = new TechCashHandoffService(repo as any, makeRealtime() as any);
    const manager = { ...cashier, permissions: [...cashier.permissions, 'checkout.manage_overrides'] };
    await throwsCode('resolve needs a manager', () => svc.posResolve(cashier, TECH, { reason: 'x' }), 'forbidden');
    await throwsCode('resolve needs a reason', () => svc.posResolve(manager, TECH, { reason: '' }), 'bad_request');
    await throwsCode('a balanced (not under review) unit cannot be resolved', async () => { await svc.posReconcile(cashier, TECH, { countedCents: 4000 }); await svc.posResolve(manager, TECH, { reason: 'x' }); }, 'not_under_review');
    await svc.posReconcile(cashier, TECH, { countedCents: 3500 });
    await svc.posResolve(manager, TECH, { reason: 'Recounted with the technician; $5 found in the tip jar' });
    ok('a shortage under review is resolved with a reason and the figures stay', repo.status === 'reconciled' && repo.resolved !== null && repo.counted === 3500 && repo.audits.some((a) => a.action === 'tech_cash_handoff_resolved'));
  }

  console.log(`\ntech-cash-handoff-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
