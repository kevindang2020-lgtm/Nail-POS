# POS-only Vietnamese — language-scope status (POSLanguage.pdf, Oct 28 2026)

**Source of truth:** `POSLanguage.pdf` (14 pages, "POS-Only English + Vietnamese Localization / English-Only Enforcement for
Every Other Application"). It REPLACES the language scope of the original `VietnamesePOS(1).pdf`; that document's POS
glossary, i18n architecture, Unicode rules and 27-inch layout rules still apply — to the Front Desk POS only.

```
FRONT DESK POS : ENGLISH + TIẾNG VIỆT
CUSTOMER APP · TECHNICIAN APP · OWNER APP · TAP TO PAY · SUPER ADMIN · ONLINE BOOKING · CUSTOMER DISPLAY · CHECK-IN KIOSK
CUSTOMER RECEIPTS / SMS / EMAIL / PUSH : ENGLISH ONLY
A POS language choice NEVER changes another application's language.
```

Status vocabulary: PASS (run here, passed) · FAIL · NOT_TESTED (needs an environment this workspace does not have — a built
frontend, a browser against a running stack, a device) · BLOCKED_EXTERNAL (a real outside dependency). Nothing is PASS that
was not run.

**Environment of this run:** no `node_modules` (the npm registry is blocked), so no frontend build, no `tsc`, no vitest/jsdom,
no PGlite. What ran: the dependency-free gates (`node tooling/ci/run-gates.mjs` — 17 fail for that environment reason only,
the same 17 as before this change) and the stand-in harness (Node's TypeScript stripper + a small vitest shim) for the
non-DOM tests. Everything marked NOT_TESTED below is written and waits for the V-28 run.

## 1. What was found and fixed (commit `05ac57cd`)

| # | Leak (before) | Fix | Where |
|---|---|---|---|
| L1 | The shared translation layer (`packages/mobile-sdk/src/i18n/i18n.ts`) let the Customer, Technician, Owner and Tap to Pay apps fall back to a saved device choice and then to the device language — a phone set to Vietnamese got a Vietnamese app whenever the server's answer did not arrive. | `setLanguagePolicy()` — each English-only app applies `APPLICATION_LOCALE_POLICY.<APP>` in `src/language-policy.ts`, the FIRST import of `main.tsx`. A forbidden catalogue is never mounted (and one registered earlier is dropped); `setLanguage` / `initLanguage` can never leave English; the device language, a saved choice and a server answer are ignored. The POS keeps both languages. | `packages/api-contracts/src/language.ts` (`APPLICATION_LOCALE_POLICY`, `resolveFrontDeskPosLocale`, `resolveApplicationLocale`); `packages/mobile-sdk/src/i18n/i18n.ts`; `apps/{customer-web,tech-web,owner-web,manager-pay-web}/src/language-policy.ts` + `main.tsx` |
| L2 | Those four apps shipped and registered full Vietnamese catalogues (and the generated Owner / Tech error catalogues had Vietnamese). | Vietnamese catalogues removed (272 lines); `tooling/i18n/sync-app-error-catalogs.mjs` generates English only. | `apps/*/src/i18n/catalog.ts`, `apps/{owner,tech}-web/src/i18n/errors.generated.ts` |
| L3 | A pay stub downloaded in the Technician App or the Owner App was rendered in the person's POS language (a Vietnamese PDF in an English-only app). | Tech / Owner surfaces always render English; the POS surface keeps its language choice. Names stay exactly as saved. | `modules/workforce/src/payroll/payroll-paycheck.service.ts` (`payStubOf`) |
| L4 | The public booking page had a "Tiếng Việt" button and switched to Vietnamese for a browser set to Vietnamese. | Vietnamese dictionary, button and browser-language detection removed. | `apps/booking-public/index.html` |
| L5 | The check-in kiosk had a "Tiếng Việt" button (remembered on the device). | Removed; an older saved choice is forgotten at start. | `apps/go-check-in-kiosk/index.html`, `…/www/index.html` |
| L6 | The Customer Display would render Vietnamese (with a guest switch) whenever its state listed `vi`. | Vietnamese catalogue removed (`DISPLAY_LANGUAGES = ['en']`); the server always sends `languages: ['en']`. Guest / technician / service names render exactly as saved. | `apps/customer-display/src/i18n/messages.ts`, `index.tsx`; `apps/api/src/customer-display/customer-display.service.ts` |

Already correct before this change (verified in this audit): customer receipts, SMS, email and push are English
(`customerMessageLanguage()` → `en`, commits `9f250679` / `a3460b50`); the Owner, Technician and Customer locale routes
answer English and only the POS can save a language (`PUT pos/me/language` is the only language write); Manager Pay forces
English; Super Admin has no language runtime (its own gate) and edits the tenant "Default POS Language" with English UI;
the native shells declare `CFBundleDevelopmentRegion = en` with no Vietnamese localizations.

## 2. Repository paths (§38)

| Concern | Path |
|---|---|
| Per-app language policy | `packages/api-contracts/src/language.ts` — `APPLICATION_LOCALE_POLICY`, `resolveFrontDeskPosLocale`, `resolveApplicationLocale` |
| Shared translation layer + enforcement | `packages/mobile-sdk/src/i18n/i18n.ts` — `setLanguagePolicy`, `languagePolicy` |
| English-only app bootstrap | `apps/{customer-web,tech-web,owner-web,manager-pay-web}/src/language-policy.ts` (first import of `src/main.tsx`) |
| POS language bootstrap / switch | `apps/pos-web/src/i18n/index.ts`, `apps/pos-web/src/i18n/pos-language.ts` (user POS choice → salon default → English; no device layer) |
| POS selector | POS topbar / account menu (`PUT pos/me/language`) |
| Tenant default POS language | `tenant_settings` business-branch `settings_json.defaultLanguage`; Super Admin `modules/super-admin/src/super-admin-tenants/tenant-pos-language.ts` |
| User POS preference | `users.preferred_language` (per tenant user row); read only by the POS locale route and POS-side features (AI explanations shown in the POS, the POS-printed pay stub) |
| Locale routes | `apps/api/src/account/language.controller.ts` |
| Customer Display | `apps/customer-display/src/i18n/*`, `apps/api/src/customer-display/customer-display.service.ts` |
| Receipts / SMS / push wording | `modules/checkout/src/checkout/checkout-receipt-text.ts`, `modules/communications/src/reminders/*`, `packages/api-contracts/src/customer-notification-text.ts`, `modules/memberships/src/membership-comms-core.ts` — all via `customerMessageLanguage()` |
| Backend error codes | `packages/api-contracts/src/errors.ts` (codes + English); the POS maps codes to Vietnamese (`apps/pos-web/src/i18n/ns/errors.vi.ts`) |
| Gates | `tooling/ci/check-english-only-apps.mjs` (new), `tooling/ci/check-admin-english-only.mjs`, `tooling/ci/check-i18n.mjs` (POS parity only), `tooling/ci/check-vi-glossary.mjs`, `tooling/ci/check-pos-i18n.mjs` |

## 3. Appendix B sign-off matrix

| Required validation | Result | Evidence / reason |
|---|---|---|
| POS Overview / Live Operations / Check-In / Booking / Tech Queue / Customer Queue / Serving / Service Done / Checkout EN / VI | NOT_TESTED | Built under the VietnamesePOS mandate (`check-i18n` PASS: 13,105 keys across the POS dictionaries and the shared common catalogue, Vietnamese complete). A browser pass of each module needs the built POS (no frontend build here). |
| POS 1920×1080 one-screen, both languages | NOT_TESTED | `tooling/e2e/*` layout runs need the built apps + Chromium against a running stack. |
| POS 200-technician busy states, both languages | NOT_TESTED | Same. |
| POS locale switch preserves booking / queue / form state | NOT_TESTED | Switch is in place (`pos-language.ts`: no reload, no remount); browser proof pending. |
| POS locale switch preserves payment UNKNOWN | NOT_TESTED | The switch calls no backend write except `PUT pos/me/language`; browser proof pending. |
| No duplicated websocket subscriptions on locale change | NOT_TESTED | Browser proof pending. |
| Tenant default POS locale persists / Individual POS user override persists | NOT_TESTED | `apps/api/src/account/language.pgtest.vitest.spec.ts` (PGlite) — not runnable here. |
| Same account POS VI / Owner App EN | PASS (unit) / NOT_TESTED (e2e) | Owner route answers EN (`resolveApplicationLocale`); Owner bootstrap English-only — `apps/owner-web/src/i18n/catalog.test.ts` 4/4 in the harness. |
| Customer App EN under tenant VI default | PASS (unit) | `customer/me/locale` answers EN whatever the salon default; `apps/customer-web/src/i18n/catalog.test.ts` 3/3 (server answer `vi` ignored). |
| Customer App EN under device vi-VN | PASS (unit) | Same test: `initLanguage({ device: 'vi-VN' })` → `en`, saved `vi` ignored. A real device run: NOT_TESTED. |
| Customer App EN after login / restart / deep link / push | PASS (unit) / NOT_TESTED (device) | The policy is applied before any render, on every start; push text is English (`customerNoticeText`). |
| Technician App EN with POS VI | PASS (unit) | `apps/tech-web/src/i18n/catalog.test.ts` 4/4 (incl. server refusals in English); Tech App pay stub English (pgtest written, V-28). |
| Owner App EN with POS VI | PASS (unit) | As above; Owner App pay stub English (pgtest written, V-28). |
| Tap to Pay EN with POS VI | PASS (unit) | `apps/manager-pay-web/src/i18n/catalog.test.ts` 3/3. Payment identity is language-neutral (no locale in intents). |
| Super Admin EN with POS VI tenant | PASS (static) | `check-admin-english-only` PASS; the pilot's 13i browser check: NOT_TESTED here. |
| Online Booking EN with POS VI tenant | PASS (static) | `check-english-only-apps`: dictionary English only, no detection, no toggle. Browser: NOT_TESTED. |
| Customer Display EN while staff POS VI | PASS (unit) | Server always sends `['en']` — `display-check-in.vitest.spec.ts` (fails on the old code); UI tests rewritten (jsdom, V-28); e2e block rewritten (`tooling/e2e/customer-display-layout.mjs` 8b). |
| Customer receipt system text EN | PASS (unit, earlier today) | `customerMessageLanguage()` → `en`; receipt / notice tests rewritten in `9f250679`. The pilot's receipt step now expects English. |
| Customer SMS / email / push templates EN | PASS (unit) | Same; membership reminder SMS tests (`cf4af25b`). |
| AI phone receptionist EN | PASS (unit) | Provider always en-US, agent / setting stored as English — `retell-voice`, `ai-agent`, `ai-settings` specs (each fails on the old code). A live call: NOT_TESTED (provider account). |
| No non-POS language toggle | PASS | `check-english-only-apps` (2,232 problems on the old code, 0 now) + `check-admin-english-only`. |
| Vietnamese Unicode user names and notes preserved | PASS (unit) | Display test keeps "Nguyễn Thị Hương"; pay stub test keeps "Nguyễn Thị Hằng" in the English stub (pgtest V-28). |
| No locale-dependent payment / tax / currency changes | PASS (static) | Language changes text and the display locale only; money / tax / routing never read the language (audit). |
| Tenant / branch language-setting authorization | NOT_TESTED | Super Admin route is step-up + permission; tenant settings write needs the settings permission; PGlite tests V-28. |
| POS translation coverage scanner | NOT_TESTED | `check-pos-i18n` needs the `typescript` package (not installed here). |
| Native / build / test status reported honestly | PASS | This document. |
| Build / typecheck / lint / unit / integration / E2E | NOT_TESTED | No `node_modules` here — V-28. |
| Developer handoff updated and conflicts resolved | PASS | `NEXT_STEPS.md`, `NEW_CHAT_HANDOFF.md`, this file. |

## 4. Superseded original-PDF sections (Appendix A concordance)

| VietnamesePOS(1).pdf | Now |
|---|---|
| §1–2 | Audit all apps, bilingual UI in the Front Desk POS only. |
| §13–18 | Locale preference and i18n activation scoped to the POS — no shared global user locale for other apps. |
| §54–55, §118–§119 | Customer communications, receipts and PDFs English only; the POS language never chooses output language. |
| §56–57 | Optional reviewed Vietnamese announcement variant shown to POS users only; every other app English. |
| §65 | POS may set `html lang="vi"`; every other app is `lang="en"` (gate-checked). |
| §66–81 | 27-inch EN/VI layout testing for the Front Desk POS only. |
| §90–94 | Locale APIs scoped to the POS. |
| §99–100 | POS translation scanner (POS only) + the English-only app scanner (`check-english-only-apps`). |
| §101–116 | POS switching tests kept; non-POS English-only negative tests added. |
| §117 | Customer Display English only — optional Vietnamese removed. |
| §120–121 | POS AI insights may be Vietnamese for staff; non-POS AI / customer UI English. |
| §123–124 | New bilingual keys for POS features only; no Vietnamese mobile features. |
| §125–127 | DoD, final report and handoff replaced by this scope matrix. |

## 5. Open items / decisions

1. **AI voice receptionist — DONE (Kevin, Oct 28 2026: "100% full in English").** The voice provider always speaks
   `VOICE_RECEPTIONIST_LOCALE` (en-US) on create and on every update; agent configs and the receptionist setting store `en`
   whatever is asked; the phone-verification call speaks English; the POS shows "English" instead of a language choice;
   migration 706 sets saved Spanish / Vietnamese agents and settings to English. A live agent created earlier in another
   language at the provider is corrected on its next update or re-provision. Owner-typed greeting / FAQ text is the salon's
   own content and is not rewritten. `check:english-only-apps` guards it.
2. **V-28 run** — build, typecheck, lint, vitest (incl. the rewritten jsdom tests), PGlite pgtests, the POS 27-inch EN/VI
   layout runs (1920×1080, 1600×900, 2560×1440, 200 technicians) and the Appendix C pilot (`apps/api/scripts/lib/pilot-vietnamese.mjs`).
3. **Rollback** — the change is code-only (no migration, no data touched). To roll back, revert `05ac57cd`; stored
   preferences (`users.preferred_language`, `customers.preferred_language`, the tenant default) are unchanged by it.

## Nov 9 2026 — Kevin: "all the apps and customers are in English because they are Americans. Only web POS English and Vietnamese."

Re-audited after SUNMI batches 1–8. Nothing Vietnamese was being SENT (customerMessageLanguage() already answered `en`), but
unused Vietnamese wording and one real leak path remained. Fixed:

| # | Before | Now |
|---|---|---|
| N1 | Unused `.vi` receipt SMS / email / push templates | Deleted — `checkout-receipt-text.ts` is English only |
| N2 | Unused `.vi` reminder SMS / email / push, Vietnamese rung words and a `vi-VN` date label | Deleted — `reminder-core.ts`, `reminders.service.ts startLabel` English only |
| N3 | Unused Vietnamese column of the customer in-app / push notice table | Deleted — `customer-notification-text.ts` English only |
| N4 | Vietnamese review-request / review-reminder SMS + email subject | Deleted — `ai-review-reputation.integrations.ts` English only |
| N5 | Vietnamese reschedule-proposal SMS | Deleted — `ai-scheduling-proposals.ts` English only |
| N6 | **Leak path:** AI prose followed the user's POS language even when the call came from the Owner / Tech app or a background job | `KyselyResponseLanguageResolver` answers English unless the request carries `X-Client-Type: pos` (`isFrontDeskPosRequest`) |

`check-english-only-apps` now also fails on any Vietnamese letter or `vi-VN` format in those customer-message files and on the
removal of the N6 guard (negative-tested: a planted Vietnamese string fails it).

Not leftovers (my Nov 9 report was wrong to list them): a Tech-app language switch and Vietnamese SMS templates are OUT of scope
by this ruling. The Vietnamese POS stays as it is: POS screens, POS announcements, the POS-printed pay stub, POS AI explanations.
All 1,168 Vietnamese POS DRAFT strings were approved by Kevin on Nov 9 2026 (`vi-drafts.mjs --approve all`; review sheet now 0 rows).
