// display-receipt.vitest.spec.ts — 23-inch dual-screen spec §97–§98: the receipt choice comes right after the payment
// (no signature on the display — the Clover terminal takes it) and BEFORE the 3-second completed screen. The display
// offers only what can really be delivered, shows destinations masked, records ONE choice (a double tap sends one
// receipt), applies the salon's automatic choice when the customer walks away, and the checkout cannot be released while
// the customer is still choosing.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_CHECKOUT_SETTINGS, buildCustomerDisplayCheckout, computeTotals } from '@aipowersalon/checkout';
import { CustomerDisplayService, DisplayError, STALE_COMPLETED_MS, displayReceiptStep, type DisplayReceiptPort, type ReceiptStepFacts } from './customer-display.service';
import type { DisplayDataPort, DisplaySessionRow } from './customer-display.repository';

const facts = (over: Partial<ReceiptStepFacts> = {}): ReceiptStepFacts => ({
  promptEnabled: true, defaultDelivery: ['SMS', 'Email'], live: { sms: true, email: true }, phone: '+1 (215) 555-0142', email: 'sophia.lee@gmail.com',
  alreadySent: false, choice: null, status: null, ...over,
});

describe('displayReceiptStep — what the customer is asked (pure)', () => {
  it('text and email to MASKED destinations, plus "No receipt"; the salon default is the automatic choice', () => {
    expect(displayReceiptStep(facts())).toEqual({
      status: 'choose', automatic: 'sms', decideWithinSeconds: 45,
      options: [{ channel: 'sms', destination: '(•••) •••-0142' }, { channel: 'email', destination: 's•••@gmail.com' }, { channel: 'none' }],
    });
    expect(JSON.stringify(displayReceiptStep(facts()))).not.toMatch(/555|sophia\.lee/);
  });
  it('a channel nobody can deliver is never offered (no provider, or no contact) — and with none left there is no question at all', () => {
    expect(displayReceiptStep(facts({ live: { sms: false, email: true } }))?.options.map((o) => o.channel)).toEqual(['email', 'none']);
    expect(displayReceiptStep(facts({ phone: null }))?.options.map((o) => o.channel)).toEqual(['email', 'none']);
    expect(displayReceiptStep(facts({ live: { sms: false, email: false } }))).toBeNull();
    expect(displayReceiptStep(facts({ phone: null, email: 'not-an-address' }))).toBeNull();
  });
  it('the salon turned the prompt off, or the front desk already sent one → no question', () => {
    expect(displayReceiptStep(facts({ promptEnabled: false }))).toBeNull();
    expect(displayReceiptStep(facts({ alreadySent: true }))).toBeNull();
  });
  it('the automatic choice follows Receipts & Branding — email first when the salon says so; nothing deliverable → none', () => {
    expect(displayReceiptStep(facts({ defaultDelivery: ['Email', 'SMS'] }))?.automatic).toBe('email');
    expect(displayReceiptStep(facts({ defaultDelivery: ['Email'], email: null }))?.automatic).toBe('none');
    expect(displayReceiptStep(facts({ defaultDelivery: [] }))?.automatic).toBe('none');
  });
  it('once chosen, the recorded outcome (masked) — whatever the settings say now', () => {
    expect(displayReceiptStep(facts({ choice: 'sms', status: 'sent', promptEnabled: false }))).toEqual({ status: 'sent', channel: 'sms', destination: '(•••) •••-0142' });
    expect(displayReceiptStep(facts({ choice: 'none', status: 'skipped' }))).toEqual({ status: 'skipped', channel: 'none' });
  });
});

