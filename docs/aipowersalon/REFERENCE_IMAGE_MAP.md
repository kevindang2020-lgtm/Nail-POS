# REFERENCE IMAGE MAP — AI PowerSalon (Phase 0)

44 authoritative reference images (`reference_images/`, manifest codes) + 5 pictureless Super Admin screens. Target app + existing-code decision per the canonical-app decisions (pos-web = tenant, admin-web = super admin). KEEP+align = existing screen, refactor presentation to the picture, preserve business logic. BUILD = missing screen on the canonical shell.

## Tenant (pos-web) — shell: `tenant-nav.tsx` + `POSLayout` (canonical)
| Code | Screen | File | Decision |
|---|---|---|---|
| T01 | Dashboard | T01_Tenant_Dashboard.png | KEEP+align (POSDashboard/Overview) |
| T02 | Analytics | T02_Tenant_Analytics.png | BUILD (reuse report services) |
| T03 | Check-In | T03_Tenant_Check_In.png | KEEP+align |
| T04 | Booking | T04_Tenant_Booking.png | KEEP+align |
| T05 | Tech Queue | T05_Tenant_Tech_Queue.png | KEEP+align |
| T06 | Customer Queue | T06_Tenant_Customer_Queue.png | KEEP+align |
| T07 | Serving | T07_Tenant_Serving.png | KEEP+align |
| T08 | Service Done | T08_Tenant_Service_Done.png | KEEP+align |
| T09 | Checkout | T09_Tenant_Checkout.png | KEEP+align |
| T10 | Customers | T10_Tenant_Customers.png | EXPAND |
| T11 | Team | T11_Tenant_Team.png | EXPAND (Technicians→Team) |
| T12 | Services & Products | T12_Tenant_Services_And_Products.png | MERGE (Services+Inventory) |
| T13 | Payments & Money | T13_Tenant_Payments_And_Money.png | BUILD subsections |
| T14 | Communications | T14_Tenant_Communications.png | EXPAND (Messages→inbox) |
| T15 | Marketing & Growth | T15_Tenant_Marketing_And_Growth.png | BUILD |
| T16 | AI Center | T16_Tenant_AI_Center.png | BUILD (tenant) |
| T17 | Reports | T17_Tenant_Reports.png | KEEP+align |
| T18 | Management | T18_Tenant_Management.png | BUILD command center |
| T19 | Devices & Integrations | T19_Tenant_Devices_And_Integrations.png | BUILD |
| T20 | Account | T20_Tenant_Account.png | KEEP+align (Settings→Account) |
| T21 | Help Center | T21_Tenant_Help_Center.png | BUILD |

## Super Admin (admin-web) — shell: `AdminLayout` reshaped to S01 IA (canonical)
| Code | Screen | File | Decision |
|---|---|---|---|
| S01 | Overview | S01_Super_Admin_Overview.png | KEEP+align (split from Dashboard) |
| S02 | Dashboard | S02_Super_Admin_Dashboard.png | KEEP+align |
| S03 | Analytics | S03_Super_Admin_Analytics.png | BUILD |
| S04 | Branches | S04_Super_Admin_Branches.png | BUILD |
| S05 | Users & Roles | S05_Super_Admin_Users_And_Roles.png | KEEP+align |
| S06 | Services | S06_Super_Admin_Services.png | BUILD |
| S07 | Products | S07_Super_Admin_Products.png | BUILD |
| S08 | Appointments | S08_Super_Admin_Appointments.png | BUILD |
| S09 | Payments & Transactions | S09_Super_Admin_Payments_And_Transactions.png | EXPAND (gateways+hardware) |
| S10 | Marketing & Campaigns | S10_Super_Admin_Marketing_And_Campaigns.png | BUILD |
| S11 | Promotions & Offers | S11_Super_Admin_Promotions_And_Offers.png | BUILD |
| S12 | Communications | S12_Super_Admin_Communications.png | BUILD |
| S13 | AI Insights | S13_Super_Admin_AI_Insights.png | BUILD |
| S14 | AI Reports | S14_Super_Admin_AI_Reports.png | BUILD |
| S15 | Smart Reminders | S15_Super_Admin_Smart_Reminders.png | BUILD (on follow-up engine) |
| S16 | Automation Rules | S16_Super_Admin_Automation_Rules.png | BUILD |
| S17 | General Settings | S17_Super_Admin_General_Settings.png | KEEP+align (tabs) |
| S18 | Billing & Subscription | S18_Super_Admin_Billing_And_Subscription.png | MERGE (Billing+UsageLimits+Subscriptions) |
| S19 | Integrations | S19_Super_Admin_Integrations.png | BUILD |
| S20 | Devices Management | S20_Super_Admin_Devices_Management.png | EXPAND (CheckInDevices+Hardware) |
| S21 | Security & Compliance | S21_Super_Admin_Security_And_Compliance.png | BUILD |
| S22 | Audit Logs | S22_Super_Admin_Audit_Logs.png | KEEP+align (unify) |
| S23 | Help Center | S23_Super_Admin_Help_Center.png | BUILD |
| — | SA Customers | (pictureless) | BUILD (tenant-aware, audited) |
| — | SA Staff/Technicians | (pictureless) | BUILD |
| — | SA Booking & Check-in | (pictureless) | BUILD |
| — | SA Queue Management | (pictureless) | BUILD |
| — | SA Loyalty Programs | (pictureless) | BUILD |

## Shell consistency (your instruction)
- Two canonical shells only: tenant (ivory, operational-first sidebar) and super-admin (bright-white, grouped sidebar). Verified T01 and S01 define them. Every screen in each app uses the SAME shell; any per-image sidebar drift is normalized to the canonical sidebar + active-state. Detailed per-image layout study happens at each screen's implementation phase.
