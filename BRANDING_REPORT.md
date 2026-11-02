# BRANDING_REPORT.md — AI PowerSalon official logo + brand system

Applied your exact supplied logo as the locked official platform asset and centralized branding across the
merged monorepo. The logo was **not** redrawn, recolored, or cropped — square icons use safe padding only.

## 1. Deep branding scan summary
Scanned all 9 apps + the API. Found: a placeholder logo generator (`brand/make_brand_assets.py`) producing
generic gold **"A"** icons; per-app placeholder adaptive icons (`assets/icon-*.png`); cream/gold colors
**duplicated** in every app's `styles.css` and hardcoded across ~30 screens; **no** central brand config,
shared logo component, or `/platform/branding` endpoint; inconsistent titles ("AIPowerSalon" vs "AI PowerSalon");
**no** favicons or web manifest; each shell using its own placeholder mark (`.mk` square + text). Backend sends
plain SMS/email (no HTML templates) and had no branding settings.

## 2. Every logo asset found
- `brand/make_brand_assets.py` → generated `apps/*/assets/icon-only.png`, `icon-foreground.png`,
  `icon-background.png` (placeholder "A" marks). No real logo committed anywhere.

## 3. Official asset selected
Your uploaded PNG → saved untouched as **`brand/aipowersalon-logo-original.png`** (LOCKED). Technically
optimized copies preserving exact artwork: `aipowersalon-logo.png` (600px), `.webp`, `favicon.ico` + 16/32,
`apple-touch-icon.png`, `app-icon-192/512.png`, and adaptive `icon-only/foreground/background.png`.

## 4. Duplicate / outdated assets removed or retired
- `make_brand_assets.py` → renamed `make_brand_assets.DEPRECATED.py` (retired; do not use).
- All placeholder "A" adaptive icons in `apps/*/assets/` **replaced** with the real logo (via sync script).
- Placeholder `.mk` brand squares removed from the Admin and POS shells.

## 5. Pages and apps updated
- **index.html (all 8 web apps):** consistent `<title>` "AI PowerSalon — <App>", favicon + apple-touch +
  `manifest.webmanifest` + `theme-color` + logo preload + `brand-tokens.css` link.
- **Super Admin shell (AdminLayout):** real logo in the persistent sidebar + **"SUPER ADMIN"** role label;
  collapsed-rail keeps the logo (scaled). Status card text fixed to "AI PowerSalon Platform".
