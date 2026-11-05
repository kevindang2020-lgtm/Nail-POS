# Dashboard Testing Checklist
## Automated (passing)
- api tsc 0; `dashboard-metrics.spec.ts` 12/12; full api vitest 623/623.
- pos-web tsc 0; vite build OK; full pos-web vitest 84/84 (incl. rebuilt `POSDashboardScreen.test.tsx`).
## Manual (maps to spec §30)
/dashboard opens; sidebar unchanged + Dashboard highlighted; 8 KPI cards render with derived metrics;
Revenue & Sales Trend area chart; Salon Snapshot; Live Service Floor (in-progress); Today's Schedule with
technician filter; Customer Activity tabs; Top Technicians; Inventory Alerts match the inventory ledger;
AI Insights locked without a package; Payment Snapshot donut sums to total; Quick Actions navigate;
card-level loading/empty/error; one card failure never crashes the page; tenant/location scoping enforced
server-side.