// ── the flow through the service (a fake repository and a fake checkout-module receipt port) ──────────────────────────
const TOKEN = 'device-token-r';
const DEVICE = { id: 'dev-r', tenantId: 't1', branchId: 'b1' };
function paidRow(over: Partial<DisplaySessionRow> = {}): DisplaySessionRow {
  return {
    id: 'sess-r', tenantId: 't1', branchId: 'b1', state: 'showing_ticket', ticketId: 'tk-r', ticketNumber: '#7', customerId: 'c1', publicTokenHash: 'x',
    selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'cash', expiresAt: new Date(Date.now() + 600_000).toISOString(), closedAt: null,
    ticketStatus: 'paid', lastPaymentStatus: 'approved', lastPaymentAt: new Date().toISOString(), ticketPaidAt: new Date().toISOString(), changedAtMs: 1,
    receiptChoice: null, receiptStatus: null, ...over,
  };
}
function harness(opts: { session?: DisplaySessionRow; send?: 'sent' | 'unavailable' | 'failed' | 'throw'; settings?: { promptEnabled: boolean; defaultDelivery: string[] }; live?: { sms: boolean; email: boolean } } = {}) {
  let current: DisplaySessionRow | null = opts.session ?? paidRow();
  const sends: string[] = []; const claims: string[] = []; const closed: string[] = []; const claimAttempts: string[] = [];
  const repo: Partial<DisplayDataPort> = {
    async deviceByToken(h: string) { return h === createHash('sha256').update(TOKEN).digest('hex') ? DEVICE : null; },
    async currentSessionForDevice() { return current; },
    async getSession(id: string) { return current && current.id === id ? current : null; },
    async resolveSettings() { return { ...DEFAULT_CHECKOUT_SETTINGS }; },
    async checkoutProjection() {
      const totals = computeTotals(5000, 0, DEFAULT_CHECKOUT_SETTINGS, 'cash', 0);
      return buildCustomerDisplayCheckout({ ticketNumber: '#7', createdAt: '2026-10-06T15:00:00.000Z', ticketStatus: 'paid', lines: [{ serviceName: 'Gel Manicure', technicianName: 'Olivia Tran', priceCents: 5000 }], discountCents: 0, totals, payments: [{ method: 'cash', amountCents: totals.totalDueCents, status: 'approved' }] });
    },
    async salonName() { return 'Luxury Nails'; },
    async customerFirstName() { return 'Sophia'; },
    async receiptSettings() { return opts.settings ?? { promptEnabled: true, defaultDelivery: ['SMS', 'Email'] }; },
    async claimReceiptChoice(_t: string, id: string, choice: any, status: any) {
      claimAttempts.push(choice);
      if (!current || current.id !== id || current.receiptChoice) return false;
      claims.push(choice); current = { ...current, receiptChoice: choice, receiptStatus: status }; return true;
    },
    async finishReceipt(_t: string, id: string, status: any) { if (current && current.id === id && current.receiptStatus === 'sending') current = { ...current, receiptStatus: status }; },
    async closeSessionCompleted(_t: string, id: string) { if (!current || current.id !== id) return false; closed.push(id); current = null; return true; },
  };
  const receipts: DisplayReceiptPort = {
    async displayReceiptFacts() { return { phone: '2155550142', email: 'sophia.lee@gmail.com', alreadySent: false, live: opts.live ?? { sms: true, email: true } }; },
    async sendReceiptForDisplay(_s, ticketId, channel) {
      sends.push(`${ticketId}:${channel}`);
      if (opts.send === 'throw') throw new Error('provider down');
      return opts.send ?? 'sent';
    },
  };
  const rt: any = { toTenant() {}, toCustomerDisplayDevice() {}, toCustomerDisplay() {}, toTicket() {}, toTechnician() {}, toOwner() {}, toPlatform() {} };
  const svc = new CustomerDisplayService(repo as DisplayDataPort, rt, undefined, undefined, undefined, receipts);
  return { svc, sends, claims, claimAttempts, closed, get current() { return current; } };
}