- **Reception POS shell (POSLayout):** real logo in the persistent sidebar.
- **Login screens (admin, pos, owner, tech, customer):** placeholder wordmark/"A" replaced with the logo.
- **public/brand/** populated in all 8 apps (logo, icons, favicon, tokens, manifest).

## 6. Shared branding components added
- `brand/PlatformLogo.tsx` — shared React logo component (variants full/mark/appIcon; stable dimensions;
  no filters), synced into every app's `src/brand/`.

## 7. Shared theme / color tokens added
- `brand/brand-tokens.css` — `--brand-*` tokens (gold/cream + semantic) plus back-compat aliases
  (`--gold/--page/--line/…`) so existing components map to one source. Linked from every app's index.html.
- `brand/platform-brand.ts` — `PLATFORM_BRAND` config (name, tagline, asset paths, colors, fonts).

## 8. Backend branding APIs added
- **`GET /platform/branding`** (public; excluded from tenant middleware) — safe config for every frontend,
  with a local default fallback if the DB is unavailable. Never returns storage credentials.
- **`/super-admin/settings/branding`** (SuperAdminGuard): `GET` view, `PATCH` colours/tagline (hex-validated),
  `POST /restore` defaults, `POST /logo` → **locked** (refuses with 423 unless `BRANDING_ALLOW_LOGO_REPLACE=true`
  **and** `super_admin.branding.asset.upload`; even then routes to the offline pipeline by policy).

## 9. Database / settings changes
- Migration **`104_platform_branding.sql`** — additive single-row `platform_branding` table (colour/tagline
  overrides only; logo stays locked in assets). No existing table altered.

## 10. Super Admin branding controls
View current branding, update brand colours/tagline (audited), restore defaults; the official logo asset is
locked from replacement.

## 11. Tenant branding separation
Platform logo lives in the application shell and is never overwritten by tenant uploads. Tenant identity is a
separate concern with its own permissions (`owner.tenant_branding.view/update`); owners cannot touch platform
branding (`super_admin.branding.*` is SUPER_ADMIN-only).

## 12. Email / receipt / report branding
- `brand/email-layout.ts` → **`renderBrandedEmail()`**: one shared HTML email layout (logo header, warm-white
  body, gold CTA, footer, plain-text fallback). Wired into the notifications/reminders **email** send path, so
  every outbound email is branded from one place. (Backend has no PDF/receipt templates today — receipts render
  client-side; those screens use the shared tokens. Flagged for manual review in §17.)

## 13. PWA / favicon / app icons
Favicon (ico + 16/32), apple-touch-icon, `manifest.webmanifest` (theme `#A96F22`, icons 192/512) added to all
8 web apps. Native Capacitor adaptive icons refreshed from the real logo.

## 14. Permissions added
`super_admin.branding.view/update/asset.upload/asset.restore` (SUPER_ADMIN only) and
`owner.tenant_branding.view/update` (owners) added to the `rbac.ts` catalog.

## 15. Audit logs added
Branding actions write to `audit_logs`: `platform_branding_updated`, `branding_cache_invalidated`,
`platform_logo_restored`, `platform_logo_upload_attempt`. Payload includes actor user id, role, action,
changed keys, timestamp. No credentials logged.

## 16. Tests and builds completed
- **API `tsc --noEmit`: 0 errors** (branding module, email layout, rbac, migration).
- **admin-web `tsc --noEmit`: 0 errors.**  **pos-web `tsc --noEmit`: 0 errors.**
- Ported notifications + reminders core specs still pass (**29/29**, **21/21**) after the email-layout wrap.
- `manifest.webmanifest` validated as JSON; all 8 apps verified to have `public/brand/*`; shells + logins
  verified to reference the real logo; placeholder generator retired.

## 17. Remaining pages still requiring manual review
- **Owner / Tech / Customer / Kiosk / Display shells** are mobile bottom-nav layouts where each screen renders
  its own header (no persistent sidebar). Logos were applied to their **logins**; if you want the logo in every
  in-app screen header, those headers need per-screen wiring (or a shared `AppHeader` using `PlatformLogo`).
- **~30 screens with hardcoded hex** still use literal cream/gold values (identical to the tokens, so visually
  consistent). Migrating them to `--brand-*` is mechanical cleanup, not a correctness issue.
- **Dynamic branding consumption:** apps currently load brand assets/tokens statically from `/brand/*` (works
  offline). To make Super-Admin colour overrides flow live, add a small branding provider that fetches
  `GET /platform/branding` on boot and sets the `--brand-*` variables (endpoint + defaults are ready).
- **Native mobile builds** (Capacitor iOS/Android) and **PDF/receipt** generation were not built/regenerated
  here — icons are staged in `apps/*/assets/`; run each platform's icon-generation + build before release.
- Full per-app `vite build` for all 9 frontends was not run in this session (deps installed only for api +
  admin-web + pos-web). Run `npm install && npm -ws run build` before deploy.

## How to re-sync branding
Edit only `brand/` (the single source), then run `node scripts/sync-brand.mjs` to redistribute to all apps.

---

## Continuation (round 2) — persistent logo on remaining apps + live colour overrides

Addressed the top items previously flagged for manual review.

### Persistent brand bar (logo on EVERY screen, never changes on navigation)
Added a slim sticky brand bar carrying the official logo to each mobile/device persistent shell, so the logo
appears on every screen of these apps and is part of the shell (not per-page):
- **Owner app** (`OwnerLayout`) — brand bar above the branch selector + scroll area.
- **Technician app** (`TechLayout`) — brand bar above the main scroll area.
- **Customer app** (`CustomerLayout`) — sticky brand bar above the content column.
- **Customer Display / Kiosk** (`customer-display` App) — replaced the placeholder "N" mark in the device
  frame with the official logo; the **tenant salon name now renders as secondary identity** beside it
  (platform logo primary, tenant secondary — per the platform-vs-tenant rule).

### Live branding overrides (dynamic, with locked-default fallback)
- Added `brand/branding-client.ts` → `applyPlatformBranding()`: fetches `GET /platform/branding` at boot and
  applies any Super-Admin colour/tagline overrides by setting `--brand-*` CSS variables at runtime. Best-effort
  — on any failure it no-ops, since `brand-tokens.css` already loaded the locked defaults (fully offline-safe).
  The logo is never changed dynamically (locked, served statically).
- Wired `applyPlatformBranding()` into the entry points of admin-web, pos-web, owner-web, tech-web, customer-web.
- Synced into every app via `scripts/sync-brand.mjs` (now also distributes `branding-client.ts`).

### Validation (round 2)
- `tsc --noEmit`: **admin-web, pos-web, owner-web, tech-web, customer-web, customer-display → 0 errors each.**
- API unchanged this round (still 0 errors; notifications/reminders specs 29/29 + 21/21 from round 1).

### Still optional / manual
- The ~30 hardcoded-hex screens (cosmetically identical to tokens) remain a mechanical token-migration cleanup.
- `go-check-in-kiosk` ships as prebuilt `www/` (Capacitor) — favicon/title updated; regenerate its build to
  pick up `public/brand/` for the in-page logo.
- Native iOS/Android icon regeneration + `vite build` of all 9 apps before release.
