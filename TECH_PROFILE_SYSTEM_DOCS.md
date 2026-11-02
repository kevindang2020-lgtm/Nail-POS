# Technician Social Profile — System Documentation

A single, permanent, technician-owned global profile that carries a nail technician's identity, portfolio, reputation,
audience, and bookability across every salon they work at. This document consolidates the whole feature (Phases 1–8)
and records the Phase 9 verification pass.

---

## 1. What it is, in one paragraph

Every technician has one global profile, identified by a permanent public slug, that they own — not the salon. It holds
their cover and avatar, bio, specialties, certifications, style tags, portfolio, before/afters, reviews (with their own
public responses), social links, showcase posts, followers, ratings, verification badge, and a direct-message channel
with customers. Salon-specific data (commissions, schedule, internal notes) stays tenant-owned and isolated; the global
profile follows the technician when they change salons. A salon can never delete a global profile — only a Super Admin
can, and only at the technician's request.

## 2. Global vs salon boundary (the core invariant)

- **Global, technician-owned:** profile fields, portfolio, before/afters, reviews + technician responses, social links,
  showcase-post attribution, followers, ratings, verification status, DM threads, analytics.
- **Salon, tenant-owned, isolated:** commissions, payroll, schedule, branch assignment, internal notes.
- **Invariant, enforced throughout:** there is no tenant-scoped code path that deletes or takes down a global profile.
  Managers can hide an abusive review on their own tenant and can moderate their own salon's showcase content; they
  cannot touch the global identity.

## 3. Data model (migrations 066 baseline → 390–394 this build)

Pre-existing (audit found ~70% already built): `global_tech_profiles` (slug, display fields, specialties/languages,
`profile_links` JSONB + visibility, discovery flags, rating denorm, portfolio count), `tech_portfolio_photos`,
`before_after_sets`, `nail_photo_consent`, `tech_salon_memberships`, `reviews` (+ later `technician_id`,
`global_tech_profile_id`, `review_tags`, `is_public`, `is_hidden_by_manager`).

Added this build:
- **390** — `global_tech_profiles`: `cover_url`, `certifications`, `style_tags`, `verification_status`
  (`unverified|pending|verified`).
- **391** — `reviews`: `technician_response`, `technician_response_at`.
- **392** — `accepts_messages` on the profile; `tech_dm_threads`, `tech_dm_messages`, `tech_dm_reports`.
- **393** — `tech_profile_events` (real analytics capture).
- **394** — `tech_dm_reports` moderation lifecycle (`status`, `resolution`, `resolved_at`, `resolved_by_user_id`).

## 4. Surfaces & endpoints

**Technician app** (`/tech/profile/*`): get/update profile, avatar + cover upload, portfolio CRUD + reorder, consent,
before/afters, membership requests, ratings + **respond to a review**, public preview, **analytics**, **messages**
(threads / thread / send / block / report), **request verification**.

**Customer app** (`/customer/*`): nearby discovery (style-tag aware), public profile by slug (records a real view),
service-qualified techs, favorites (follow), ticket-verified ratings, **open/send/list DM** (booked-only), **event
capture** (whitelisted link/post taps).

**Manager** (POS): rating list + hide/unhide, tech-profile membership management.

**Super Admin** (`/super-admin/tech-profiles/*`, SuperAdminGuard): verification queue (grant/clear — the only path that
can set `verified`), DM report queue (dismiss / block conversation).

## 5. Safety & integrity model

- **Messaging is booked-only.** A customer can open a DM thread only if they have booked with that technician (reusing
  the same check that gates booked-only profile links). A technician can switch messages off entirely. Either party can
  block or report; a Super Admin works the report queue.
- **Analytics are real and unspoofable.** Profile views and message-opens are written server-side; the only events a
  client may report are link and post taps, through a whitelist. Nothing is estimated.
- **Verification is single-authority.** Techs request; only a Super Admin grants the badge.
- **Link labels can't lie.** A link tagged as a platform (Instagram, TikTok, Facebook, YouTube, Pinterest) must resolve
  to that platform's real domain; lookalikes are rejected. Aggregators/personal sites accept any https host.
- **Reviews.** A technician can post one public response per review and can never edit the customer's rating or comment.
- **Reuse over rebuild.** Showcase posts, likes, and comments reuse the existing NailShowcase system; discovery reuses
  the existing ranking. Only genuinely new needs (DMs, analytics events, verification lifecycle) added tables.

## 6. Discovery & matching

Cross-salon nearby search over public/marketplace profiles, filtered by distance and minimum rating, ranked by a
transparent score: rating damped by review-count confidence, review volume, verified completed services, availability,
portfolio depth, and distance. "AI Match Me" re-ranks by keyword overlap against real profile data — now including the
style-tag taxonomy — and shows which style tags matched. No fabricated scores.

## 7. Phase-by-phase summary

1. Profile core gaps — cover, certifications, style tags, verification status.
2. Social links — 8 platforms, per-link visibility, anti-mislabeling domain policy.
3. Reviews + technician responses (cross-salon ownership).
4. Posts/comments/engagement — surfaced via the existing NailShowcase system (no parallel tables).
5. Customer ↔ technician messaging — booked-only, blockable, reportable.
6. Profile analytics — real event capture, unspoofable authoritative events.
7. Discovery + matching + Book-This-Look — audited (mostly built + honest); made matching style-tag aware.
8. Verification + moderation + Super Admin — request/grant flow + DM report queue.

## 8. Phase 9 verification (this pass)

Integrity gates (api): typecheck, di, crosswire, perms, public-route, sql, nav, dead-client — **all pass** (two
genuinely-unused client methods removed as incidental cleanup surfaced by the dead-client gate).

Tests: tech-profile **78**; combined tech-profile + deals + checkout **269**; customer-booking + nail-showcase **242**;
customer-web **249**; tech-web **105**; admin-web tsc + build + shell/moderation screens green. Migrations 387–394 load
cleanly.

## 9. Honestly deferred (not built)

- Real-time push for DMs (currently light polling — fine for launch, a clean upgrade later).
- A customer-side message inbox (customers reach threads from a technician's profile; no aggregated inbox yet).
- Moderation of posts/comments beyond the existing NailShowcase report queue.
- Super-Admin profile takedown-on-request (the verification path exists; a full delete flow is not wired — and the
  salon-cannot-delete invariant remains intact regardless).

Separately, the Deals Marketplace has its own outstanding Phase 9 (a consolidated regression + docs) tracked apart from
this feature.
