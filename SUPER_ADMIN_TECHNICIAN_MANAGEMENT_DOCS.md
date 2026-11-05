# Super Admin Technician Account Management — System Documentation

Platform-level control over a technician's **global account** — search, view, pause, suspend, transfer, merge, delete,
and support — every sensitive action permission-checked, reason-required, audited, and reversible where the law allows.
This consolidates the whole build (audit + Phases 1–9) and records the final verification.

---

## 1. The governing principle

A technician's global account belongs to the technician, not to any salon. A salon manager can never delete or take
down that account; only a Super Admin can, and only through a controlled workflow. Global-account status is kept
strictly separate from salon-membership status — pausing one salon relationship never touches the account or the others.

## 2. What already existed (the audit)

Roughly three-quarters of this system was already present under `super-admin-staff`, and the first rule was *don't
duplicate it*. The existing `GlobalTechAdminService` (`/super-admin/technicians`, Super-Admin-guarded) already did
search, full detail (current + former salon memberships), work history, duplicate detection and **merge**, **suspend /
restore**, and the **delete-request → decision → anonymize** workflow — all writing to an append-only `audit_logs`
trail. A cross-tenant transfer executor already honored technician consent. Controlled support-mode sessions, the
support-ticket system, the security layer, and the device/session tables all already existed. The frontend screen
existed too. The work was to fill the real gaps, not rebuild.

## 3. What the nine phases added

**Phase 1 — pause vs suspend.** A pause (temporary, reversible, technician-friendly) is now a distinct status from a
suspension (a security action), with its own fields, and every status change is written to a new append-only
`tech_account_status_events` history.

**Phase 2 — membership-level pause.** One salon membership can be paused while the global account and every other
membership stay active — the concrete expression of separate global vs membership status.

**Phase 3 — scoped pauses.** The public profile, messaging, and deals can each be suppressed independently, as Super
Admin overrides that sit on top of the technician's own settings rather than overwriting them. Profile and messaging
suppression is enforced on the real customer paths.

**Phase 4 — suspend cascade + notifications.** A suspension now hides the profile, blocks messaging, freezes deals,
revokes every live session, and notifies the technician; a restore lifts it all. The deals freeze also blocks new
technician deal creation.

**Phase 5 — transfer validation.** On top of the existing consent, duplicate, and salon-active checks, a transfer is
now blocked if the technician is mid-service or has an unreconciled cash handoff at the source salon.

**Phase 6 — support panel.** A per-technician support summary (live sessions, open tickets, security posture) plus a
revoke-sessions action, reusing the existing support/session infrastructure.

**Phase 7 — granular permissions.** Fifteen `super_admin.technicians.*` permission keys, one per sensitive action, so a
Super-Admin session can be minted with routine oversight but without the dangerous powers. Every route is individually
gated.

**Phase 8 — frontend.** The Technician Account Management screen surfaces all of the above: pause/reactivate, membership
pause, scoped toggles, the support panel, and status history, under the existing Workforce Oversight nav.

## 4. Data model (migrations 395–397, all additive)

- **395** — `global_tech_profiles.status` gains `paused` and `locked`; pause fields (`paused_at`, `pause_reason`,
  `pause_expires_at`); new `tech_account_status_events` history table.
- **396** — `tech_salon_memberships.status` gains `paused` (+ pause fields); the history table gains a `target_id` /
  `target_kind` so an event can name the membership it acted on.
- **397** — `admin_profile_hidden`, `admin_messaging_paused`, `admin_deals_frozen` on `global_tech_profiles` (the Super
  Admin scoped-suppression overrides).

## 5. Safety model

Every mutating action requires a reason, writes an append-only audit entry, and — for the dangerous ones — its own
permission. Suspend and the scoped pauses are reversible; anonymize is not, retires the technician ID forever, and
preserves every salon's tickets, payroll, and audit history (those key on the salon's own employment record, never on
the global account). No secrets — password hashes, Face ID, merchant credentials — appear in any response or audit
payload. Tenant isolation holds throughout: a salon can reach none of this.

## 6. Completion report (spec §22)

Existing code reused: `GlobalTechAdminService` + controller, the cross-tenant transfer executor, the `workforce-*` core
library, `super-admin-support` / `-security` / `-device-management` / `-platform` (support-mode), the `audit_logs`
trail, `technician_notifications`, the RBAC permission machinery, and the existing admin-web screen. Built new: the
pause/membership-pause/scoped-pause controls, the status-history table, the suspend cascade, transfer operational
blocks, the support summary + revoke-sessions, fifteen permission keys, and the frontend for all of it. Migrations:
395–397. Verification below.

## 7. Verification (this pass)

Integrity gates (api): typecheck, di, cross-wiring, permissions, unguarded-routes, SQL, nav, dead-client — **all pass**.
Tests: super-admin-staff + deals **182**; tech-profile **79**; admin-web typecheck + build + shell/nav **19**; the
granular-permission suite and RBAC reachability green. Migrations 395–397 load cleanly. (The whole-monorepo suite is too
large to run in one pass here; the areas this work touched were run in full. This is a sandbox verification at head, not
the live repository.)

## 8. Honestly deferred (documented, not built)

- **Destination-salon approval** — technician consent is enforced; a receiving-owner approval step is not wired (the
  membership model has a `pending_salon_approval` state ready for it).
- **Elevated approval second factor** — the granular keys are the real access control; gating each dangerous op on an
  active time-boxed security grant is available to layer on but not wired.
- **Reset-lock action** — the `locked` status exists; the explicit lock/unlock action isn't wired, and phone/email
  re-verification rides existing auth flows.
- **Frozen-deal redemption** — a freeze blocks new deals and hides the profile; gating checkout redemption of a
  suspended technician's pre-existing active deals is a small follow-up.
