// catalog.ts — the Technician App's own ENGLISH strings (English only — POSLanguage.pdf §1) (Constitution 6 §97, BUILD_PLAN Phase 13 E). Each English value is
// the exact text the screen showed before the key existed. Shared strings (sign-in, tabs, greetings) are in
// @aipowersalon/mobile-sdk i18n/common.ts. Imported once from main.tsx.
import { registerCatalog } from '@aipowersalon/mobile-sdk/i18n';

export const TECH_EN = {
  'tech.login.appName': 'TECHNICIAN APP',
  'tech.login.codePlaceholder': '6-digit verification code',
  'tech.login.slogan': 'Your Tools. Your Day. Your Success.',
  'tech.login.clientQueue': 'Client Queue',
  'tech.login.secureOnly': 'Secure technician access only',
  // Weekly Paycheck close-out (Oct 27 2026, §15.3 / §11.5): the payout lifecycle words and the handoff code
  'tech.pay.check.planned': 'Check · planned',
  'tech.pay.check.issued': 'Check #{n} · ISSUED',
  'tech.pay.check.delivered': 'Check #{n} · DELIVERED',
  'tech.pay.check.cleared': 'Check #{n} · CLEARED',
  'tech.pay.check.voided': 'Check #{n} · VOIDED',
  'tech.pay.check.returned': 'Check #{n} · RETURNED BY THE BANK',
  'tech.pay.cash.planned': 'Cash · planned',
  'tech.pay.cash.ready_for_handoff': 'Cash · READY FOR YOU',
  'tech.pay.cash.handed_off': 'Cash · HANDED OVER — confirm it',
  'tech.pay.cash.acknowledged': 'Cash · ACKNOWLEDGED',
  'tech.pay.cash.disputed': 'Cash · DISPUTED',
  'tech.pay.cash.canceled': 'Cash · CANCELED',
  'tech.pay.other.paid': '{method} · PAID',
  'tech.pay.other.pending': '{method} · not paid yet',
  'tech.pay.other.canceled': '{method} · CANCELED',
  'tech.pay.handoffCode': 'Manager’s handoff code (optional)',
  'tech.pay.handoffCodeHint': 'If the manager shows a QR code, scan it or type the 8 characters — it proves you were there.',
  'tech.pay.scan': 'Scan code',
  'tech.pay.scanUnavailable': 'Scanning is not available on this device — type the code.',
  'tech.pay.confirmedBy.technician_app': 'You confirmed in the app',
  'tech.pay.confirmedBy.technician_pin': 'You confirmed with your PIN',
  'tech.pay.confirmedBy.qr_handoff': 'You confirmed with the handoff code',
  'tech.pay.confirmedBy.signature': 'You confirmed with PIN + signature',
  'tech.pay.confirmedBy.manager_dual': 'Confirmed by you and the manager',
  // Weekly Paycheck 17.5 (Oct 27 2026): the pay stub PDF of an approved week
  'tech.pay.stub.download': 'Download pay stub',
  'tech.pay.stub.preparing': 'Preparing your pay stub…',
  'tech.pay.stub.done': 'Pay stub downloaded.',
  'tech.pay.stub.failed': 'Could not download the pay stub.',
};
registerCatalog('en', TECH_EN);
// POSLanguage.pdf §1 / §20 (Oct 28 2026): this app is ENGLISH ONLY — its Vietnamese catalogue was removed (only the Front
// Desk POS is bilingual). Do not add one back: check:english-only-apps fails the build on a Vietnamese catalogue here.
