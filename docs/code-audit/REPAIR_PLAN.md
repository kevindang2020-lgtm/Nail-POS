# REPAIR_PLAN

## Honest finding from Phase 0
The recovery prompt is written for a **cold transfer of an unknown, possibly-broken codebase with duplicate prototypes and mock data**. That is **not** the state of this repository. `/home/claude/merged` is a mature, single, connected monorepo:
- api typecheck clean, 661 tests green (re-verified now); frontend suites green this session.
- 0 prototype/backup/duplicate-version files; no duplicate migrations; one API client per frontend; one realtime bus; one tenant-context middleware.
- Tenant isolation (248 `scoped()` sites + middleware + negative tests), RBAC, audit logging, and money-path concurrency safety all present and tested.
- ~213 prior audit/build/test reports already document the deep-audit, dedup, and module work the prompt describes.

So the prompt's 12-phase **recover → dedup → repair → connect** programme is, for the most part, **already complete and documented**. Re-running it from scratch — or creating a second set of audit docs and parallel implementations — would *violate* the prompt's own rules ("do not rebuild from scratch", "do not create duplicate files", "do not create a second application").

## Template-vs-reality mismatches to respect
- **Stripe / Square**: the prompt lists them as integrations to support. The project rule is **Fiserv + Clover only**; Stripe/Square were deliberately removed. I will **not** add them. (The lone `stripe` strings are a webhook-signature *scheme name*, not a processor — they stay.)
- **"Mobile applications"**: the clients here are web apps (POS/admin/owner/tech/customer/display) + a Go check-in kiosk; there is no separate native mobile app to repair.
- **Hardcoded demo data**: production paths use real tenant data; demo seeds are dev-only (`db:seed:demo`) and already separated.

## Proposed plan (verification-first, not rebuild)
1. **Phase 1 — full baseline re-run**: root install, then typecheck + vite build + vitest for **every** workspace + core specs; record any non-green result. (api already re-verified; frontends pending a fresh run.)
2. **Phase 2 — confirm the documented "remaining" list**: reconcile root `UNFINISHED_FEATURES_REPORT.md`, `REMAINING_BLOCKERS.md`, `REMAINING_WORK_FOR_NEW_CHAT.md`, `COMPLETION_STATUS.md` against the live tree; surface anything genuinely open.
3. **Phase 3 — targeted fixes only** for whatever Phase 1/2 actually turns up (with gates + live-PG where money is involved), in the same disciplined manner used this session.
4. **Phase 4 — responsive/visual validation**: POS 1440×900 & 1920×1080, Super-Admin iPad portrait/landscape, against the reference images in uploads.
5. **Phase 5 — final package**: already produced continuously as `AIPowerSalon-Full-Package.zip` (excludes node_modules/secrets); refresh + ship with consolidated docs.

## Recommendation
Treat this as **audit-confirmed-healthy + targeted hardening**, not a from-scratch recovery. Phase 0 is complete; **awaiting your review before Phase 1** (the prompt asks me to pause here). Tell me if you want the full multi-workspace baseline re-run next, or to point at a specific module.
