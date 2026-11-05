// skip-line-checkout-core.spec.ts — Nest-free harness for SkipLineCheckoutService's cash-to-technician flow. A fake repo +
// fake realtime exercise the customer/technician guards, the feature/cash settings gates, ownership + already-paid checks,
// the two happy paths (customer selects cash → pending; technician confirms → ticket paid + loyalty), and the manager
// override that lets a take_payment holder confirm cash on a ticket not assigned to them. esbuild + node, ok() style.
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { SkipLineError, SLC_EVENTS, Bill, SkipLineSettings } from './skip-line-checkout.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof SkipLineError && e.code === code); }
}

const CUST = 'cust-1', TECH = 'tech-1', OTHER = 'tech-2';

const DEFAULT_SETTINGS: SkipLineSettings = {
  featureEnabled: true, autoSendPromptOnServiceDone: true, requireFrontDeskApproval: false,
  allowCashToTechnician: true, requireTechConfirmationForCash: true, managerApprovalOverCents: 0,
};
function makeBill(over: Partial<Bill> = {}): Bill {
  return {
    ticketId: 'tk1', invoiceId: 'tk1', ticketNumber: '001', customerId: CUST, customerName: 'Dana',
    technicianId: TECH, technicianName: 'Ava', services: [], subtotalCents: 4500, discountCents: 0, taxCents: 500,
    tipCents: 500, totalDueCents: 5000, ticketStatus: 'serving', paid: false, ...over,
  };
}

type Opts = {
  customerId?: string | null; technicianId?: string | null; settings?: Partial<SkipLineSettings>;
  bill?: Bill | null; conf?: any; intent?: any; loyalty?: { awarded: number; balance: number } | null;
};
function makeRepo(o: Opts = {}) {
  const customerId = o.customerId === undefined ? CUST : o.customerId;
  const technicianId = o.technicianId === undefined ? TECH : o.technicianId;
  const settings = { ...DEFAULT_SETTINGS, ...(o.settings || {}) };
  const bill = o.bill === undefined ? makeBill() : o.bill;
  const conf = o.conf === undefined ? { id: 'conf1', technician_id: TECH, payment_intent_id: 'int1' } : o.conf;
  const intent = o.intent === undefined ? { id: 'int1', status: 'cash_pending_tech_confirmation', amount_cents: 5000, method: 'cash_to_technician', customer_id: CUST } : o.intent;
  const loyalty = o.loyalty === undefined ? { awarded: 10, balance: 110 } : o.loyalty;
  const audits: any[] = [];
  return {
    audits,
    async resolveCustomerId() { return customerId; },
    async resolveTechnicianId() { return technicianId; },
    async getSettings() { return settings; },
    async activeBillForCustomer() { return bill; },
    async billForTicket() { return bill; },
    async createIntent() { return { id: 'int1' }; },
    async createCashConfirmation() { return { id: 'conf1' }; },
    async getIntent() { return intent; },
    async cashPendingForTechnician() { return []; },
    async pendingCashForTicket() { return conf; },
    async recordPaymentAndCloseTicket() { return { paymentId: 'pay1' }; },
    async setIntentStatus() { /* no-op */ },
    async setCashConfirmationStatus() { /* no-op */ },
    async awardLoyaltyForPayment() { return loyalty; },
    async audit(_c: any, action: string, ticketId: string, meta: any) { audits.push({ action, ticketId, meta }); },
  };
}
function makeRealtime() {
  const tenant: any[] = []; const tech: any[] = []; const customer: any[] = [];
  return { tenant, tech, customer, toTenant: (_c: any, e: string) => tenant.push(e), toTechnician: (_id: string, e: string) => tech.push(e), toCustomer: (_id: string, e: string) => customer.push(e) };
}

const ctx = { tenantId: 't1', branchId: null, userId: 'u1', role: 'STAFF', permissions: [] as string[] };
const mgr = { ...ctx, permissions: ['pos.checkout.take_payment'] };

