// checkout-receipt-text.ts — what a receipt sent to the customer says. ENGLISH ONLY (Kevin, Oct 28 + Nov 9 2026: the salons'
// customers are Americans; only the employee web POS is English + Vietnamese). The language argument is kept for callers
// and ignored; the Vietnamese variants were deleted Nov 9 2026 and `check-english-only-apps` keeps them out.
import type { AppLanguage } from '@aipowersalon/api-contracts';

export interface ReceiptTextInput {
  total: string;              // formatted total, e.g. "$54.00"
  tip?: string | null;        // formatted tip when one was left
  surcharge?: string | null;  // formatted card surcharge when part of the total
  saved?: string | null;      // formatted savings (deals / discounts) when any
  reference: string;          // the receipt number
  items?: string;             // the itemized lines (email only)
}

type T = (x: ReceiptTextInput) => string;
export const RECEIPT_TEMPLATES: Record<'receipt_sms.en' | 'receipt_email_subject.en' | 'receipt_email_body.en', T> = {
  'receipt_sms.en': (x) => `Thanks for visiting! Your receipt total is ${x.total}${x.tip ? ` (includes ${x.tip} tip)` : ''}${x.surcharge ? ` (includes ${x.surcharge} card surcharge)` : ''}.${x.saved ? ` You saved ${x.saved}.` : ''} Ref ${x.reference}.`,
  'receipt_email_subject.en': () => 'Your receipt',
  'receipt_email_body.en': (x) => `Thanks for visiting!\n\n${x.items ?? ''}${x.saved ? `\nYou saved ${x.saved}.` : ''}\n\nTotal ${x.total}${x.tip ? ` (includes ${x.tip} tip)` : ''}${x.surcharge ? ` (includes ${x.surcharge} card surcharge)` : ''}. Reference ${x.reference}.`,
};
export function receiptSms(_language: AppLanguage, x: ReceiptTextInput): string { return RECEIPT_TEMPLATES['receipt_sms.en'](x); }
export function receiptEmail(_language: AppLanguage, x: ReceiptTextInput): { subject: string; body: string } {
  return { subject: RECEIPT_TEMPLATES['receipt_email_subject.en'](x), body: RECEIPT_TEMPLATES['receipt_email_body.en'](x) };
}
/** The lock-screen push for a receipt saved to the customer's app (no amount on the lock screen, §61). */
export function receiptSavedPush(_language: AppLanguage, receiptNumber: string): { title: string; body: string } {
  return { title: 'Receipt saved', body: `Receipt #${receiptNumber} is in your app.` };
}
