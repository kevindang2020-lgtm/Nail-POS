/* verify-display-realtime.ts — proves the customer's tip and pay-tap are broadcast to BOTH the device's display room
 * AND the front desk's tenant+branch room, so the POS checkout screen reflects them live. Fast (no DB): a fake data
 * port + a spy emitter that records every emission. */
import { createHash } from 'node:crypto';
import { CustomerDisplayService } from '../src/customer-display/customer-display.service';
import type { DisplayDataPort, DisplaySessionRow } from '../src/customer-display/customer-display.repository';
import type { CheckoutSettings } from '../../../modules/checkout/src/checkout/checkout-display.dto';
import type { RealtimeEmitter } from '../src/realtime/realtime.gateway';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

const TOKEN = 'tok';
const hash = createHash('sha256').update(TOKEN).digest('hex');
const SETTINGS: CheckoutSettings = { creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3, surchargeLabel: 'Card Surcharge', taxRatePercent: 7.75, cashDiscountEnabled: false, defaultTipPercents: [15, 18, 20], customerDisplayPayButtonEnabled: true, maxTipPercent: 100 };
const session: DisplaySessionRow = { id: 's1', tenantId: 't1', branchId: 'b1', state: 'showing_ticket', ticketId: 'tk1', ticketNumber: '#TK1', customerId: 'c1', publicTokenHash: hash, selectedTipCents: 0, subtotalCents: 10000, paymentMethod: 'card', expiresAt: new Date(Date.now() + 600000).toISOString(), closedAt: null, ticketStatus: 'ready_checkout' };

const repo: DisplayDataPort = {
  async getSession() { return { ...session }; },
  async ticketServices() { return [{ serviceName: 'Manicure', priceCents: 10000 }]; },
  async salonName() { return 'Spa'; },
  async customerFirstName() { return 'Pat'; },
  async applyTip() {},
  async resolveSettings() { return SETTINGS; },
  async markPaymentRequested() {},
};

const calls: { room: 'display' | 'tenant'; event: string }[] = [];
const emitter: RealtimeEmitter = {
  toTenant: (_ctx: any, event: any) => { calls.push({ room: 'tenant', event }); },
  toCustomerDisplay: (_id: any, event: any) => { calls.push({ room: 'display', event }); },
  toTechnician: () => {}, toTicket: () => {}, toOwner: () => {},
} as RealtimeEmitter;

(async () => {
  const svc = new CustomerDisplayService(repo, emitter);
  await svc.submitTip('s1', TOKEN, { tipType: 'percent', percent: 20 });
  ok('tip → emitted to the device display room', calls.some((c) => c.room === 'display' && c.event === 'customer_display_tip_selected'));
  ok('tip → ALSO emitted to the POS tenant+branch room', calls.some((c) => c.room === 'tenant' && c.event === 'customer_display_tip_selected'));

  calls.length = 0;
  await svc.requestPayment('s1', TOKEN);
  ok('pay-tap → emitted to the device display room', calls.some((c) => c.room === 'display' && c.event === 'customer_display_payment_requested'));
  ok('pay-tap → ALSO emitted to the POS tenant+branch room', calls.some((c) => c.room === 'tenant' && c.event === 'customer_display_payment_requested'));

  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-display-realtime: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
