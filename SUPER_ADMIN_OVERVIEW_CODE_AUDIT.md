# Super Admin Overview — Code Audit (audit-first, before building)

Audited the existing Super-Admin surface before writing anything. Conclusion: the shell, sidebar, header, badges, and
bottom status card already match the design and were **kept**. A real Overview screen existed but was a simpler 12-KPI +
plan-distribution view — it was **expanded in place** (no new Overview page). No modules, routes, or tables were
duplicated.

| Path | What it does | Layer | Decision | Duplicate | Mock data | Backend-connected | Missing |
|---|---|---|---|---|---|---|---|
| `admin-web/src/shell/AdminLayout.tsx` | Persistent sidebar (all modules + live badges), header (search, Create Tenant, Add Lead, profile), bottom status card | FE | **Keep + reorder** to design order | No | No | Yes (`platformState`) | Sidebar order vs design |
| `admin-web/src/App.tsx` | Routes incl. `/dashboard` = Overview, gated behind login | FE | **Keep** | No | No | n/a | — |
| `admin-web/src/screens/DashboardScreen.tsx` | Overview: 12 KPI cards + plan-distribution bar | FE | **Fix/expand in place** to full design | No (same route) | No | Yes (`dashboard`,`platformState`) | charts, donuts, alerts, banner, top tenants, apps table, bottom KPIs, quick actions, activity feed |
| `admin-web/src/api/superAdminApi.ts` | Rich SA client (tenants, apps, leads, hardware, ai, usage, users, reports, billing, hw-payment…) | FE | **Keep**; add a focused overview client | No | No | Yes | a consolidated overview client |
| `api/super-admin-dashboard/*` | `GET /super-admin/dashboard` (totals, MRR, plan dist) via core+port+kysely | BE | **Keep** | No | No (zeros when no DB) | Yes | — |
| `api/super-admin-platform/*` | `GET /super-admin/platform/{state,applications,leads,hardware,audit-logs,reports,...}` | BE | **Keep / reuse** | No | No | Yes | a single overview aggregate |
| `api/super-admin-health/*` | `GET /super-admin/system-health` | BE | **Keep** | No | No | Yes | — |
| `api/super-admin-tenants`,`-billing`,`-owners`, `hardware-payment.super-admin.*` | tenants, subscriptions, owners, hardware-payment SA routes | BE | **Keep** | No | No | Yes | — |

**New code added (only what was missing):** `api/super-admin-overview/*` (dto, core, repository, kysely.repository,
service, controller, module) + `admin-web/src/api/superAdminOverviewApi.ts` + the rebuilt `DashboardScreen.tsx` + CSS.

**Rules honored:** no duplicate Overview page (same `/dashboard` route, same component name); same logo/colors/sidebar
style (cream `--page #F7EFE3`, gold `--g7 #A96F22`, Playfair/Hanken); merged existing UI; no production mock data
(zeros render as empty states); everything wired to backend or listed as a documented blocker.
