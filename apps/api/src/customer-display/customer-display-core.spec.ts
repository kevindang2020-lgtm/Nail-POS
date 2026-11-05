// customer-display-core.spec.ts — Nest-free harness for CustomerDisplayService (the kiosk's backend brain). A fake data
// port + fake realtime exercise the session public-token auth (constant-time verify), the state derivation that mirrors the
// ticket's real status, the validated customer tip, the pay-button gate, payment-method selection, and device-token mode.
// Backend stays the money source of truth. esbuild + node, ok() style. Pairs with the frontend audit (CUSTOMER_DISPLAY_AUDIT.md).
import { createHash } from 'node:crypto';
import { CustomerDisplayService, DisplayError } from './customer-display.service';
import { DEFAULT_CHECKOUT_SETTINGS, CheckoutSettings, buildCustomerDisplayCheckout, computeTotals } from '@aipowersalon/checkout';
import type { DisplaySessionRow } from './customer-display.repository';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof DisplayError && e.code === code); }
}

const TOKEN = 'good-token';
const HASH = createHash('sha256').update(TOKEN).digest('hex');

function makeRow(over: Partial<DisplaySessionRow> = {}): DisplaySessionRow {
  return {
    id: 'sess1', tenantId: 't1', branchId: 'b1', state: 'ticket_review', ticketId: 'tk1', ticketNumber: '001',
    customerId: 'c1', publicTokenHash: HASH, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: null,
    expiresAt: null, closedAt: null, ticketStatus: 'serving', lastPaymentStatus: null, ...over,
  };
}

type Opts = { row?: DisplaySessionRow | null; settings?: Partial<CheckoutSettings>; device?: any; deviceSession?: DisplaySessionRow | null; giftCardCharge?: number };
function makeRepo(o: Opts = {}) {
  const row = o.row === undefined ? makeRow() : o.row;
  const settings = { ...DEFAULT_CHECKOUT_SETTINGS, ...(o.settings || {}) };
  const giftCardCharge = o.giftCardCharge ?? 0;
  const tips: any[] = []; const methods: any[] = []; const payReqs: string[] = []; const ratings: any[] = [];
  const ticketTips: any[] = []; const ticketMethods: any[] = [];
  let ticketTip = 0; let ticketMethod: string | null = null;
  return {
    tips, methods, payReqs, ratings, ticketTips, ticketMethods,
    async getSession() { return row; },
    // 23-inch spec §35/§38: the display's money now comes from the TICKET's projection (built by the checkout module).
    // This fake keeps a ticket — one $50 line, the tip/method the display wrote to it, the gift-card sale — and projects
    // it with the real builder, exactly as KyselyCheckoutRepository does from Postgres.
    async checkoutProjection() {
      if (!row?.ticketId) return null;
      const method = (ticketMethod ?? row.paymentMethod ?? 'card') as any;
      const totals = computeTotals(row.subtotalCents, ticketTip, settings, method, giftCardCharge);
      return buildCustomerDisplayCheckout({ ticketNumber: '#' + (row.ticketNumber ?? ''), createdAt: '2026-10-06T15:00:00.000Z', ticketStatus: row.ticketStatus ?? 'ready_for_payment',
        lines: [{ serviceName: 'Gel Manicure', technicianName: 'Olivia Tran', priceCents: row.subtotalCents }], discountCents: 0, totals, payments: [] });
    },
    async salonName() { return 'Luxe Nails'; },
    async customerFirstName() { return 'Dana'; },
    async applyTip(id: string, tipCents: number, _s?: number, _t?: number, _su?: number, _td?: number, meta?: any) { tips.push({ id, tipCents, meta }); if (row) { row.state = 'tip_selected'; row.selectedTipCents = tipCents; } },
    async setTicketTipFromDisplay(r: any, tipCents: number, meta: any) { ticketTips.push({ ticketId: r.ticketId, tipCents, meta }); ticketTip = tipCents; },
    async setTicketMethodFromDisplay(r: any, method: string) { ticketMethods.push({ ticketId: r.ticketId, method }); ticketMethod = method; },
    async applyMethod(id: string, method: string) { methods.push({ id, method }); },
    async resolveSettings() { return settings; },
    async markPaymentRequested(id: string) { payReqs.push(id); },
    async recordSatisfaction(tenantId: string, ticketId: string, rating: number) { ratings.push({ tenantId, ticketId, rating }); },
    async deviceByToken() { return o.device === undefined ? null : o.device; },
    async currentSessionForDevice() { return o.deviceSession === undefined ? null : o.deviceSession; },
  };
}
const rt = { toCustomerDisplay: () => {}, toTenant: () => {} };
const svc = (o: Opts = {}) => new CustomerDisplayService(makeRepo(o) as any, rt as any);

