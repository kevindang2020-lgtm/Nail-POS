# SUPER_ADMIN_WEBSITE_LEADS_CODE_AUDIT.md

Audited the full repo before writing any code. Website Leads already exists in a **basic** form; this work **extends and
upgrades it in place** — it does not create a second leads system.

## Existing assets

| File/folder | What it does | Layer | Decision | Duplicate? | Mock data? | Backend-connected? | Missing |
|---|---|---|---|---|---|---|---|
| `apps/api/db/migrations/060_super_admin_platform.sql` → `website_leads` | Leads table: id, kind, name, salon_name, phone, email, city, state, source_page, message, status(new/contacted/demo_scheduled/converted_to_application/archived/spam), notes(jsonb), application_id | DB | **Extend** (add columns, broaden status) | No | No | — | lead_score, contact_name, source channel, assigned_to, next_follow_up, current_pos, technician_count, monthly_card_volume_cents; qualified/unqualified/lost statuses |
| same → `tenant_applications` | Applications table (salon_name, owner_name, …, status, converted_tenant_id) | DB | **Keep / reuse** (convert target) | No | No | — | link back to originating lead |
| `apps/api/src/super-admin-platform/*` (controller/service/repository) | `GET/POST /super-admin/platform/leads`, `/leads/:id/status`, `/leads/:id/convert`; applications endpoints | Backend | **Keep** (basic surface) + **build rich surface alongside on same table** | No | No (InMemory returns empty) | Yes | KPIs, analytics, assign, follow-ups, notes-as-activity, recalculate-score, rich filters, state endpoint, export |
| `apps/api/src/super-admin-platform/public-website.controller.ts` | Public `POST /leads` + `/applications` (website form intake) | Backend | **Keep** (this is how leads arrive) | No | No | Yes | maps new columns (source channel, score) |
| `apps/admin-web/src/screens/LeadsScreen.tsx` (83 lines) | Basic Website Leads page: kind tabs, simple list, Mark Contacted / Convert / Spam | FE | **Replace** with the full design page (upgrade in place) | No | No | Yes | KPI cards, rich filter bar, full table (score/assigned/follow-up), Leads-by-Source/Status/Top-Sources panels, recent activity, Add Lead modal, detail drawer |
| `apps/admin-web/src/shell/AdminLayout.tsx` NAV | Sidebar already has `{ to:'/website-leads', label:'Website Leads', badge:'leads' }`, badge wired to `counts.newLeads` | FE | **Keep as-is** (already matches spec) | No | No | Yes | nothing |
| `apps/admin-web/src/App.tsx` | Route `website-leads` → `LeadsScreen` | FE | **Repoint** to the new screen | No | — | — | — |
| `apps/admin-web/src/api/superAdminApi.ts` | `leads/createLead/leadStatus/leadConvert` over `/super-admin/platform/leads` | FE | **Keep** + add rich `websiteLeads*` methods | No | No | Yes | the rich endpoints |
| `apps/admin-web/src/screens/ApplicationsScreen.tsx` | Tenant Applications page (the convert target) | FE | **Keep** | No | No | Yes | — |

## Rules applied
- **No duplicate leads system.** One table (`website_leads`, extended), one convert target (`tenant_applications`).
- The rich Super-Admin surface is a new module (`super-admin-website-leads`) **over the same table** — additive endpoints,
  not a parallel datastore. The basic `/platform/leads` endpoints remain for back-compat.
- The sidebar entry + badge already exist and already match the design — left untouched.
- **No fabricated production data.** The mockup's 2,847/892/… are design values only; the InMemory adapter returns real
  zeros/empties (honest), the Kysely adapter reads real rows. An optional, clearly-labelled dev seed is provided so the
  page can be viewed populated.

## Build plan (only what's missing)
1. Migration: extend `website_leads`; add `lead_activities` (notes + status-changes + conversions + intake, one feed) and
   `lead_follow_ups` (scheduled follow-ups).
2. Backend module `super-admin-website-leads`: pure core (KPIs, scoring, analytics, filter), repo (InMemory + Kysely),
   service (audited, permission-gated), controller (state + list + analytics + recent-activity + CRUD + convert + notes +
   assign + follow-up + recalculate-score + export).
3. Frontend `WebsiteLeadsScreen` replacing `LeadsScreen` at `/website-leads` (full design), API client, tests.
