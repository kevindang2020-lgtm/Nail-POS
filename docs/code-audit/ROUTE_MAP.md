# ROUTE_MAP (frontend)

_Screen inventory per frontend. Counts measured this pass; some apps register screens via a route-config object / nested routers, so the visible-screen count tracks `.tsx` screens better than a raw `path:` grep._

| App | Router pattern | Screens (tsx) |
|---|---|---|
| pos-web | React Router, 14 top-level route entries | 75 |
| admin-web | Route config + nested | 65 |
| customer-web | Route config + nested | 100 |
| owner-web | Route config + nested | 45 |
| tech-web | React Router | 41 |
| customer-display | Single device view (session/device modes) | 4 |

POS modules (canonical floor + back-office, all wired to the same checkout/ticket records): Dashboard, Check-In, Booking, Tech Queue, Customer Queue, Serving, Service Done, Checkout, Customers, Team, Services & Products, Payments & Money, Communications, Marketing, AI Center, Reports, Management, Devices & Integrations, Account, Help.

Super-Admin modules: Overview/Dashboard, Analytics, Branches/Tenants, Users & Roles, Services, Products, Appointments, Customers, Staff, Booking & Check-in, Queue, Payments & Transactions, Marketing, Promotions, Loyalty, Communications, AI Insights, AI Reports, Reminders, Automation, Settings, Billing, Integrations, Devices, Security & Compliance, Audit Logs, Help, System Status.

Detailed per-screen wiring already documented in root reports (`APPLICATION_MAP.md`, `TENANT_SIDEBAR_REPORT.md`, `SUPER_ADMIN_*`). Phase 1 will produce an exhaustive route enumeration if required.
