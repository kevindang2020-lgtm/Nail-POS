# SUNMI batch 8 — Devices & Integrations, Account, Settings, Locations, Features (Nov 9 2026)

Twenty addendum PDFs (Customer_Displays_ is a duplicate of Customer_Displays). Every page below was built or fixed
against its guide; nothing was removed or renamed. Vietnamese text added in this batch is marked `// DRAFT — Kevin reviews`
(see docs/handoff/VI_DRAFT_REVIEW.md).

## What changed, page by page

| Guide(s) | Route | What was wrong | What was built / fixed |
|---|---|---|---|
| Reception_POS, CheckIn_Kiosks, Tablets, Receipt_Devices, Device_Assignments, Device_Health | /tenant/devices/* | Reception POS / Kiosk / Receipt pages always showed **0** — they filtered `customer_display_devices` by types that table never stores | New read-only **DeviceFleetCenter** (`pos/device-fleet` summary / devices / history / check) over the REAL registries (pos_stations, go_checkin_devices, customer_display_devices, pos_payment_terminals, mobile_pay_devices). One shared workspace: 4 KPIs, Devices / History tabs, server search, status, date field, From–To calendar, sort, numbered pages, device details, read-only health check |
| Device_Integration_Logs | /tenant/devices/logs | Empty — no device producer writes `tenant_event_logs` | Logs now page a UNION of tenant_event_logs + device audit_logs + go_checkin_logs (no second log store); 5 KPIs, search, From–To, pages, detail; layout overlap fixed |
| Customer_Displays (x2) | /tenant/devices/customer-displays | No find / health / history | Find box, Check button + health dialog, history panel (canonical audit) |
| Fiserv_Payment_Gateway | /tenant/integrations/payment-gateway | "Connected" badge described a *selection*, not a live connection | Relabelled "{processor} selected"; sandbox banner; connector + three-channel cards; readiness checklist; history. **No payment code touched; production payments stay disabled** |
| Payment_Terminals | /tenant/devices/payment-terminals | — | Verified already compliant (Nov 4 guide); unchanged |
| Devices_Integrations, AI_Communication | /tenant/devices/overview | AI cards showed one badge mixing subscription with connection; a trialing row whose trial had ENDED still said "Trial"; "Booking Sync: Connected" was hard-coded; "Connected Devices" counted registered rows | **Three separate axes per assistant** — Subscription (AI access gate), Provider (salon's own Twilio account readiness), Readiness (voice-capable number / outbound SMS). A connected provider never makes a cancelled package operable. 4 metrics, Refresh, Check AI Communication (existing health check). "Registered devices" KPI; Booking Sync = "Built in". Fleet registry + filters + history embedded below the panels |
| Account_Claude_Guide | /tenant/account/overview | **Placeholders**: AI & Storage "42% · 4.2 GB / 10 GB", Notification Health "Healthy / All systems good", Login Alerts always "Enabled", Trusted Devices = session count, four sample brand swatches, Plan/Billing from the settings *template* ("Premium / Gold / active" for every salon) | 8 KPIs in 4 × 2, each opens its owner page. Storage from `tenant_storage_usage` + the enforced quota; Notification Health from messaging readiness (Verified / Degraded / Blocked / —); Login Alerts from `user_login_alert_prefs`; Trusted Devices "No trusted-device registry"; brand colours "Not configured"; plan + status from `tenant_subscriptions` |
| Notification_Preferences | (Account) | 5 of 8 switches were drawn **On** with no data behind them; the save path swallowed DB errors and reported success | The 8 switches read/write `user_notification_prefs` (existing `pos/me/notification-prefs`); a switch moves only after the server confirms; save failures now return 503 `NOTIFICATION_PREFS_SAVE_FAILED`. Manage All = 4 × 2 workspace with effective state (e.g. "On — SMS cannot send yet") |
| Request_Access | (Account) | Same role could be requested again while one was open; **no self-approval guard** in the approval repository | Server refuses a duplicate open request (`ACCESS_REQUEST_DUPLICATE`) and refuses any decision by the requester (`self_decision`). Panel: policy line "a request is not a grant", submitted / decided / expiry times, reviewer note, honest load error |
| Recent_Account_Activity | (Account) | Preview only | "View all" dialog over the canonical audit: search, From–To, numbered pages (10/25/50/100), newest first, read-only event detail |
| Auto_Logout | /settings | Card said "Click Edit to load"; edit form pre-filled invented 5 / 0 minutes | Card shows the SAVED policy (status, grace, after-close, warnings, exempt roles, zone) or "Unable to verify"; no invented defaults; empty fields are refused |
| Salon_Locations | /tenant/management/locations | Name-sorted, no search / filters / dates / pages; Unpublish error was unhandled | Server query (search name/phone/address/code, status, map pin, booking, Date added/Last updated with inclusive salon-local From–To, 5 sorts, 10/25/50 pages, newest first). KPIs stay over every branch and filter when tapped. Errors shown |
| Features | /tenant/management/features | Empty list with no reason (pilot plan "Standard" isn't linked to a catalogue plan) | Real diagnostic, Needs-attention KPI, search + status filter, details overlay, Subscription / Usage links. Read-only |

## Verification (all ran in this session)

| Check | Result |
|---|---|
| Screen harness, batch 8 (1920×945 / 952 / 1032, EN + VI) | 90/90 |
| Screen harness, all modules | 804/804 (primary 268/268) |
| POS vitest | 2159 + the 3 i18n tests re-run after adding the new error texts (24/24) — 2162 total |
| API tests | all suites passed |
| Module tests | all suites passed (tenants 184, super-admin 2061, …) |
| Gates | all 57 gates + 25 audits passed |
| Lint / typecheck | 0 errors 0 warnings / clean |
| Security audit --full | 32 passed · 0 failed · 4 not verified |
| Live pilot on a fresh DB (pilot8c) | 242/242 |

Note: two earlier pilot / security / API runs failed only while five heavy suites shared the machine (browser crash,
timeouts, killed run); each passed when re-run on its own and the numbers above are those solo runs.

## Decisions for Kevin

1. **Kiosks** are created by Super Admin only — tenants can view, search and check them but not add one. Keep?
2. **Printers**: there is no printer registry or bridge; Receipt Devices honestly says NOT CONFIGURED and shows the real digital-receipt history. Build a printer registry, or stay digital-first?
3. **Pilot plan "Standard"** is not linked to a feature-catalogue plan, so Features lists nothing (now explained on screen). Link it in Super Admin → Plans.
4. **Trusted devices**: there is no trusted-device registry; the Account panel says so instead of counting sessions. Build one?
5. **Brand colours**: no setting exists; the row shows "Not configured". Add a brand-colour setting?
6. **Requestable roles** are still a fixed list on the server (OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN); the guide asks for policy-driven roles. Move to policy?
7. **Notification delivery history** (per-message status for the 8 preferences) has no source; the workspace shows preferences + effective state only.
8. The settings `subscriptionPlan` template (Premium / Gold / active) still exists for other readers; Account no longer reads it. Remove the template defaults?