describe('the receipt step on the display', () => {
  it('after payment the state carries the question — and the release (the 3-second screen ending) waits for the answer', async () => {
    const h = harness();
    const s = await h.svc.getDeviceState(TOKEN);
    expect(s.state).toBe('payment_success');
    expect(s.receipt).toMatchObject({ status: 'choose', automatic: 'sms' });
    await expect(h.svc.releaseForDevice(TOKEN, 'sess-r')).rejects.toThrow(/still choosing a receipt/);
    expect(h.closed).toEqual([]);
  });

  it('the customer taps "Text": one receipt is sent through the checkout module, the outcome recorded, then the release goes through', async () => {
    const h = harness();
    const s = await h.svc.submitReceiptForDevice(TOKEN, { choice: 'sms' });
    expect(h.sends).toEqual(['tk-r:sms']);
    expect(s.receipt).toEqual({ status: 'sent', channel: 'sms', destination: '(•••) •••-0142' });
    // a double tap (or the other screen) finds the choice taken: nothing is sent twice
    const again = await h.svc.submitReceiptForDevice(TOKEN, { choice: 'email' });
    expect(h.sends).toEqual(['tk-r:sms']);
    expect(again.receipt).toMatchObject({ status: 'sent', channel: 'sms' });
    expect((await h.svc.releaseForDevice(TOKEN, 'sess-r')).state).toBe('idle');
    expect(h.closed).toEqual(['sess-r']);
  });

  it('"No receipt" is recorded as skipped and sends nothing', async () => {
    const h = harness();
    const s = await h.svc.submitReceiptForDevice(TOKEN, { choice: 'none' });
    expect(h.sends).toEqual([]);
    expect(s.receipt).toEqual({ status: 'skipped', channel: 'none' });
  });

  it('walked away (auto): the salon\'s automatic choice is sent', async () => {
    const h = harness({ settings: { promptEnabled: true, defaultDelivery: ['Email'] } });
    const s = await h.svc.submitReceiptForDevice(TOKEN, { choice: 'auto' });
    expect(h.sends).toEqual(['tk-r:email']);
    expect(s.receipt).toEqual({ status: 'sent', channel: 'email', destination: 's•••@gmail.com' });
  });

  it('a failed or unavailable delivery is said plainly (never "sent")', async () => {
    expect((await harness({ send: 'throw' }).svc.submitReceiptForDevice(TOKEN, { choice: 'sms' })).receipt).toMatchObject({ status: 'failed', channel: 'sms' });
    expect((await harness({ send: 'unavailable' }).svc.submitReceiptForDevice(TOKEN, { choice: 'email' })).receipt).toMatchObject({ status: 'unavailable', channel: 'email' });
  });

  it('refused: before payment, an unknown choice, a channel not offered, no question to answer', async () => {
    await expect(harness({ session: paidRow({ ticketStatus: 'ready_for_checkout', lastPaymentStatus: null }) }).svc.submitReceiptForDevice(TOKEN, { choice: 'sms' })).rejects.toBeInstanceOf(DisplayError);
    await expect(harness().svc.submitReceiptForDevice(TOKEN, { choice: 'fax' })).rejects.toThrow(/choice must be/);
    // email has no real provider here: it was never offered, so a request for it (an old screen, a forged call) sends nothing
    const noEmail = harness({ live: { sms: true, email: false } });
    await expect(noEmail.svc.submitReceiptForDevice(TOKEN, { choice: 'email' })).rejects.toThrow(/not available/);
    expect(noEmail.sends).toEqual([]);
    expect(noEmail.claimAttempts).toEqual([]);
    await expect(harness({ settings: { promptEnabled: false, defaultDelivery: [] } }).svc.submitReceiptForDevice(TOKEN, { choice: 'sms' })).rejects.toThrow(/no receipt to choose/);
  });

  it('two taps at the same moment: both reach the claim, ONE wins — one receipt goes out, and both screens show it', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.svc.submitReceiptForDevice(TOKEN, { choice: 'sms' }), h.svc.submitReceiptForDevice(TOKEN, { choice: 'email' })]);
    expect(h.claimAttempts).toHaveLength(2);   // the race really happened: both saw the question open
    expect(h.sends).toEqual(['tk-r:sms']);
    expect(a.receipt).toMatchObject({ status: 'sent', channel: 'sms' });
    expect(b.receipt).toMatchObject({ channel: 'sms' });   // the loser shows the winner's choice, never its own
  });

  it('a paid card checkout goes straight to the receipt question — no signature on the display (Kevin, Oct 6 2026)', async () => {
    const s = await harness().svc.getDeviceState(TOKEN);
    expect(s).not.toHaveProperty('signatureRequired');
    expect(s.receipt).toMatchObject({ status: 'choose' });
  });

  it('a display that never answered (offline at the end): the stale checkout is closed, and the salon\'s automatic receipt still goes', async () => {
    const h = harness({ session: paidRow({ ticketPaidAt: new Date(Date.now() - STALE_COMPLETED_MS - 1000).toISOString() }) });
    const s = await h.svc.getDeviceState(TOKEN);
    expect(s.state).toBe('idle');
    expect(h.sends).toEqual(['tk-r:sms']);
    expect(h.closed).toEqual(['sess-r']);
  });
});
