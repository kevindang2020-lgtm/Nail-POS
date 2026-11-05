// i18n/ — Constitution 6 §97–98: EN / VI translation for the four mobile apps (BUILD_PLAN Phase 13, E).
export {
  registerCatalog, t, enPlural, setLanguage, getLanguage, currentLocale, detectLanguage, initLanguage, useT, useLanguage, loadCommonForTests,
  catalogCoverage, catalogFor, resetI18nForTests, I18N_STORAGE_KEY, onLanguageChange, setMissingKeyWarnings, setLanguagePolicy, languagePolicy, type Catalog,
} from './i18n';
export {
  syncUserLocale, setBusinessTimeZone, businessTimeZone, effectiveTimeZone, fmtDate, fmtMonthDay, fmtTime, fmtDateTime, fmtInZone, fmtYmd,
  resetLocaleForTests,
} from './locale';
export { localizedErrorMessage } from './error-message';   // V-5: a server refusal in the user's language (errors.<CODE>)
