# SUPER_ADMIN_WEBSITE_LEADS_WIRING_AUDIT.md

Per-module FE → endpoint → DB → permission → status. All gated by SuperAdminGuard (super-admin only).

| Module | Frontend | Backend endpoint | DB source | Click action | Permission | Status |
|---|---|---|---|---|---|---|
| KPI cards | KPI in WebsiteLeadsScreen | GET /state (+ /kpis) | website_leads | (display; drill-down via filters) | website_leads.view | working |
| Search | filter bar input (debounced→URL) | GET /state?search | website_leads | filters table | view | working |
| Filters (Source/Status/Score/Date) | selects → URL params | GET /state?source/status/scoreRange/dateFrom | website_leads | filters table | view | working |
| Clear filters | Clear Filters button | GET /state | website_leads | resets URL | view | working |
| Lead table | WebsiteLeadsTable (rows) | GET /state | website_leads (+ users for assignee) | row→drawer | view | working |
| Pagination | pager | GET /state?page&limit | website_leads | page change | view | working |
| Lead detail drawer | LeadDrawer | GET /:id | website_leads, lead_activities, lead_follow_ups | opens drawer | view | working |
| Add Lead modal | AddLeadModal | POST / | website_leads, lead_activities, audit_logs | creates + reload | create | working |
| Export | Export button | GET /export?filters | website_leads | downloads CSV | export | working (CSV) |
| Refresh | Refresh button | GET /state | website_leads | reloads | view | working |
| Leads by Source | Donut | GET /state (analytics.bySource) | website_leads | click→source filter | view | working |
| Leads by Status | bars | GET /state (analytics.byStatus) | website_leads | click→status filter | view | working |
| Top Lead Sources | ranked list | GET /state (analytics.topSources) | website_leads | click→source filter | view | working |
| Recent Lead Activity | feed | GET /state (recentActivity) | lead_activities | (display) | view | working |
| Convert to Application | drawer + actions menu | POST /:id/convert-to-application | tenant_applications, website_leads, lead_activities, audit_logs | converts + reload | convert | working |
| Assign Rep | drawer select | PATCH /:id/assign | website_leads, lead_activities, audit_logs | assigns + reload | assign | working |
| Mark Contacted/Qualified | drawer + menu | PATCH /:id/status | website_leads, lead_activities, audit_logs | status + reload | edit | working |
| Add Note | drawer | POST /:id/notes | lead_activities, audit_logs | note + reload | edit | working |
| Recalculate Score | drawer + menu | POST /:id/recalculate-score | website_leads, lead_activities, audit_logs | rescore + reload | edit | working |
| Archive / Mark Spam | drawer + menu | PATCH /:id/status | website_leads, lead_activities, audit_logs | status + reload | archive / mark_spam | working |
| Schedule Follow-Up | (endpoint live; Add Lead sets next_follow_up) | POST /:id/follow-ups | lead_follow_ups, website_leads | sets follow-up | edit | partial (no in-drawer date picker yet) |

Notes: permissions returned all-true for super-admins; the guard already restricts the whole surface, so disabled actions
are about lifecycle (e.g. Convert disabled once converted), not RBAC. "Date Range" UI exposes a start date (dateFrom);
the backend also accepts dateTo. App-shell header (Create Tenant, bell, alerts, profile) + sidebar live in AdminLayout and
already match the design — not rebuilt by this page.
