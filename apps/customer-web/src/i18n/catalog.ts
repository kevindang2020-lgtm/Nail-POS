// catalog.ts — the Customer App's own ENGLISH strings (English only — POSLanguage.pdf §1) (Constitution 6 §97, BUILD_PLAN Phase 13 E). Each English value is
// the exact text the screen showed before the key existed. Shared strings are in @aipowersalon/mobile-sdk i18n/common.ts.
import { registerCatalog } from '@aipowersalon/mobile-sdk/i18n';

export const CUSTOMER_EN = {
  'customer.login.phoneOrEmail': 'Phone or Email',
  'customer.login.biometric': 'Biometric Login',
  'customer.login.guest': 'Continue as Guest',
  'customer.login.exploreAsGuest': 'Explore services as Guest',
  'customer.login.browse': 'Browse Services',
  'customer.login.shortcuts': 'Quick Shortcuts',
  'customer.login.shortcutsSub': 'Quick access to your account',
  'customer.login.explore': 'EXPLORE',
  'customer.login.appointment': 'Appointment',
  'customer.login.bookVisit': 'Book a visit',
  'customer.login.specialOffers': 'Special offers',
  'customer.login.yourBalance': 'Your balance',
};
registerCatalog('en', CUSTOMER_EN);
// POSLanguage.pdf §1 / §20 (Oct 28 2026): this app is ENGLISH ONLY — its Vietnamese catalogue was removed (only the Front
// Desk POS is bilingual). Do not add one back: check:english-only-apps fails the build on a Vietnamese catalogue here.
