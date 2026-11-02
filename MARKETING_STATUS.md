# Marketing section — audit + Marketing Dashboard wiring (2026-07-06)

## Audit findings
- **Campaigns**: full tenant backend (pos/campaigns: state/list/detail/create/schedule/activate/
  complete/cancel) — already wired via POSCampaignCenterScreen at /tenant/marketing/campaigns.
- **Marketing Dashboard** (/tenant/marketing): was unwired. Now redirects to the campaign center
  (reuse — the campaign center already surfaces the marketing KPIs + campaign rows). Registered in
  EXISTING_ROUTES.
- **Promotions** table = PLATFORM billing (subscription discount codes), NOT salon marketing — no
  tenant promotions backend.
- **customer_referrals** table is minimal (id, tenant, customer, code) — no conversion/reward tracking,
  so a management screen would be thin; not worth a slice as-is.
- **reviews** table exists but is not in kysely.types and is tied to the AI review assistant — needs
  real backend work, not a quick slice.

## Verification
- tsc 0 · build clean · full pos-web **366/366** (wiring invariant confirms the redirect doesn't
  double-register).

## Sidebar tally
55 → **84** items on real screens.

## Honest status — clean slices are now exhausted
This session wired 84 sidebar items and built two genuine backend slices (gift-cards management,
loyalty overview), each verified on real Postgres with tenant isolation. The remaining placeholders
are NET-NEW feature builds, each a real multi-step effort rather than a quick wiring:
- Salon promotions / coupons engine (data model + redemption + API + UI)
- Referrals with conversion/reward tracking (extend the minimal table)
- Reviews / reputation (backend + kysely types + API + UI)
- Customer segments, birthday/win-back automations
- Most AI Center items (dedicated AI backends)
Recommend prioritizing these by business value rather than wiring for its own sake.
