# Check-In Display — Distribution Recommendation

**Question:** should the in-salon Check-In Display / iPad kiosk be a public App Store app, an Apple Business Manager
(ABM) Custom App, or private/enterprise distribution?

**Recommendation: Apple Business Manager *Custom App* (managed distribution), not a public App Store listing.**

Why:
- A kiosk bound to a specific salon's tenant/branch has **no value to the general public** and tends to fail public
  App Store review (Guideline 4.2 "minimum functionality" / not useful to general users).
- ABM Custom Apps let you distribute privately to specific organizations (the salons), are still reviewed by Apple but
  not publicly listed, and pair well with **Managed Devices + Guided Access / Single App Mode** for true kiosk lockdown.
- Alternative for a single operator: an **unlisted** App Store distribution or Ad Hoc/enterprise for internal fleets.

Kiosk hardening regardless of channel: bind the device to tenant/branch via the existing **server-side device
pairing/token** (never trust a tenantId from the front end), gate Settings behind a staff PIN, keep Privacy/Terms
reachable from an Admin/Info screen, and use Guided Access to prevent customers leaving the app.

**Do NOT** publish the kiosk as a normal consumer app on the public store.
