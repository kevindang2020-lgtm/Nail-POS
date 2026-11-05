# RESUME — Constitution 7 (Super Admin & Control Plane)

Paused Sep 29 2026 at commit `35626d4` for the developer-tree merge. **Merge now COMPLETE** (see `MERGE_REPORT_2026-09.md`);
master tip = the commit that updated this file (on top of `5ccddc2`), working tree clean. Constitution 7 itself is unchanged since the pause: nothing half-done.

**Hashes:** commits before the merge (`35626d4`, `790b1c4`, `38eeb9b` …) are unchanged. Commits from the merge onward were
rewritten on Sep 30 to scrub the malware from history — the old -> new table is in `MERGE_REPORT_2026-09.md` §10.

**Re-check after the merge (first, ~1 turn):** the merge brought in the developer's Authentication work. Re-run the DoD
(`node apps/api/scripts/control-plane-dod-check.mjs`, measured 69/4/0 on the merged tip Sep 30) and see whether the
"Platform token audience": the merged code did not provide it (checked Sep 30 2026); built afterwards the same day — DONE, see below.

## Where it stands
- Definition of Done (§303), measured: `node apps/api/scripts/control-plane-dod-check.mjs` → **71 DONE · 2 PARTIAL · 0 NOT DONE of 73**
  (Sep 30 2026: the lock-removal mutation was run on real Postgres — see below — and "Load tests pass" is DONE).
- Final report (§304, all 53 parts): `CONTROL_PLANE_FINAL_REPORT.md`. Audit + decisions D1–D7: `CONTROL_PLANE_AUDIT.md`.
- Last full battery (merged tip, Sep 30): 6 API shards 1,587 pass; all 7 apps and every module suite pass; 25 gates + 3 audits;
  security lane 22/0; 481 migrations fresh on real PG16. Before the merge (at `38eeb9b`): 6 API shards 1,578 passed (+8 live, +6 load skipped), admin-web 855, 25 gates,
  CI security lane 22/0, architecture clean. `35626d4` adds one opt-in test file only.

## Done Sep 30 2026 — lock-removal mutation on real Postgres
Fresh 484-migration PG16; `control-plane.postgres-race.vitest.spec.ts` 2/2. With `for update` removed from changeRole's
first lock query (super-admin rebuilt), the 50-round demotion race left **zero** Super Admins in round 1 — 3 runs out of
3. Lock restored (file identical to HEAD), race green again. DoD row updated with this evidence.

## Platform token audience — DONE (Sep 30 2026)
Every session token carries `aud` ('platform' | 'tenant' | 'customer'), stamped by `signSession` from the SIGNED role
(no caller can choose it); `verifySession` rejects a token whose audience does not match its role (`bad_audience`).
No forced sign-out at deploy: a token with no `aud` is accepted only if issued before `AUDIENCE_REQUIRED_FROM_EPOCH`
(2026-10-02), so pre-change tokens age out within one session lifetime; an `aud`-less token minted after that can only
come from a signer that bypassed `signSession` and is rejected. The path realm (RealmGuard) is unchanged.
Tests in `auth-session-token.vitest.spec.ts`; four mutations each caught.

## The 2 PARTIAL items, and why
| Item | Status |
|---|---|
| `/platform` API | Decision D1: `/api/v1/platform/*` is an alias of `/super-admin/*` (1,006 routes not moved). |
| Frontend modularised | One admin-web app (148+ screens) with permission-aware nav; splitting into packages is a design choice, not a gap in behaviour. |

## Things you (Kevin) may want to decide later
- Turn on maker/checker for plan overrides once a second admin exists (Super Admin → Approvals → policy).
- MFA recovery links are handed over by the admin; add automatic email delivery if wanted.
- When you first give someone a narrower platform role (Support, Finance…), check their screens: sensitive fields show
  "••• hidden (needs permission)".

## How to verify everything (commands)
- Gates: `node tooling/ci/run-gates.mjs` · Architecture: `node tooling/architecture-tests/run.mjs`
- API shards: `cd apps/api && npx vitest run --shard=N/6` (N = 1..6) · Security lane: `node scripts/security-audit.mjs --fast`
- Load test: `cd apps/api && npm run test:load:control-plane` · Real-Postgres races: `PG_RACE_URL=… npx vitest run src/load/control-plane.postgres-race.vitest.spec.ts`
- Secrets gate: `npm run check:secrets` · Lint gate: `npm run check:lint` · DoD: `node scripts/control-plane-dod-check.mjs`