(async () => {
  // ---- account-type guards ----
  await throwsCode('customerActiveBill requires a customer', () => new SkipLineCheckoutService(makeRepo({ customerId: null }) as any).customerActiveBill(ctx), 'not_a_customer');
  await throwsCode('payCashToTech requires a customer', () => new SkipLineCheckoutService(makeRepo({ customerId: null }) as any).payCashToTech(ctx, 'tk1'), 'not_a_customer');
  await throwsCode('techCashPending requires a technician', () => new SkipLineCheckoutService(makeRepo({ technicianId: null }) as any).techCashPending(ctx), 'not_a_technician');
  await throwsCode('confirmCashReceived requires a technician', () => new SkipLineCheckoutService(makeRepo({ technicianId: null }) as any).confirmCashReceived(ctx, 'tk1'), 'not_a_technician');

  // ---- settings gates ----
  await throwsCode('payCashToTech blocked when feature off', () => new SkipLineCheckoutService(makeRepo({ settings: { featureEnabled: false } }) as any).payCashToTech(ctx, 'tk1'), 'feature_disabled');
  await throwsCode('payCashToTech blocked when cash-to-tech off', () => new SkipLineCheckoutService(makeRepo({ settings: { allowCashToTechnician: false } }) as any).payCashToTech(ctx, 'tk1'), 'cash_disabled');

  // ---- bill ownership / state ----
  await throwsCode('payCashToTech 404 when no bill', () => new SkipLineCheckoutService(makeRepo({ bill: null }) as any).payCashToTech(ctx, 'tk1'), 'not_found');
  await throwsCode('payCashToTech forbids another customer\'s bill', () => new SkipLineCheckoutService(makeRepo({ bill: makeBill({ customerId: 'someone-else' }) }) as any).payCashToTech(ctx, 'tk1'), 'forbidden');
  await throwsCode('payCashToTech rejects an already-paid bill', () => new SkipLineCheckoutService(makeRepo({ bill: makeBill({ paid: true }) }) as any).payCashToTech(ctx, 'tk1'), 'already_paid');

  // ---- payment status ----
  await throwsCode('paymentStatus 404 when intent missing', () => new SkipLineCheckoutService(makeRepo({ intent: null }) as any).paymentStatus(ctx, 'int1'), 'not_found');
  await throwsCode('paymentStatus forbids another customer\'s intent', () => new SkipLineCheckoutService(makeRepo({ intent: { id: 'int1', status: 'x', amount_cents: 1, method: 'cash', customer_id: 'other' } }) as any).paymentStatus(ctx, 'int1'), 'forbidden');

  // ---- confirm guards ----
  await throwsCode('confirmCashReceived 404 with no pending cash', () => new SkipLineCheckoutService(makeRepo({ conf: null }) as any).confirmCashReceived(ctx, 'tk1'), 'not_found');
  await throwsCode('confirmCashReceived blocks a tech the ticket is not assigned to', () => new SkipLineCheckoutService(makeRepo({ technicianId: TECH, conf: { id: 'conf1', technician_id: OTHER, payment_intent_id: 'int1' } }) as any).confirmCashReceived(ctx, 'tk1'), 'not_assigned');
  await throwsCode('confirmCashReceived rejects an already-paid ticket', () => new SkipLineCheckoutService(makeRepo({ bill: makeBill({ paid: true }) }) as any).confirmCashReceived(ctx, 'tk1'), 'already_paid');

  // ---- happy: customer selects cash → pending ----
  {
    const repo = makeRepo(); const rt = makeRealtime();
    const r = await new SkipLineCheckoutService(repo as any, rt as any).payCashToTech(ctx, 'tk1');
    ok('payCashToTech returns the pending intent + amount', r.intentId === 'int1' && r.confirmationId === 'conf1' && r.amountCents === 5000 && r.status === 'cash_pending_tech_confirmation');
    ok('payCashToTech audits + notifies tenant and technician', repo.audits.some((a) => a.action === 'skip_line_cash_to_tech_selected') && rt.tenant.includes(SLC_EVENTS.cashPending) && rt.tech.includes(SLC_EVENTS.cashPending));
  }

  // ---- happy: technician confirms → paid + loyalty ----
  {
    const repo = makeRepo(); const rt = makeRealtime();
    const r = await new SkipLineCheckoutService(repo as any, rt as any).confirmCashReceived(ctx, 'tk1');
    ok('confirmCashReceived closes the ticket as paid', r.paid === true && r.paymentId === 'pay1' && r.amountCents === 5000 && r.ticketStatus === 'paid');
    ok('confirmCashReceived awards loyalty + emits cashConfirmed', r.loyaltyAwarded === 10 && rt.tenant.includes(SLC_EVENTS.cashConfirmed) && repo.audits.some((a) => a.action === 'skip_line_cash_confirmed'));
  }

  // ---- manager override: take_payment holder may confirm a ticket assigned to another tech ----
  {
    const repo = makeRepo({ technicianId: TECH, conf: { id: 'conf1', technician_id: OTHER, payment_intent_id: 'int1' } }); const rt = makeRealtime();
    const r = await new SkipLineCheckoutService(repo as any, rt as any).confirmCashReceived(mgr, 'tk1');
    ok('manager with take_payment overrides the not-assigned block', r.paid === true && r.paymentId === 'pay1');
  }

  console.log(`\nskip-line-checkout-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
