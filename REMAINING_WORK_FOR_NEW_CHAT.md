# AIPowerSalon — Remaining Work (for the new chat)

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> The counts here are Jun-16-era (451 API tests; today: **6,046 + 4 skipped, 0 failed** — see `TEST_REPORT.md`). The P0/P1 table below is the early form of today's owner-side keys list (creds/hosting/devices) — it was never a code-gap list, and remains owner-side.


Date: 2026-06-16. The **code is complete and verified** (builds clean, 0 lint errors, 451 API + 234 core + 267 frontend
tests, local stack boots + seeds). Everything below is operational/credential or a product decision — **not** a code bug.

| Priority | Feature / module | What is missing | Files involved | Recommended next Claude task | Blocker |
|---|---|---|---|---|---|
| **P0** | Production deploy (backend) | Not deployed yet | `apps/api`, `Dockerfile`, `docker-compose.yml` | Write exact AWS steps + a deploy script: EC2/ECS + **Elastic IP**, RDS Postgres 16, run migrations, HTTPS (ACM/ALB or nginx), Secrets Manager | AWS account + the dedicated/Elastic IP |
| **P0** | API origin + CORS wiring | Build-time origin + CORS allowlist not set for prod | each app's `VITE_API_BASE` (kiosk `window.APS_API_BASE`); API `WEB_CORS_ORIGINS` | Set `VITE_API_BASE=https://api.aipowersalon.com` per build; set `WEB_CORS_ORIGINS` to `pos.`/`admin.`/`aipowersalon.com` | DNS / chosen subdomains |
| **P0** | Live card/wallet payments | Sandbox only today | `apps/api/src/payments/*`, checkout services | Swap in the live Fiserv/CardPointe gateway; smoke-test a real auth | **Live CardPointe MID + residual URL** (and the static IP for allowlisting) |
| **P1** | SMS / email / push | Mock fallbacks active until keys set (re-checked Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep): still true for SMS and email — a `MockSmsSender` / `MockEmailSender` records the send and the result is flagged `simulated`; PUSH no longer — production with no FCM/APNs keys selects `NotConfiguredPushProvider`, every send logs failed `push_not_configured`, `modules/communications/src/push/push-providers.ts`; the senders now live in `packages/notifications` and `modules/*`) | `auth/sms.service.ts`, `auth/email.service.ts`, `push/push-providers.ts` | Configure Twilio + SendGrid + FCM env; verify a real send | Twilio **A2P 10DLC**, SendGrid, FCM credentials |
| **P1** | Native app store builds | Apps converted but not signed/submitted | `apps/{customer,owner,tech,customer-display,go-check-in-kiosk}/ios` + `/android` | Build/sign + submit per the runbooks; on-device VoiceOver/Dynamic Type pass | **Apple Developer** + **Google Play** enrollment, Mac+Xcode / Android SDK |
| **P1** | Static hosting (web apps) | pos-web/admin-web not hosted | `apps/pos-web`, `apps/admin-web` builds | Host `dist/` on S3+CloudFront (or nginx) on `pos.`/`admin.` subdomains | Hosting + DNS |
| ~~P2~~ **DONE** | Split-payment surcharge | ✅ Implemented ("Option A": card portion of a split carries the surcharge, disclosed pre-payment) | `checkout.service.ts`, `checkout-display.dto.ts` | — | resolved |
| ~~P2~~ **DONE** | Billing "recalculate-month" semantics | ✅ Decided: paid month immutable (same-volume idempotent, different-volume rejected); unpaid/failed reverse-and-recompute. Built + tested | `apps/api/src/hardware-payment/hardware-payment.service.ts` | — see BILLING_AND_SETTINGS_DECISIONS_REPORT.md | resolved |
| ~~P2~~ **DONE** | Tax/surcharge configurability + settings schema | ✅ Tightened: surcharge ≤ 4%, tax ≤ 15%, finite/enum/whole-number write-validation. Built + tested | `apps/api/src/settings/settings.service.ts` | — see BILLING_AND_SETTINGS_DECISIONS_REPORT.md | resolved |
| **P3** | Customer-profile "coming soon" sections | A few optional profile sections have no backend | `apps/customer-web/src/screens/ProfileScreen.tsx` | Build the backend + wire, or remove the placeholders | none (low value) |

## Suggested order for the new chat
1. **Deploy the backend to AWS** (P0) — get `api.aipowersalon.com` live on the Elastic IP with RDS + HTTPS.
2. **Wire origins + CORS** and **host pos-web/admin-web** (P0/P1).
3. **Go live on payments** with the real CardPointe MID (P0), then **Twilio/SendGrid/FCM** (P1).
4. **Build/sign + submit the 5 native apps** (P1).
5. ~~Resolve the 3 product decisions (P2)~~ — **all 3 resolved 2026-06-17** (BILLING_AND_SETTINGS_DECISIONS_REPORT.md).

Nothing here requires re-auditing or re-fixing the codebase — it's done. Hand the next Claude one of the rows above
and it can do the real work.
