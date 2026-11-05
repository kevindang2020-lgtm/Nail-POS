// @aipowersalon/testing — Constitution 13 §90: shared test helpers. §91: a TEST dependency only — the architecture gate
// fails any production file (anything that is not a *.test.ts / *.spec.ts) that imports it.
//
// Starts with the helper 78 pgtests shared by relative path into apps/api/test-support — which is why no domain with a
// real-schema test could leave the API: the module codemod refuses an import that reaches back into apps/api (§105).
export { migratedPglite, kyselyFor } from './pgtest-schema.mjs';
export { testProviderSecrets } from './provider-secrets';
export { startRealPostgres } from './realpg.mjs';   // the real-Postgres harness (REALPG_MODULES opt-in)
export { applyMigrationToPglite, pgliteCompatible } from './pgtest-schema.mjs';   // Phase 10: replay a migration the way migrate.mjs does (no-transaction / CONCURRENTLY files)
export { routeBodyFailures, type RouteBodyCase } from './validated-routes';   // BUILD_PLAN Phase 12 (#17): route-by-route body validation check
export { exifJpeg, htmlAsImage, tinyPng, EXIF_GPS_MARKER } from './upload-fixtures';   // BUILD_PLAN Phase 12 (#34): upload-route test files
// §220 (Oct 21 2026): axe over a rendered screen lives at '@aipowersalon/testing/a11y' — a separate entry so a browser app's
// tsc never follows this index into the pglite / .mjs server helpers.
