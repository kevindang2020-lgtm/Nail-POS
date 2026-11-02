// cash-drawer-core.spec.ts — Nest-free harness for CashDrawerService. A fake repo + fake realtime bus exercise the
// money-operation guards (every mutating call is permission-gated, amounts/direction validated) and the reconcile
// variance flow (reconciled vs discrepancy → the right realtime event + a discrepancy alert). esbuild + node, ok() style.
import { CashDrawerService } from './cash-drawer.service';
import { CashDrawerError, DRAWER_EVENTS, DrawerState, DrawerStatus } from './cash-drawer.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof CashDrawerError && e.code === code); }
}

const BRANCH = '11111111-1111-4111-8111-111111111111';
const EXPECTED = 10000; // fake repo's expected cash for the day

function makeState(over: Partial<DrawerState> = {}): DrawerState {
  return {
    branchId: BRANCH, businessDate: '2026-06-18', openingFloatCents: 5000, expectedSalesCents: 6000, refundsCents: 1000,
    paidInCents: 0, paidOutCents: 0, expectedCashCents: EXPECTED, countedCents: null, varianceCents: null,
    cashPaymentCount: 3, status: 'open' as DrawerStatus, openedAt: null, reconciledAt: null, notes: null, ...over,
  };
}

// Fake repo: records audits; reconcile derives variance/status from the counted amount vs EXPECTED.
function makeRepo() {
  const audits: any[] = []; const alerts: any[] = []; let lastOpenFloat: number | null = null;
  return {
    audits, alerts, get lastOpenFloat() { return lastOpenFloat; },
    async ownerList() { return { businessDate: '2026-06-18', branches: [] }; },
    async state() { return makeState(); },
    // Decision 18 (migration 478) added registerId to the port; this fake kept the old signature, so the float landed in
    // the date slot and these checks failed silently in the harness from Sep 28 (re-aligned Oct 1).
    async open(_c: any, _b: string, _r: string, _d: string, float: number) { lastOpenFloat = float; },
    async audit(_c: any, action: string, _b: string, meta: any) { audits.push({ action, meta }); },
    async addMovement() { /* no-op */ },
    async voidMovement() { return true; },
    async listMovements() { return []; },
    async reconcile(_c: any, _b: string, _r: string, _d: string, counted: number) {
      const varianceCents = counted - EXPECTED;
      const status: DrawerStatus = varianceCents === 0 ? 'reconciled' : 'discrepancy';
      return { status, expectedCashCents: EXPECTED, varianceCents, openingFloatCents: 5000, salesCents: 6000, refundsCents: 1000 };
    },
    async alert(_c: any, level: string, title: string, message: string, _b: string, meta: any) { alerts.push({ level, title, message, meta }); },
  };
}

function makeRealtime() { const events: any[] = []; return { events, toTenant: (_c: any, event: string, payload: any) => events.push({ event, payload }) }; }

const staff = { tenantId: 't1', branchId: BRANCH, userId: 'u1', role: 'STAFF', permissions: [] as string[] };
const noView = { tenantId: '', branchId: BRANCH, userId: '', role: 'STAFF', permissions: [] as string[] };
const cashier = { ...staff, permissions: ['pos.checkout.take_payment'] };
// BUILD_PLAN Phase 9: an owner is admitted by the capability its session carries (checkout.process_payment), not by its
// role's NAME; an OWNER-role token without it (the key DENIED) is refused like anyone else.
const owner = { ...staff, role: 'OWNER', permissions: ['checkout.process_payment'] };
const ownerDenied = { ...staff, role: 'OWNER', permissions: [] as string[] };
const badBranch = { ...cashier, branchId: 'not-a-uuid' };

