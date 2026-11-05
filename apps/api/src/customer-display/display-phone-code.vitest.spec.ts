// display-phone-code.vitest.spec.ts — BUILD_PLAN Phase 3: the phone-change code typed on the customer display.
// The display asks the phone service only about the customer of ITS OWN current checkout; the state carries the masked
// number only; a display with no customer in front of it accepts no code.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_CHECKOUT_SETTINGS, buildCustomerDisplayCheckout, computeTotals } from '@aipowersalon/checkout';
import { CustomerDisplayService } from './customer-display.service';
import type { DisplayDataPort, DisplaySessionRow } from './customer-display.repository';

const TOKEN = 'device-token-p';
const DEVICE = { id: 'dev-p', tenantId: 't1', branchId: 'b1' };
const row = (over: Partial<DisplaySessionRow> = {}): DisplaySessionRow => ({
  id: 'sess-p', tenantId: 't1', branchId: 'b1', state: 'showing_ticket', ticketId: 'tk-p', ticketNumber: '#9', customerId: 'c1', publicTokenHash: 'x',
  selectedTipCents: 0, subtotalCents: 5000, paymentMethod: null, expiresAt: new Date(Date.now() + 600_000).toISOString(), closedAt: null,
  ticketStatus: 'ready_for_payment', lastPaymentStatus: null, lastPaymentAt: null, ticketPaidAt: null, changedAtMs: 1, receiptChoice: null, receiptStatus: null, ...over,
} as DisplaySessionRow);

function harness(session: DisplaySessionRow | null) {
  const asked: string[] = []; const typed: string[] = [];
  const repo: Partial<DisplayDataPort> = {
    async deviceByToken(h: string) { return h === createHash('sha256').update(TOKEN).digest('hex') ? DEVICE : null; },
    async currentSessionForDevice() { return session; },
    async getSession() { return session; },
    async resolveSettings() { return { ...DEFAULT_CHECKOUT_SETTINGS }; },
    async checkoutProjection() {
      const totals = computeTotals(5000, 0, DEFAULT_CHECKOUT_SETTINGS, 'cash', 0);
      return buildCustomerDisplayCheckout({ ticketNumber: '#9', createdAt: '2026-10-07T15:00:00.000Z', ticketStatus: 'ready_for_payment', lines: [{ serviceName: 'Pedicure', technicianName: 'Ann', priceCents: 5000 }], discountCents: 0, totals, payments: [] });
    },
    async salonName() { return 'Luxury Nails'; },
    async customerFirstName() { return 'Sophia'; },
  };
  const phone: any = {
    async displayPrompt(_t: string, customerId: string) { asked.push(customerId); return customerId === 'c1' ? { maskedPhone: '••••0199' } : null; },
    async verifyFromDisplay(_t: string, _b: string | null, customerId: string, code: string) { typed.push(`${customerId}:${code}`); return code === '123456' ? { ok: true, message: 'confirmed' } : { ok: false, message: 'wrong' }; },
  };
  const rt: any = { toTenant() {}, toCustomerDisplayDevice() {}, toCustomerDisplay() {}, toTicket() {}, toTechnician() {}, toOwner() {}, toPlatform() {} };
  const svc = new CustomerDisplayService(repo as DisplayDataPort, rt, undefined, undefined, undefined, undefined, undefined, phone);
  return { svc, asked, typed };
}

describe('the phone-change code on the display', () => {
  it('the state carries the prompt (masked number only) for the customer of this display’s checkout', async () => {
    const h = harness(row());
    const s = await h.svc.getDeviceState(TOKEN);
    expect(s.phoneVerification).toEqual({ maskedPhone: '••••0199' });
    expect(h.asked).toEqual(['c1']);
  });
  it('a checkout for another customer shows no pad', async () => {
    const h = harness(row({ customerId: 'c2' }));
    expect((await h.svc.getDeviceState(TOKEN)).phoneVerification).toBeUndefined();
  });
  it('the code is checked for THIS display’s customer — whatever the request says', async () => {
    const h = harness(row());
    expect(await h.svc.submitPhoneCodeForDevice(TOKEN, '123456')).toEqual({ ok: true, message: 'confirmed' });
    expect(h.typed).toEqual(['c1:123456']);
  });
  it('no customer in front of the display → no code is accepted; a bad token is refused', async () => {
    await expect(harness(null).svc.submitPhoneCodeForDevice(TOKEN, '123456')).rejects.toThrow(/no code to enter/);
    await expect(harness(row({ customerId: null as any })).svc.submitPhoneCodeForDevice(TOKEN, '123456')).rejects.toThrow(/no code to enter/);
    await expect(harness(row()).svc.submitPhoneCodeForDevice('nope', '123456')).rejects.toThrow(/device token/);
  });
});
