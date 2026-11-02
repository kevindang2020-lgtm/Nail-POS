# TestFlight Testing Plan

**Build version target:** 1.0.0 (build 1). **Feedback email:** testflight@aipowersalon.com (set a real inbox).

## Testers
- **Internal (App Store Connect users):** you + 1–2 teammates per app. Fast iteration, no Apple review for internal.
- **External (public link / email):** a small pilot group — a few salon owners, a few technicians, and a handful of
  customers. External builds require a one-time Apple Beta App Review.

## Per-app test scenarios
**Customer**
- Sign up / log in; log out clears session.
- Find Salons: grant location → results; deny → "Search by City or ZIP" works (ZIP + city).
- Book an appointment; see it in My Appointments; check in; watch Service Progress.
- Skip-the-Line checkout in sandbox: see totals (services, tax, tip, discount), success → receipt.
- Loyalty/Rewards and Wallet display; Favorites add/remove.
- Profile: open Privacy Policy, Terms; Settings: toggle service notifications and the separate Marketing opt-in;
  submit a Delete Account request → see the retain/remove explanation.

**Owner**
- Log in; Dashboard, Branch Performance, Booking Overview, Staff Performance, Finance Reports, Alerts all load and read
  well on iPhone and iPad (no broken charts).
- More: Privacy, Terms, Account Deactivation request.

**Technician**
- Log in; Today Home, Schedule, Tickets.
- Accept → Start → (edit/add service) → Service Done → Cash Confirmation; Earnings updates.
- Confirm you only see assigned salon/branch data; cannot edit a paid/closed ticket.
- More: Privacy, Terms, Account Deactivation.

**Check-In (ABM Custom App / managed device)**
- Pair device to test tenant/branch; Welcome → Phone Lookup → Appointment Found / Walk-In → Success.
- Privacy/Terms reachable from Admin/Info; settings behind staff PIN; friendly offline/error state.

## Known limitations to tell testers (honest)
- Push notifications are not enabled yet (APNs/FCM pending) — reminders/updates currently go by SMS/email.
- Payments run in **sandbox** during beta (no live charges).
- Cookie-session persistence inside the native WebView is being validated; report any unexpected logouts.
- Check-In display is distributed via Apple Business Manager, not the public App Store.

## Build/version
- Set CFBundleShortVersionString = 1.0.0 and CFBundleVersion = 1 (increment build each upload). See
  IOS_BUILD_CONFIGURATION_REPORT.md.
