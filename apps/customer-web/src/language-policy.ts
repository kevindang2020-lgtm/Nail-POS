// language-policy.ts — POSLanguage.pdf §1 / §20 (Oct 28 2026): the Customer App is ENGLISH ONLY. This module is the FIRST import of
// main.tsx, so the policy is in force before any catalogue registers: no Vietnamese text is mounted, and no server answer,
// saved device choice or device language (vi-VN) can switch the app. Only the Front Desk POS is bilingual. The
// check:english-only-apps gate fails the build if this import is missing or not first.
import { setLanguagePolicy } from '@aipowersalon/mobile-sdk/i18n';
import { APPLICATION_LOCALE_POLICY } from '@aipowersalon/api-contracts';

setLanguagePolicy(APPLICATION_LOCALE_POLICY.CUSTOMER_APP);
try { document.documentElement.lang = 'en'; } catch { /* no document (tests) */ }
