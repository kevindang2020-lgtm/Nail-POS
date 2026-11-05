// i18n/index.ts — the POS app's EN / VI (Oct 21 2026, Kevin: "Build Vietnamese for the POS and let tenants have options to
// switch"). Same layer as the four mobile apps (@aipowersalon/mobile-sdk/i18n: flat catalogues, English the default and
// the fallback for every missing Vietnamese string). Importing this module registers the POS catalogues ONCE — main.tsx
// and the test setup import it, so `t()` anywhere in the app resolves a key whether or not the screen is mounted.
//
// Vietnamese POS mandate (Oct 26 2026, WP-B): a switch is INSTANT — no reload, no remount. The language is a subscribed
// value (useLanguage) read by the app root (App.tsx Gate / POSRoutes), so every mounted screen re-renders in place and
// keeps its state. Nothing may translate at import time (module-level t() is frozen in the old language); label tables
// use getters / functions so they translate when read.
//
// Language for the POS (§8): the USER's saved choice > the SALON's default (both resolved by the API in
// GET pos/me/locale) > English. No browser-language or device-choice layer for the POS (the mobile apps keep theirs).
// Before sign-in the POS is English. See i18n/pos-language.ts.
import { registerCatalog, onLanguageChange, getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { POS_EN } from './catalog.en';
import { POS_VI } from './catalog.vi';
import { NAMESPACES_EN, NAMESPACES_VI } from './ns';

const nonEmpty = (c: Record<string, string>) => Object.fromEntries(Object.entries(c).filter(([, v]) => v)) as Record<string, string>;
registerCatalog('en', POS_EN);
registerCatalog('vi', nonEmpty(POS_VI));   // an empty Vietnamese value falls back to English, never to a blank
for (const c of NAMESPACES_EN) registerCatalog('en', c);
for (const c of NAMESPACES_VI) registerCatalog('vi', nonEmpty(c));

// §65: the page's `lang` follows the language (screen readers, hyphenation, the browser's translate prompt)
function applyDocumentLang(): void {
  try { if (typeof document !== 'undefined') document.documentElement.lang = getLanguage() === 'vi' ? 'vi' : 'en'; } catch { /* not in a browser */ }
}
applyDocumentLang();
onLanguageChange(applyDocumentLang);

export { t, useT, useLanguage, setLanguage, getLanguage, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
