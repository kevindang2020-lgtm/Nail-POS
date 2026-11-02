# AI PowerSalon — Current Merged State (verified)

Generated after a full-repo deep scan + validation. This package is the single source of truth;
older standalone HTML preview files are NOT part of this codebase.

## Workspaces (apps/*) — all typecheck clean
| Workspace | src files | test files | tests passing |
|---|---|---|---|
| api (@aipowersalon/api) | 611 | 133 | 623 |
| customer-web | 117 | 42 | 136 |
| admin-web | 77 | 31 | 168 |
| pos-web | 117 | 31 | 84 |
| owner-web | 55 | 18 | 85 |
| tech-web | 53 | 14 | 74 |
| customer-display | 12 | 3 | 26 |
| go-check-in-kiosk | Capacitor native shell (no TS src) | — | — |
| go-check-in-admin | thin entry (no TS src) | — | — |
| **Total** | | | **1,196 passing** |

## Most recent upgrades included
- Tenant POS topbar: live notification bell + message control + date/time clock; badges service now
  returns live `notifications` / `inventoryAlerts` / `techReportsPending` (no hardcoded counts).
- Inventory Management module (migration 108) + tenant/technician controllers + pos-web screen.
- Tenant Dashboard backend metric helpers + rebuilt POS dashboard screen.
- Payment integrity: per-tenant gateway gating, Fiserv/Clover only, void-path fixes, surcharge attribution.

## Hygiene
- No `.bak/.orig/.old/.rej` backup files. No duplicate Sidebar/Topbar/Layout variants.
- HTML files in-repo are legitimate Vite/Capacitor entry points + the marketing section.

## Validate locally
- API: `cd apps/api && tsc --noEmit -p tsconfig.json && vitest run`
- Any frontend: `cd apps/<name> && tsc --noEmit -p tsconfig.json && vitest run && vite build`