(async () => {
  // ---- session public-token auth ----
  await throwsCode('getState 404 when the session is missing', () => svc({ row: null }).getState('sess1', TOKEN), 'not_found');
  await throwsCode('getState forbids a wrong token', () => svc().getState('sess1', 'wrong'), 'forbidden');
  await throwsCode('getState forbids a missing token', () => svc().getState('sess1', undefined), 'forbidden');
  {
    const s = await svc().getState('sess1', TOKEN);
    ok('getState returns the assembled state for a valid token', s.state === 'ticket_review' && s.salonName === 'Luxe Nails' && s.payButtonEnabled === false);
  }
  {
    const base = await svc().getState('sess1', TOKEN);
    const withGc = await svc({ giftCardCharge: 5000 }).getState('sess1', TOKEN);
    ok('display total includes the gift-card charge, untaxed', withGc.totals.totalDueCents === base.totals.totalDueCents + 5000 && withGc.totals.giftCardChargeCents === 5000);
  }
  {
    const good = await svc().canAccess('sess1', TOKEN); const bad = await svc().canAccess('sess1', 'wrong');
    ok('canAccess gates the SSE stream by token', good === true && bad === false);
  }

  // ---- state derivation mirrors the ticket's real status ----
  ok('paid ticket → payment_success', (await svc({ row: makeRow({ ticketStatus: 'paid' }) }).getState('sess1', TOKEN)).state === 'payment_success');
  ok('elapsed session → expired', (await svc({ row: makeRow({ expiresAt: '2000-01-01T00:00:00.000Z' }) }).getState('sess1', TOKEN)).state === 'expired');
  ok('failed state → payment_failed', (await svc({ row: makeRow({ state: 'payment_failed' }) }).getState('sess1', TOKEN)).state === 'payment_failed');
  ok('declined charge while processing → payment_failed', (await svc({ row: makeRow({ state: 'payment_processing', lastPaymentStatus: 'declined' }) }).getState('sess1', TOKEN)).state === 'payment_failed');

  // ---- customer tip: state guard + validation + happy path ----
  await throwsCode('tip rejected once past review', () => svc({ row: makeRow({ state: 'payment_processing' }) }).submitTip('sess1', TOKEN, { tipType: 'none' }), 'invalid');
  await throwsCode('tip rejects an unknown tipType', () => svc().submitTip('sess1', TOKEN, {} as any), 'invalid');
  await throwsCode('percent tip requires a percent', () => svc().submitTip('sess1', TOKEN, { tipType: 'percent' }), 'invalid');
  await throwsCode('custom tip over the max is rejected', () => svc({ settings: { maxTipPercent: 50 } }).submitTip('sess1', TOKEN, { tipType: 'custom', amountCents: 999999 }), 'invalid');
  {
    const repo = makeRepo(); const s = await new CustomerDisplayService(repo as any, rt as any).submitTip('sess1', TOKEN, { tipType: 'percent', percent: 15 });
    ok('percent tip selects tip_selected + persists 15% of subtotal', s.state === 'tip_selected' && s.selectedTipCents === 750 && repo.tips.length === 1 && repo.tips[0].tipCents === 750);
    ok('the tip reaches the TICKET, and the state shows the ticket\'s tip', repo.ticketTips.length === 1 && repo.ticketTips[0].tipCents === 750 && s.totals.tipCents === 750 && s.checkout?.tipCents === 750);
  }

  // ---- pay button gate (off by default) ----
  await throwsCode('requestPayment blocked when the pay button is off', () => svc().requestPayment('sess1', TOKEN), 'invalid');
  {
    const repo = makeRepo({ settings: { customerDisplayPayButtonEnabled: true } });
    const s = await new CustomerDisplayService(repo as any, rt as any).requestPayment('sess1', TOKEN);
    ok('requestPayment marks processing when enabled', s.state === 'payment_processing' && repo.payReqs.length === 1);
  }

  // ---- payment method selection ----
  await throwsCode('method must be card or cash', () => svc().submitMethod('sess1', TOKEN, 'crypto'), 'invalid');
  {
    const repo = makeRepo(); await new CustomerDisplayService(repo as any, rt as any).submitMethod('sess1', TOKEN, 'cash');
    ok('choosing cash persists the method', repo.methods.length === 1 && repo.methods[0].method === 'cash');
    ok('…on the TICKET too, so the POS and the display show one total', repo.ticketMethods.length === 1 && repo.ticketMethods[0].method === 'cash');
  }

  // ---- post-payment satisfaction rating: token + state guard + range + happy path ----
  await throwsCode('rating forbids a wrong token', () => svc({ row: makeRow({ ticketStatus: 'paid' }) }).submitRating('sess1', 'wrong', 5), 'forbidden');
  await throwsCode('rating rejected before payment', () => svc({ row: makeRow({ state: 'ticket_review' }) }).submitRating('sess1', TOKEN, 5), 'invalid');
  await throwsCode('rating rejects out-of-range', () => svc({ row: makeRow({ ticketStatus: 'paid' }) }).submitRating('sess1', TOKEN, 9), 'invalid');
  await throwsCode('rating rejects zero', () => svc({ row: makeRow({ ticketStatus: 'paid' }) }).submitRating('sess1', TOKEN, 0), 'invalid');
  {
    const repo = makeRepo({ row: makeRow({ ticketStatus: 'paid' }) });
    const s = await new CustomerDisplayService(repo as any, rt as any).submitRating('sess1', TOKEN, 4);
    ok('rating after payment persists to the ticket', repo.ratings.length === 1 && repo.ratings[0].rating === 4 && repo.ratings[0].ticketId === 'tk1' && s.state === 'payment_success');
  }

  // ---- device-token mode ----
  await throwsCode('device state forbids an unpaired token', () => svc().getDeviceState('no-device'), 'forbidden');
  {
    const withSession = await svc({ device: { id: 'd1', tenantId: 't1', branchId: 'b1' }, deviceSession: makeRow() }).getDeviceState('tok');
    const idle = await svc({ device: { id: 'd1', tenantId: 't1', branchId: 'b1' }, deviceSession: null }).getDeviceState('tok');
    ok('paired device shows its session, else an idle screen', withSession.state === 'ticket_review' && idle.state === 'idle');
  }

  // ---- no signature on the display (Kevin, Oct 6 2026: the cardholder signs once, on the Clover card terminal) ----
  {
    const paid = await svc({ row: makeRow({ ticketStatus: 'paid' }) }).getState('sess1', TOKEN);
    ok('a paid card ticket never asks the display for a signature', paid.state === 'payment_success' && !('signatureRequired' in paid) && !('signatureCaptured' in paid));
    const proto = CustomerDisplayService.prototype as any;
    ok('the display has no signature to submit any more', proto.submitSignature === undefined && proto.submitSignatureForDevice === undefined);
  }

  console.log(`\ncustomer-display-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
