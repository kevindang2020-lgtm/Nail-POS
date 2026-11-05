// tech-cash-handoff-core.spec.ts — Nest-free harness for TechCashHandoffService. Fake repo + fake realtime exercise the
// technician-side guards (must be a technician; nothing to hand off), the POS day-board aggregation, and the reconcile
// variance flow (reconciled vs discrepancy → tenant + technician events + a discrepancy alert). esbuild + node, ok() style.
import { TechCashHandoffService } from './tech-cash-handoff.service';
import { TechCashHandoffError, TCH_EVENTS, CashHandoff, CashHandoffDetail, HandoffStatus } from './tech-cash-handoff.dto';

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
    async reconcile(_c: any, _tid: string, _d: string, e: { expectedCents: number }, counted: number) {
      const varianceCents = counted - e.expectedCents;
      const status: HandoffStatus = varianceCents === 0 ? 'reconciled' : 'discrepancy';
      return { status, varianceCents };
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

  console.log(`\ntech-cash-handoff-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
