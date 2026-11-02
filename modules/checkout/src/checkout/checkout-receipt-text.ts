// checkout-receipt-text.ts — English + Vietnamese POS mandate WP-I (§118–§119): what a receipt sent to the customer says,
// in the CUSTOMER's language (customers.preferred_language → customerMessageLanguage), never in the language of the
// employee who pressed Send. Each template has an .en and a .vi variant; amounts stay in the salon's currency format
// (§45 — the language never changes the money). The Vietnamese wording is listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
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
export const RECEIPT_TEMPLATES: Record<`${'receipt_sms' | 'receipt_email_subject' | 'receipt_email_body'}.${AppLanguage}`, T> = {
  'receipt_sms.en': (x) => `Thanks for visiting! Your receipt total is ${x.total}${x.tip ? ` (includes ${x.tip} tip)` : ''}${x.surcharge ? ` (includes ${x.surcharge} card surcharge)` : ''}.${x.saved ? ` You saved ${x.saved}.` : ''} Ref ${x.reference}.`,
  'receipt_sms.vi': (x) => `Cảm ơn quý khách đã ghé tiệm! Tổng hóa đơn là ${x.total}${x.tip ? ` (đã gồm ${x.tip} tiền tip)` : ''}${x.surcharge ? ` (đã gồm ${x.surcharge} phụ phí thẻ)` : ''}.${x.saved ? ` Quý khách đã tiết kiệm ${x.saved}.` : ''} Mã hóa đơn ${x.reference}.`,
  'receipt_email_subject.en': () => 'Your receipt',
  'receipt_email_subject.vi': () => 'Hóa đơn của quý khách',
  'receipt_email_body.en': (x) => `Thanks for visiting!\n\n${x.items ?? ''}${x.saved ? `\nYou saved ${x.saved}.` : ''}\n\nTotal ${x.total}${x.tip ? ` (includes ${x.tip} tip)` : ''}${x.surcharge ? ` (includes ${x.surcharge} card surcharge)` : ''}. Reference ${x.reference}.`,
  'receipt_email_body.vi': (x) => `Cảm ơn quý khách đã ghé tiệm!\n\n${x.items ?? ''}${x.saved ? `\nQuý khách đã tiết kiệm ${x.saved}.` : ''}\n\nTổng cộng ${x.total}${x.tip ? ` (đã gồm ${x.tip} tiền tip)` : ''}${x.surcharge ? ` (đã gồm ${x.surcharge} phụ phí thẻ)` : ''}. Mã hóa đơn ${x.reference}.`,
};
export function receiptSms(language: AppLanguage, x: ReceiptTextInput): string { return RECEIPT_TEMPLATES[`receipt_sms.${language}`](x); }
export function receiptEmail(language: AppLanguage, x: ReceiptTextInput): { subject: string; body: string } {
  return { subject: RECEIPT_TEMPLATES[`receipt_email_subject.${language}`](x), body: RECEIPT_TEMPLATES[`receipt_email_body.${language}`](x) };
}
/** The lock-screen push for a receipt saved to the customer's app (no amount on the lock screen, §61). */
export function receiptSavedPush(language: AppLanguage, receiptNumber: string): { title: string; body: string } {
  return language === 'vi'
    ? { title: 'Đã lưu hóa đơn', body: `Hóa đơn #${receiptNumber} đã có trong ứng dụng của quý khách.` }
    : { title: 'Receipt saved', body: `Receipt #${receiptNumber} is in your app.` };
}
