# App Store Metadata Drafts

Draft copy for App Store Connect. Describes only features that actually work today — no misleading claims, nothing about
unfinished capabilities (e.g. push notifications are not advertised until wired). Replace URLs/emails with real ones.

## AIPowerSalon (Customer) — bundle `com.aipowersalon.customer`
- **Name:** AIPowerSalon
- **Subtitle:** Book nail salons & skip the line
- **Promotional text:** Find nail salons near you, book in seconds, check in, track your service, pay, and earn rewards.
- **Description:** AIPowerSalon helps you discover nearby nail salons, book appointments, check in when you arrive, watch
  your service progress, pay quickly with Skip-the-Line, and collect loyalty rewards — all in one place. Search by
  location or by city/ZIP. View receipts, manage your wallet and gift cards, and keep your favorite salons handy.
- **Keywords:** nail salon,manicure,pedicure,booking,appointment,check-in,loyalty,rewards,salon,beauty
- **Primary category:** Lifestyle (secondary: Health & Fitness)
- **Support URL:** https://aipowersalon.com/support · **Marketing URL:** https://aipowersalon.com ·
  **Privacy Policy URL:** https://aipowersalon.com/privacy
- **Age rating:** 4+ (no objectionable content)
- **Reviewer notes:** Email/phone/password login (no social login → Sign in with Apple not required). Payments are for
  in-person salon services via the salon's payment provider (not Apple IAP). Location is optional; "Search by City or ZIP"
  works without it. Demo account below.

## AIPowerSalon Owner — bundle `com.aipowersalon.owner`
- **Name:** AIPowerSalon Owner
- **Subtitle:** Run your salon from anywhere
- **Description:** Owners get a live dashboard, branch performance, booking overview, staff performance, finance reports,
  and business alerts for their salon — on iPhone and iPad.
- **Keywords:** salon owner,business,dashboard,reports,staff,bookings,analytics,nail salon
- **Primary category:** Business
- **Age rating:** 4+ · **Reviewer notes:** Owner login only; shows only the signed-in owner's business (no other
  tenants, no super-admin features, no payment-gateway secrets). Demo account below.

## AIPowerSalon Tech — bundle `com.aipowersalon.technician`
- **Name:** AIPowerSalon Tech
- **Subtitle:** Your schedule, tickets & earnings
- **Description:** Technicians see today's schedule, accept and run tickets, edit live tickets, confirm cash payments,
  and track earnings — scoped to their assigned salon.
- **Keywords:** technician,nail tech,schedule,tickets,earnings,salon,checkout
- **Primary category:** Business · **Age rating:** 4+
- **Reviewer notes:** Technician login only; sees only assigned salon/branch data; cannot edit paid/closed tickets.
  Demo account below.

## AIPowerSalon Check-In — bundle `com.aipowersalon.checkin`
- **Distribution:** Apple Business Manager **Custom App** (managed), not public listing — see
  CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION.md. Metadata applies to the Custom App listing.
- **Description:** In-salon check-in display: welcome, phone lookup, appointment found, walk-in check-in, and success —
  bound to a specific salon/branch via secure device pairing.
- **Reviewer notes:** Kiosk app for in-salon iPads; Guided Access recommended; Privacy/Terms reachable from the
  Admin/Info screen; settings behind a staff PIN.
