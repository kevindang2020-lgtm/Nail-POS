# Technician transfer between salons (Technician Profile mandate §58–§64, §99, §170)

**Principle.** A transfer never edits `tenant_id` on a technician row. The person (global_tech_profiles: profile, portfolio,
reviews, platform account) stays; the OLD salon's employment row, commission, payroll, notes, customers and metrics stay with
the old salon; the NEW salon gets a NEW employment row (technicians + users + membership + branch grant).

**Two ways in, one executor.**
1. *Technician requests* (Tech app → Profile → Connect to New Salon, tick "I am leaving my current salon") →
   `POST /tech/profile/membership-request { salonCode, transfer: true }` → a `pending_salon_approval` membership at the new
   salon with `transfer_from_tenant_id` = the SESSION's salon (never client-supplied). The new salon's manager sees a **Transfer**
   badge (never which salon she is leaving — §61) and approves: in ONE transaction `transitionStatus(active)` →
   `materializeMembership` (new roster row / login / branch grant / `hired` or `rehired` history at B) → `endEmployment(A, 'transferred')`
   (A's roster row inactive + ended_reason, membership former, A's login not active, `transferred` history at A) → then the
   post-commit revoke chain (`afterDeparture`: sessions, refresh tokens, Clock PIN, audit, realtime). Her consent is the request
   itself (`requested_by_user_id` is her own login at A — verified before the departure is run).
2. *Super Admin / salon-initiated* (`super-admin-staff cross-tenant-transfer.executor.ts`, worker transfer tables 252–254) —
   the same `materializeMembership` + `endEmployment` pair; consent collected through the transfer request record.

**Blocks (§60/§107).** `GlobalTechIdentityService.departureBlocker` — ONE implementation for both paths — refuses a departure
while she is serving a guest at the old salon (`open_service`) or has an unreconciled cash handoff (`cash_handoff_pending`):
HTTP 409 `TRANSFER_NOT_ALLOWED` with the reason sentence; nothing changes at either salon.

**What crosses / what does not** (asserted by `profile-policy-transfer.pgtest`): the global profile id, public slug, portfolio,
reviews, rating — yes. Commission split (B gets ITS tenant default, never A's), notes, payroll, time clock, customers — no.
Career history on the public page lists salon names + years ONLY when she turned `careerHistoryPublic` on (§62).

**Rehire (§64).** Returning to a salon reactivates/creates employment and writes a `rehired` history row; the earlier
`hired … transferred` rows are never deleted.

**Termination (§63).** `employment → inactive/archived` runs `revokeTechnicianAccess`: users.status, membership former, every
session + refresh token, Clock PIN, audit, realtime nudge. The professional identity stays active on the platform.
