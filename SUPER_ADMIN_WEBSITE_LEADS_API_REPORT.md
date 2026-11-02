# SUPER_ADMIN_WEBSITE_LEADS_API_REPORT.md

All routes under `@Controller('super-admin/website-leads')` + `@UseGuards(SuperAdminGuard)` (super-admin only). Errors:
`WebsiteLeadsError('not_found')` → 404, `('bad_request')` → 400.

| Method | Path | Purpose | DB |
|---|---|---|---|
| GET | `/state` | One-shot: kpis, filters, leads (filtered+paginated, assignee names), pagination, analytics{bySource,byStatus,topSources}, recentActivity, permissions, sources, statuses, assignableUsers | website_leads, lead_activities, users |
| GET | `/kpis` | KPI rollup + MoM trends | website_leads |
| GET | `/analytics/by-source` | Donut data | website_leads |
| GET | `/analytics/by-status` | Status bars | website_leads |
| GET | `/analytics/top-sources` | Ranked sources + growth | website_leads |
| GET | `/recent-activity?limit=` | Activity feed | lead_activities |
| GET | `/export?…filters` | CSV of filtered leads (text/csv attachment) | website_leads |
| GET | `/` (list) | Filtered + paginated leads | website_leads |
| POST | `/` | Create lead (auto-scored), logs `created` activity + audit | website_leads, lead_activities, audit_logs |
| GET | `/:id` | Lead + activities + follow-ups | website_leads, lead_activities, lead_follow_ups |
| PATCH | `/:id` | Edit fields (+ optional manual score) | website_leads, audit_logs |
| PATCH | `/:id/status` | Set status (validated) + activity + audit | website_leads, lead_activities, audit_logs |
| PATCH | `/:id/assign` | Assign rep + activity + audit | website_leads, lead_activities, audit_logs |
| POST | `/:id/notes` | Add note (activity) + audit | lead_activities, audit_logs |
| POST | `/:id/follow-ups` | Schedule follow-up (+ sets next_follow_up_at) + activity + audit | lead_follow_ups, website_leads, audit_logs |
| POST | `/:id/convert-to-application` | Create tenant_applications row, flip to converted, idempotent, activity + audit | tenant_applications, website_leads, lead_activities, audit_logs |
| POST | `/:id/recalculate-score` | LeadScoringService recompute + activity + audit | website_leads, lead_activities, audit_logs |

Route ordering: literal sub-routes (`state`, `kpis`, `analytics/*`, `recent-activity`, `export`) are declared before `:id`
so they are not captured as an id. The basic `/super-admin/platform/leads` endpoints remain for back-compat over the same table.
