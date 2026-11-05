# AI PowerSalon Official Logo — Locked Brand Asset

`brand/aipowersalon-logo-original.png` is the **locked, protected** official logo. All other brand images in
`brand/` are *technically optimized copies* of that exact artwork (resized / re-encoded / letterboxed onto a
square for icons) — none are redraws or recolors.

## Rules (enforced by convention + backend lock)
- Do NOT redraw, regenerate, recolor, add filters, stretch, squeeze, crop, or rotate the artwork.
- Do NOT change the lettering or the woman/profile emblem.
- Do NOT swap the logo per route, per role, per module, or during loading/refresh — it lives in the
  persistent app shell and the shared `PlatformLogo` component.
- Do NOT let tenant uploads overwrite the platform logo. Tenant logos are *secondary* identity only.
- Square icons (favicon / app icon) use **safe padding**, never a crop of the artwork.

## Source of truth
- Config: `brand/platform-brand.ts` (`PLATFORM_BRAND`)
- Tokens: `brand/brand-tokens.css` (`--brand-*`)
- Component: `packages/ui/src/brand/PlatformLogo.tsx` — imported as `import { PlatformLogo } from '@aipowersalon/ui'` (Constitution 13 Phase 5; no longer copied into apps)
- Backend: `GET /platform/branding` returns the locked default; replacing the official asset is disabled
  unless `BRANDING_ALLOW_LOGO_REPLACE=true` AND the actor holds `branding.asset.upload`. Every change is audited.
- Distribution: `node scripts/sync-brand.mjs` copies the public assets + tokens into every app (each app serves its own `/brand/*`). The component and config are shared source in `@aipowersalon/ui`, never copied.

The placeholder generator `make_brand_assets.DEPRECATED.py` (gold "A" icons) is RETIRED — do not use it.
