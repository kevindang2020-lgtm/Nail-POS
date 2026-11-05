# Technician Profile, Professional Identity & Workforce — developer handoff (Oct 13 2026, wave 3)

Companion docs: [skills.md](skills.md) · [transfers.md](transfers.md) · [commission.md](commission.md) · [time-clock.md](time-clock.md) ·
[TECHNICIAN_AUDIT.md](TECHNICIAN_AUDIT.md) (the inspect → map record). Ledger of every mandate section: `scratchpad/w3/ledger-TECH.md`.

## 1. Identity model (§3–§6)

```
global_tech_profiles            THE professional person (platform-wide). tech_code, phone_hash / email_normalized (the only
  │                             identity keys — never a name), display_name, title, bio, avatar/cover, specialties, languages,
  │                             years_experience, is_public, status (active|paused|locked|suspended|anonymized|merged),
  │                             career_history_public (646, §62), rating denorm, portfolio_photo_count.
  ├── tech_portfolio_photos     her portfolio (per-salon hides in tech_portfolio_photo_tenant_hides 574; consent 164)
  ├── reviews (global_tech_profile_id) her public reputation
  └── tech_salon_memberships    ONE row per (profile, salon): pending_invite | pending_tech_approval | pending_salon_approval |
        │                       active | paused | suspended | former | rejected | revoked | cancelled (TECH_SALON_MEMBERSHIP machine),
        │                       transfer_from_tenant_id (§60), role_label, start/end_date.
        └── technicians         the salon's EMPLOYMENT row (tenant_id, branch_id = primary, user_id = her login AT THIS SALON,
              │                 status active|inactive|suspended|archived, ended_reason, commission split, services, schedule…)
              │                 ONE live row per (tenant, profile) — uq_technicians_tenant_gtp_live (577).
              ├── users          one login per person per salon (538); user_branch_access = per-branch grants + role (578)
              ├── technician_workforce_state   the SIX operational statuses (579/585): employment · clock · shift · queue · service · presence
              ├── technician_employment_events (646, §128) append-only history: hired/rehired/role_changed/branch_added/
              │                 branch_removed/suspended/reactivated/terminated/transferred (leave = approved VACATION/SICK time off)
              └── tenant-private: technician_services (eligibility), schedules, time off, shifts/breaks, certifications,
                                  compensation rules + snapshots, payroll lines, notes, audit logs
```

One minter (`GlobalTechIdentityService`): a POS "Add Technician" or a Tech-App first login looks the person up by phone/email
hash; a match links (after HER consent — `pending_tech_approval`, consent-before-link.pgtest), no match mints exactly one profile.
Never by name (§113).

## 2. Public vs tenant-private (§7, §72, §134)

| Customer-visible (`buildPublicProfilePayload`, `/customer/techs/:slug`, `/customer/salons/:id/technicians`) | Tenant-private (POS/Owner only, `technicians.view_pay` for pay) |
|---|---|
| display name, title, photo, cover, bio, specialties, languages, years, self-declared certifications (marked unverified), approved+public+consented portfolio, before/after, showcase posts, rating + distribution, public reviews + responses, salons where active (with `public_listing`), next available, services + catalog prices, Book This Look, **career history only when `career_history_public`** | commission rules/rates/history, payroll summaries & lines, tips by ticket, manager notes, employment history, time clock & corrections, time off, certification documents (signed URLs), permissions/app access, audit, invitation links |

`publicProfileStatus` (§53): PUBLIC / PRIVATE (is_public off) / HIDDEN (platform paused or admin hide) / SUSPENDED (platform suspended or locked).

## 3. Employment lifecycle (§5, §63, §64, §128)

