// checkout-receipt-language.vitest.spec.ts — English + Vietnamese POS mandate WP-I (§118–§119): an SMS / email / app
// receipt is written in the CUSTOMER's language (customers.preferred_language), never in the language of the employee
// at the register; no preference → English; the money stays in the salon's currency format; a failed language read
// sends the English receipt rather than no receipt.
import { describe, it, expect } from 'vitest';
import { CheckoutService } from './checkout.service';
import { receiptSms, receiptEmail } from './checkout-receipt-text';

const ctx: any = { tenantId: 'luxe001', branchId: 'b1', userId: 'u1', role: 'FRONT_DESK', permissions: ['pos.receipts.send'], language: 'vi' };   // a Vietnamese POS user
function harness(customerLanguage: string | null | Error) {
  const sms: string[] = [], mails: Array<{ subject: string; body: string }> = [], pushed: any[] = [];
  const repo: any = {
    ticket: async () => ({ id: 'tk1', customerId: 'c1', customerPhone: '+18565550101', customerEmail: 'guest@example.test', method: 'card',
      lines: [{ serviceLineId: 'l1', serviceName: 'Gel Mani', priceCents: 4500 }], discountSnapshot: { applied: [{ description: 'Fall deal', appliedCents: 500, lines: [{ lineId: 'l1', cents: 500 }] }] } }),
    totalsFor: async () => ({ totalDueCents: 5400, tipCents: 800, surchargeCents: 100 }),
    paidBreakdown: async () => ({ totalCents: 5400, surchargeCents: 100 }),
    recordReceipt: async () => ({ receiptId: 'r1', receiptNumber: 'R-77' }),
    customerUserIdForTicket: async () => 'user-9',
    customerLanguageForTicket: async () => { if (customerLanguage instanceof Error) throw customerLanguage; return customerLanguage; },
  };
  const svc = new CheckoutService(repo, { async send(_to: string, body: string) { sms.push(body); return { sid: 'SM1' }; } } as any,
    { async send(_to: string, subject: string, body: string) { mails.push({ subject, body }); return { id: 'EM1' }; } } as any)
    .usePush({ dispatchToUser: async (_t: string | null, _u: string, msg: any) => { pushed.push(msg); return {}; } });
  return { svc, sms, mails, pushed };
}

describe('receipts in the customer\'s language', () => {
  it("a customer marked Vietnamese gets the ENGLISH SMS and app push (Kevin's ruling (Oct 28 2026): every customer message is English — the salons' customers are English-speaking Americans)", async () => {
    const h = harness('vi');
    await h.svc.receiptSms(ctx, 'tk1');
    expect(h.sms[0]).toBe('Thanks for visiting! Your receipt total is $54.00 (includes $8.00 tip) (includes $1.00 card surcharge). You saved $5.00. Ref R-77.');
    expect(h.pushed[0]).toMatchObject({ title: 'Receipt saved' });
  });
  it('an English customer gets the English receipt even when the employee\'s POS is in Vietnamese (unchanged English wording)', async () => {
    const h = harness('en');
    await h.svc.receiptSms(ctx, 'tk1');
    expect(h.sms[0]).toBe('Thanks for visiting! Your receipt total is $54.00 (includes $8.00 tip) (includes $1.00 card surcharge). You saved $5.00. Ref R-77.');
    expect(h.pushed[0]).toMatchObject({ title: 'Receipt saved' });
  });
  it('email: English subject and body for every customer, itemized once (the savings line is not repeated)', async () => {
    const vi = harness('vi'); await vi.svc.receiptEmail(ctx, 'tk1');
    expect(vi.mails[0].subject).toBe('Your receipt');
    expect(vi.mails[0].body).toContain('Gel Mani  $45.00');
    expect(vi.mails[0].body).toContain('Total $54.00 (includes $8.00 tip) (includes $1.00 card surcharge). Reference R-77.');
    const en = harness(null); await en.svc.receiptEmail(ctx, 'tk1');
    expect(en.mails[0].subject).toBe('Your receipt');
    expect(en.mails[0].body.match(/You saved \$5\.00\./g)).toHaveLength(1);
    expect(en.mails[0].body).toContain('Total $54.00 (includes $8.00 tip) (includes $1.00 card surcharge). Reference R-77.');
  });
  it('no preference → English; a failed language read still sends the receipt, in English', async () => {
    const none = harness(null); await none.svc.receiptSms(ctx, 'tk1');
    expect(none.sms[0]).toMatch(/^Thanks for visiting!/);
    const broken = harness(new Error('db down')); await broken.svc.receiptSms(ctx, 'tk1');
    expect(broken.sms[0]).toMatch(/^Thanks for visiting!/);
  });
  it('template pairs omit what was not charged', () => {
    expect(receiptSms('vi', { total: '$20.00', reference: 'R-1' })).toBe('Cảm ơn quý khách đã ghé tiệm! Tổng hóa đơn là $20.00. Mã hóa đơn R-1.');
    expect(receiptEmail('en', { total: '$20.00', reference: 'R-1', items: 'Polish  $20.00' }).body).toBe('Thanks for visiting!\n\nPolish  $20.00\n\nTotal $20.00. Reference R-1.');
  });
});
