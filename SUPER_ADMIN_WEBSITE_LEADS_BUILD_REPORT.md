# SUPER_ADMIN_WEBSITE_LEADS_BUILD_REPORT.md

Upgraded the existing basic Website Leads into the full design — extended the existing `website_leads` table (no parallel
datastore), built a rich Super-Admin surface over it, and replaced the basic screen with the design page.

## What was added (only the missing parts)
**Database** — `apps/api/db/migrations/094_website_leads_enrichment.sql`
- ALTER `website_leads`: + contact_name, source (channel), lead_score, assigned_to_user_id, next_follow_up_at,
  current_pos, technician_count, monthly_card_volume_cents, archived_at; status CHECK broadened to
  new/contacted/qualified/converted/unqualified/lost/spam/archived (legacy values kept).
- New `lead_activities` (one feed: created/note/status_change/assigned/converted/follow_up_scheduled/score_changed) and
  `lead_follow_ups` (open/completed/cancelled lifecycle).

**Backend** — `apps/api/src/super-admin-website-leads/`
- `website-leads-core.ts` — pure: computeLeadKpis (real MoM trends from created_at), computeLeadScore (0–100 from
  volume/techs/contactability/message/source), scoreBand, filterLeads, paginate, analyticsBySource/byStatus/topSources.
- `website-leads.repository.ts` — port + InMemoryWebsiteLeadsRepo (empty, honest) + KyselyWebsiteLeadsRepo (guarded raw sql).
- `website-leads.service.ts` — state aggregation, list, kpis, analytics, recent activity, getLead, create (auto-score),
  update, setStatus, assign, addNote, scheduleFollowUp, convertToApplication (creates `tenant_applications` row +
  flips to converted + idempotent), recalculateScore, exportCsv. Audited via audit_logs (`super_admin_website_lead_*`).
- `super-admin-website-leads.module.ts` — controller `@Controller('super-admin/website-leads') @UseGuards(SuperAdminGuard)`
  + DI factory (Kysely when DB present, else InMemory). Registered in `app.module.ts`.

**Frontend** — `apps/admin-web/src/`
- `api/superAdminWebsiteLeadsApi.ts` — typed client (state + every action + exportUrl) + `useSuperAdminWebsiteLeadsState()`.
- `screens/WebsiteLeadsScreen.tsx` — the design page: header (Export/Refresh/Add Lead), 6 KPI cards w/ trends,
  URL-synced filter bar (debounced search + Source/Status/Lead Score/Date + Clear), leads table (avatar/contact/source
  dot/score badge/status pill/follow-up/created/assignee/actions menu), pagination, Leads-by-Source donut,
  Leads-by-Status bars, Top Lead Sources, Recent Lead Activity, Add Lead modal, Lead detail drawer.
- Route `/website-leads` repointed from the basic `LeadsScreen` to `WebsiteLeadsScreen`.

## Design fidelity
Cream/gold tokens (`--g7`, `--cream2`, `--gline`, `--ok/--warn/--danger`) and existing classes (work/vh/panel/kpis/kpi/
ttable/btn/pill/state/err) reused. Sidebar + header are the existing AdminLayout shell (already match the design; the
`/website-leads` nav entry + leads badge already existed and were left intact).

## Verification
- API: `tsc --noEmit` clean; full suite **583 passed** (`RESULT: PASS`), incl. 11 new Website Leads specs.
- admin-web: `tsc --noEmit` clean; **101 passed** (incl. 3 new screen specs); `vite build` clean.