INVITE (user_invitations 270: hashed single-use token, expires, tenant-scoped) → IDENTITY (one minter) → EMPLOYMENT
(`materializeMembership`: membership active + roster row + login + branch grant in ONE transaction, history `hired` or `rehired`)
→ BRANCH (user_branch_access; `branch_added/removed` history from Team → Permissions) → ROLE (`role_changed` history from the role
service or the POS role label) → SKILLS → SCHEDULE → QUEUE → SERVICE → SERVICE DONE → CHECKOUT → EARNINGS.

Suspend / deactivate / archive / reactivate (POS lifecycle) go through `revokeTechnicianAccess` / `restoreTechnicianAccess` — the
ONE chain: users.status, membership, every session (status + revoked_at), refresh tokens, kiosk Clock PIN, audit, realtime nudge —
and write `suspended` / `terminated` / `reactivated` history. Rehire never deletes history.

## 4. Permissions (§69–§71)

Technician (tech realm, `tech.*`): own profile read/edit, own schedule, queue, tickets, earnings, tips, portfolio, skill requests.
Manager: `pos.technicians.view|edit|create|status_change|schedule.edit|skills.edit|permissions.edit|app_access.edit|import|export`,
`technicians.view_pay` (owners/managers only — never front desk), `pos.technicians.commission.edit` (+ admin code).
Owner: `owner.staff.*`. Super Admin: `super_admin.technicians.*` (support mode for private data, §68). Decision = identity + tenant
membership + branch grant + role + permission + scope (`@aipowersalon/permissions` decision.ts).

## 5. API routes (§74–§75) — added / changed this wave in **bold**

Tech app (`/tech/profile`): GET · PATCH (public fields may be HELD, §95; switches `isPublic`, `isBookable`, `acceptsMessages`,
`marketplaceDiscoveryEnabled`, **`careerHistoryPublic`** apply at once) · POST membership-request `{ salonCode, message, **transfer** }`
· POST membership-request/:id/cancel · **POST pending-changes/withdraw** · **POST / DELETE photos/:photoId/showcase** (§46) ·
photos, before-after, ratings, messages, analytics, public-preview, verification/request (unchanged).

POS: GET/POST `/pos/technicians` (+ state, kpis, search, qualified, lookup) · **POST /pos/technicians/import `{ csv, dryRun }`** (§112)
· GET **`/pos/technicians/:id/employment-history`** (§128) · `/pos/technicians/:id/profile|feature|portfolio-photos/:id/approve|hide|ratings|membership/deactivate`
· `/pos/technician-membership/requests` (+ `isTransfer`, approve returns `transferred`) · **GET/PATCH /pos/technician-profile-policy** ·
**GET /pos/technician-profile-changes, POST …/:id/approve|reject `{ version, note }`** (§95) · workforce-status, time-off, certifications, skills, services, commission (unchanged).

Customer: `/customer/techs/:slug` (+ **`careerHistory`**), salon technicians, favorites, ratings (unchanged shape otherwise).

## 6. Realtime (§76–§78)

`technician_status_updated`, `technician_clock_updated`, `technician_schedule_updated`, `technician_profile_updated` (now also
`{ held: true, requestId }` to every salon that must review a held edit), `tech_membership_requested/approved/rejected`,
`service_session.started/completed`. Projection consumer carries domain events (TECHNICIAN_STATUS_CHANGED, MEMBERSHIP_*); technician
rooms are authorized by stream ticket; presence is ephemeral and separate from clock/queue.

## 7. Mobile flows (§13–§19, §94, §95, §46)

Home → Queue → Accept/Decline → Start Service (server validates technician/branch/eligibility/visit/queue) → Service Done
(server-confirmed) → Earnings. Profile: edit public fields (held for approval when her salon requires it — notice + Withdraw),
portfolio (Share to Nail Showcase on approved public photos), Connect to New Salon (join) or **Transfer** (checkbox: leaving the
current salon). Offline: read-only cache, no authoritative actions.

## 8. Transfer behaviour (§58–§62) — see [transfers.md](transfers.md).

## 9. Screens

