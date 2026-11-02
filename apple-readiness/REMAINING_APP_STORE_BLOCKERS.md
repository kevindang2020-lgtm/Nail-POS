# Remaining App Store Blockers (honest)

## Code / build work still required
1. **Native shell for the check-in display** — customer, owner, and tech are now wrapped (Capacitor, verified). Only the
   check-in display remains (it is ABM-bound, not public-store — lower priority).
2. **App icons + launch screens** — placeholders only; add real assets (Mac asset-catalog step).
3. **Absolute API base + WebView cookie validation** — wire `VITE_API_BASE` and confirm session login inside the
   native WebView (see MOBILE_SECURITY_REPORT.md).
4. **Notification refinements** — marketing opt-in is now split from transactional in the customer app ✅; still: wire
   APNs/FCM when push is implemented, and add the split to owner/tech if they ever send marketing.
5. **Location** (customer) — pre-prompt explainer + manual city/ZIP fallback on denial are confirmed present ✅.
6. **Check-In kiosk** — Privacy/Terms on an Admin/Info screen, staff-PIN settings gate, review device pairing for kiosk.
7. **Reports still to produce once a binary exists** — App icon/launch report, iOS build-configuration report,
   screenshot plan, TestFlight test plan, metadata drafts, reviewer test accounts, accessibility review. (Several can be
   drafted now; the binary-dependent ones can't be honestly finalized until the shells are built on a Mac.)

## Infrastructure / accounts blocked on you (not code)
- **Apple Developer Program** enrollment + a **Mac with Xcode** (required for signing, archiving, upload).
- **APNs/FCM** for push notifications.
- **Twilio + A2P 10DLC** for SMS; **SendGrid** for email.
- **Real Fiserv/CardPointe MID** for live card payments (currently sandbox).
- **Production hosting + domain** and an **absolute HTTPS API base URL**.

## What is NOT a blocker (already handled)
- Privacy/Terms/Delete-Account in-app (customer, owner, tech) ✅
- Backend deletion/deactivation + privacy-export endpoints ✅
- No secrets in frontend, tenant isolation, no raw card storage ✅
- Sign in with Apple (not required) ✅
- Export compliance (standard TLS, flag set) ✅
