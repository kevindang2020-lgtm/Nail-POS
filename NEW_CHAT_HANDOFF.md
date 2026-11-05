# AI PowerSalon — New Chat Handoff

Everything a fresh Claude chat needs to continue. Accurate to this package.
**A full 31-section audit was NOT performed.** What was verified is stated plainly; open work is listed honestly.

> **Latest verification (2026-06-22):** whole monorepo green — typecheck clean on all 7 real apps (0 TS errors), **280 vitest files / 1,356 tests + 43 api core-specs passing, 0 failures**, all 7 apps build, and the end-to-end money path (check-in → paid) passed live against Postgres. Read **`CHANGELOG_CODEBASE_REPAIR.md`** and **`project-handoff.json`** first for the current state, findings, and the deep-audit phases (security / a11y / perf / automated-browser route testing) that remain.

## 1. What this is
The complete AI PowerSalon monorepo (npm workspaces) — the canonical source, not a demo. Any standalone
HTML files elsewhere are visual previews only and are NOT part of this code.

## 2. Applications (9 workspaces under apps/)
- api (@aipowersalon/api) — NestJS + Kysely + Postgres 16 — backend for all apps (70 modules)
- pos-web (aipowersalon-pos-web) — Vite+React — tenant POS (shell, Overview, workflow)
- admin-web — Super Admin console
- owner-web — Owner / multi-location app
- tech-web — Technician app
- customer-web — Customer app
- customer-display — customer-facing display
- go-check-in-admin / go-check-in-kiosk — Capacitor check-in kiosk shells
Payments: Fiserv (CardPointe/CardPointe-Bolt) + Clover only (Square/Stripe removed).

## 3. Verified test baseline (run this session)
- api: tsc clean, 623 tests (90 files) pass
- pos-web: tsc clean, vite build OK, 84 tests (31 files) pass
- Last-verified earlier this session (not re-run this turn): admin-web 168, owner-web 85, tech-web 74, customer-web 136, customer-display 26.
- Total when all run: ~1,196 tests; 7 buildable workspaces typecheck clean. (go-check-in-* are native shells, no TS src.)
Re-run a workspace: npm install --workspace <name> ; ../../node_modules/.bin/vitest run

## 4. Run the real stack locally (needs Postgres 16)
  npm install
  export DATABASE_URL="postgres://user@localhost:5432/aipowersalon"
  cd apps/api && node scripts/migrate.mjs && npm run seed
  REPO_DRIVER=postgres PORT=3001 AUTH_SESSION_SECRET=<32+chars> MFA_ENC_KEY=<32 bytes> DATABASE_URL=$DATABASE_URL npm run start:dev
  cd ../pos-web && npm run dev   # http://localhost:5173
Seed sign-in: SUPER_ADMIN admin@aipowersalon.com + password + any 6-digit code; OWNER salon code PILOT01 + owner@pilotsalon.com + password.
Required env (.env.example): DATABASE_URL, AUTH_SESSION_SECRET, MFA_ENC_KEY, REPO_DRIVER. Frontend reaches API same-origin by default; cross-origin needs API WEB_CORS_ORIGINS to include the frontend origin (session uses aps_session cookie). REPO_DRIVER=postgres uses the real DB; unset = in-memory dev adapters.

## 5. PROVEN this session (actually run, not asserted)
- Installed Postgres, applied all 109 migrations (178 tables), seeded the DB.
- Booted the real API healthy against Postgres (/health ok).
- Login worked: POST /auth/login as OWNER -> 200 SUCCESS, real tenantId/branchId/role/permissions.
- Overview served: GET /pos/overview/state -> 200 with real KPIs/queues/analytics (after seeding a day: revenue $710.40, 5 waiting, 3 serving, 2 ready, 6/8 staff, 4.7 stars).
- POSOverviewScreen.tsx is the default route and renders all panels (KPIs, Arrivals, Tech Queue, Service Flow, Appointments, Communications, AI Insights, Revenue Trend, Technician Performance, Retention, Payment Mix, Inventory Alerts, Quick Actions).

## 6. Fixes applied this session (file detail in FIXES_APPLIED_VERIFIED.md)
- Migration bug fixed: 107_pos_search_indexes.sql indexed the appointments table that 041_drop_legacy_appointments.sql drops -> guarded to run only if the table exists. Fresh-DB migration now clean.
- Topbar: date/time clock + notification bell + message control (POSLayout.tsx).
- Live nav badges (tenant-navigation.service.ts): real notifications/inventoryAlerts/techReportsPending, removed hardcoded zeros; endpoint GET /tenant/navigation/badges.
- Inventory module + migration 108.
- Overview "Add Product" quick action -> /tenant/inventory (was stale /services).
- Sidebar/topbar tokens aligned to Overview preview (sidebar 248px, --sidebar #FEFDFC, --text #2A2118, --muted #8A7A66, --line #E7DCC9, --grad 135deg #F3D58C->#D8A646).
- Payment integrity (earlier): per-tenant gateway gating, Fiserv/Clover only, void-path, surcharge.

## 7. Open work / NOT done (be honest next chat)
- Full notification + message panels (filters, mark-as-read) — currently minimal.
- Per-role nav build-out (receptionist/technician filtered nav) — not fully implemented.
- Full 45-item test/isolation matrix (cross-tenant, payment, inventory, AI-gate, search-security, realtime) NOT run this session — only existing suites verified.
- Repo-wide lint not run this session.
- Several spec map docs (ROUTE_API_MAP, PERMISSIONS_MATRIX, etc.) not all generated.

## 8. External blockers (cannot resolve in sandbox)
- Live Fiserv/CardPointe + Clover merchant credentials (UAT probe: apps/api/scripts/*uat*).
- Twilio A2P 10DLC live messaging; Apple Developer signing for native apps.
- Production Postgres + secrets (AUTH_SESSION_SECRET, MFA_ENC_KEY) you must set.

## 9. Conventions (important)
- Money is integer cents everywhere. Tenant scope via scoped() Kysely helper + TenantContextMiddleware (application-level, not Postgres RLS in prod).
- Mac-fit shell: html/body/#root/.shell/.main all height:100vh overflow:hidden; inner grid grid-template-rows:minmax(0,1fr) so tables scroll internally. Fits 1440x900 min and 1920x1080 @100%.
- Cream/gold tokens centralized in apps/pos-web/src/styles.css :root. Don't hardcode golds per page.
- No duplicate Sidebar/Topbar/Layout — POSLayout.tsx is canonical. Keep it that way.

## 10. To continue in a new Claude chat, paste this:
"This is the AI PowerSalon monorepo (npm workspaces, NestJS/Kysely/Postgres + 6 React/Vite frontends). Read NEW_CHAT_HANDOFF.md and FIXES_APPLIED_VERIFIED.md first. Verified baseline: api 623 + pos-web 84 tests pass, tsc clean. The real stack boots and authenticates. Do NOT create duplicate sidebars/topbars/layouts — POSLayout.tsx is canonical. Money is integer cents; tenant scope via scoped(). Work on ONE slice: <e.g. notification+message panels | per-role nav | tenant-isolation test suite | payment audit>. Scan the relevant code first, then implement + run that slice's tests before moving on."

Pick ONE slice per chat. Trying all 31 sections at once produces shallow, unverified work.