POS: Technicians roster (Import, Profile → page), **Technician Profile page** `/technicians/:id` (6 statuses, overview cards,
Employment + history, Branches, Schedule, Skills, Queue, Appointments, Performance, Commission·Tips·Earnings, Time clock·time
off·certs, Portfolio·Ratings (moderation drawer), Documents, Permissions, Audit), Technician join requests (Transfer badge),
**Public profile changes** (policy switch + queue), Live schedule, Skill requests, Time clock, Team tips/performance/payroll.
Owner: Live Operations → Team (clock/queue/current customer/sales/tips), Staff performance + technician detail, Alerts.
Customer: public profile (+ Worked at), Find techs, Book with technician, Nail Showcase (technician-authored looks → Book This Look).
Super Admin: Global technicians, Staff overview, profile moderation, transfers, support mode.

## 10. Database (this wave)

- **646** `technician_employment_events` (append-only trigger, tenant-consistency triggers, backfill `hired` + ended rows),
  `global_tech_profiles.career_history_public`, `technician_profile_tenant_policy`, `tech_profile_change_requests`
  (one pending per profile partial unique, version), `technician_import_runs`.
- **647** `nail_showcase_posts.post_type` + `'technician_portfolio'`, `portfolio_photo_id` + partial unique (one live post per photo).
- State machines: `TECH_PROFILE_CHANGE_REQUEST` (pending → approved | rejected | withdrawn).

## 11. Final report (§183) — A–U

**A. Discovered** — tables: global_tech_profiles, tech_salon_memberships, technicians, users, user_branch_access, user_invitations,
technician_workforce_state, technician_statuses (compat), technician_services, technician_skills, technician_skill_change_requests,
technician_certifications, technician_schedules, technician_time_off, technician_shifts, technician_breaks, technician_clock_pins,
tech_portfolio_photos (+tenant hides, consent), before_after_sets, reviews, nail_showcase_*, compensation_* / ticket_compensation_snapshots,
payroll_periods/lines, technician_audit_logs. Modules: workforce (technicians, tech-profile, eligibility, workforce-status,
time-clock, technician-clock-pin, time-off, nail-showcase, compensation, payroll, turn-queue, team-permissions), queue (tech,
tech-queue, serving, live-technician-schedule), super-admin (super-admin-staff: transfer executor, merge, oversight), identity
(invitations, sessions, biometric), analytics (owner staff/live ops). Screens: listed in §9. Mobile: tech-web (20 screens).
Events/workers: §6; cert-expiry scheduler, rating denorm, realtime projection.
**B. Problems found** — P0/P1 items of the Oct 9 audit were closed in the Oct 12 merge (TECHNICIAN_AUDIT.md table). This wave's
findings: P2 missing — POS profile PAGE (§8), employment history (§128), profile-change approval (§95), consented career history
(§62), technician-requested transfer (§60), import (§112), portfolio→showcase (§46), §155 registry gaps; P3 — `technician_profile_tenant_policy`
actor-stamp column; owner attendance tile still counts from the compat row (Live Operations Team uses the authoritative state).
**C. Identity model** — §1. **D. Public/private** — §2. **E. Skills** — skills.md. **F. Scheduling** — time-clock.md + BK docs.
**G. Queue/serving** — docs/queue/*. **H. Commission/tips/earnings** — commission.md. **I. Portfolio/ratings/showcase** — §2, §46.
**J. Tech app** — §7. **K. POS** — §9. **L. Owner** — §9. **M. Super Admin** — §9. **N. Transfer** — transfers.md.
**O. Security** — tenant isolation (profile-policy-transfer, pos-profile-no-other-salons), branch isolation (user_branch_access,
owner bScope), field-level (pay projection, public payload), payroll protection (view_pay). **P. Realtime** — §6. **Q. Database** — §10.
**R. APIs** — §5 (bold). **S. Files** — in the wave report. **T/U. Tests & builds** — in the wave report.