(async () => {
  const svc = () => new CashDrawerService(makeRepo() as any, makeRealtime() as any);

  // ---- permission gating: mutations require pos.checkout.take_payment (OWNER/SUPER_ADMIN bypass) ----
  await throwsCode('openDrawer denied without take_payment', () => svc().openDrawer(staff, { openingFloatCents: 5000 }), 'forbidden');
  await throwsCode('addMovement denied without take_payment', () => svc().addMovement(staff, { direction: 'in', amountCents: 100 }), 'forbidden');
  await throwsCode('voidMovement denied without take_payment', () => svc().voidMovement(staff, { movementId: 'm1' }), 'forbidden');
  await throwsCode('reconcileDrawer denied without take_payment', () => svc().reconcileDrawer(staff, { countedCents: 9000 }), 'forbidden');
  // view requires SOME access — an identity-less ctx is denied
  await throwsCode('getDrawer denied for identity-less ctx', () => svc().getDrawer(noView), 'forbidden');

  // ---- branch + amount validation ----
  await throwsCode('openDrawer rejects non-uuid branch', () => svc().openDrawer(badBranch, { openingFloatCents: 5000 }), 'no_branch');
  await throwsCode('openDrawer rejects negative float', () => svc().openDrawer(cashier, { openingFloatCents: -1 }), 'bad_amount');
  await throwsCode('addMovement requires a direction', () => svc().addMovement(cashier, { amountCents: 100 }), 'bad_direction');
  await throwsCode('addMovement rejects non-positive amount', () => svc().addMovement(cashier, { direction: 'in', amountCents: 0 }), 'bad_amount');
  await throwsCode('voidMovement requires a movement id', () => svc().voidMovement(cashier, {}), 'bad_request');
  await throwsCode('reconcile rejects negative count', () => svc().reconcileDrawer(cashier, { countedCents: -5 }), 'bad_amount');

  // ---- Phase 9: no OWNER shortcut — the owner's session capability admits it; an OWNER-role token without it does not ----
  await throwsCode('OWNER-role token with checkout.process_payment DENIED cannot open the drawer', () => svc().openDrawer(ownerDenied, { openingFloatCents: 5000 }), 'forbidden');
  {
    const repo = makeRepo(); const rt = makeRealtime();
    const s = await new CashDrawerService(repo as any, rt as any).openDrawer(owner, { openingFloatCents: 5000 });
    ok('OWNER may open the drawer (its session capability)', s.status === 'open' && s.branchId === BRANCH);
    ok('open writes an audit + emits opened event', repo.audits.some((a) => a.action === 'cash_drawer_opened') && rt.events.some((e) => e.event === DRAWER_EVENTS.opened));
    ok('open passes the float through to the repo', repo.lastOpenFloat === 5000);
  }

  // ---- reconcile: counted == expected → reconciled, no alert ----
  {
    const repo = makeRepo(); const rt = makeRealtime();
    await new CashDrawerService(repo as any, rt as any).reconcileDrawer(cashier, { countedCents: EXPECTED });
    ok('exact count reconciles (no discrepancy event)', rt.events.some((e) => e.event === DRAWER_EVENTS.reconciled) && !rt.events.some((e) => e.event === DRAWER_EVENTS.discrepancy));
    ok('exact count raises no alert', repo.alerts.length === 0);
  }

  // ---- reconcile: short and over both flag a discrepancy + alert with the right wording ----
  {
    const repo = makeRepo(); const rt = makeRealtime();
    await new CashDrawerService(repo as any, rt as any).reconcileDrawer(cashier, { countedCents: 9000 }); // -1000 short
    ok('short count flags discrepancy event', rt.events.some((e) => e.event === DRAWER_EVENTS.discrepancy));
    ok('short count raises a "short" discrepancy alert', repo.alerts.length === 1 && /short/.test(repo.alerts[0].message) && repo.alerts[0].meta.varianceCents === -1000);
  }
  {
    const repo = makeRepo(); const rt = makeRealtime();
    await new CashDrawerService(repo as any, rt as any).reconcileDrawer(cashier, { countedCents: 12000 }); // +2000 over
    ok('over count raises an "over" discrepancy alert', repo.alerts.length === 1 && /over/.test(repo.alerts[0].message) && repo.alerts[0].meta.varianceCents === 2000);
  }

  console.log(`\ncash-drawer-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
