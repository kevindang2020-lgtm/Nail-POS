# AIPowerSalon — hand-off to a new chat (Oct 5 2026)

## 1. The package
- **Code:** `AIPowerSalon-repo.bundle` (27 MB, every branch and tag). Restore with
  `git clone AIPowerSalon-repo.bundle full && cd full && git checkout master`.
- **`master` head: `6485ee1c`** — `fix(authz): any technician could read every colleague's message to management…`
  Verified on this head after the rollback below: 34/34 gates, 6 API shards 1,673 passed / 0 failed, display app 43.
- **Removed from `master` at Kevin's request (Oct 5):** everything built for the *Android Check-In & Customer Checkout
  Display* spec. It is preserved, untouched, on branch **`spec/checkin-display-oct5`** and tag
  **`checkin-display-removed-2026-10-05`** (11 commits + one WIP commit). Do not rebuild it unless Kevin asks.
  - Three production bug fixes exist ONLY on that branch and would each be a small standalone cherry-pick if wanted:
    `b09b3eb1` (ten kiosks checking one appointment in at once created ten queue entries — DB partial unique indexes,
    migration 503), `7d89db20` (two POS stations sharing a customer display silently replaced each other's customer,
    even mid-payment — reservation under a row lock, migration 505), and inside `799444d4` (POS settings controller's
    `act()` never awaited → every async failure in 26 routes was a 500; pairing codes advertised 5 minutes but never
    expired). Kevin was told; no decision yet.

## 2. What `master` contains from this session (all committed, all verified)
Constitution 5 (API) Steps 5b–8 (cursor bridge, OpenAPI manifest + gate, ValidationPipe + mass-assignment gate,
realm × permission contract + client error actions); the §231 Definition-of-Done check (`API_DEFINITION_OF_DONE.md`:
41 done / 8 partial / 5 not done); gift-card + split double-payment fix; real-Postgres race lane in CI; payment replay
keys; load tests (two harnesses repaired + an HTTP harness); five batches of the unkeyed-staff-route permission audit
(`API_ARCHITECTURE_AUDIT.md`, bottom — 363 → 324 unkeyed; the production holes closed are listed there).

## 3. Dev environment (this sandbox; a new container starts empty)
- Local Postgres: `pg_ctlcluster 16 main start` (it stops on its own — run before any DB work);
  `DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres`; `npm run db:migrate` (502 migrations);
  `npm run db:setup` for migrate + seed + demo. The local DB is at **502** — the spec's 503–507 were rolled back.
- Boot the API for live checks: from `apps/api`, `npx tsc -p tsconfig.json` then
  `DATABASE_URL=… REPO_DRIVER=postgres PORT=3031 AUTH_SESSION_SECRET=<32+ chars> NODE_ENV=development node dist/main.js`;
  `GET /health/ready` says `"ready"`. **Rebuild a module's `dist` after editing it** — the API loads `dist`, and a
  `--noEmit` type-check proves nothing about what runs (this bit me once this session).
- Dev salon `PALACE`: `owner@palace.test / Owner!2345`, `frontdesk@palace.test / Front!2345`. Leftover audit fixtures
  in THIS sandbox's DB only (two `tech.audit*@palace.test` users with technician profiles, a probe ticket/queue ticket,
  the `tj6141@tech.test` password was overwritten) — a fresh container has none of them.
- Gates: `node tooling/ci/run-gates.mjs` (34). API shards: from `apps/api`, `npx vitest run --shard=N/6` for N=1..6
  (one per command — two in one call exceed the 300 s tool limit). Race lane: `PG_RACE_URL=… npm run ci:test:race`.
  Module suites: `npx vitest run` in `modules/<m>`, sharded `--shard=1/2` for the big ones (queue, checkout, tenants).
- Standing working method (Kevin's verification pillars): tests at the right level → deliberately break the code and
  confirm the tests catch it → live run on the real API → all gates → the six shards → commit → refresh the bundle
  (`git bundle create … --all` → outputs). Never claim PASS for anything not executed.

## 4. Open items, in order (carried over)
1. Unkeyed staff-route audit, continued: the remaining technician write routes, then the help area (30 routes), then
   DoD item 57 (324 unkeyed staff routes — document each or add a key).
2. DoD items 32/33: async contract for long-running operations (202 + job status), starting with heavy report exports.
3. DoD item 53: run the load tests on target infrastructure with production-sized data (sandbox numbers are in
   `API_DEFINITION_OF_DONE.md`).
4. Constitution 5 §232 final report (all 48 sections).
5. Kevin's own items: set `DB_TENANT_RLS=1` on staging; verify `nailsalons@aipowersalon.com` in SendGrid.
6. The refresh-cookie path must move when the apps switch to `/api/v1`.
7. Decide on the three bug fixes stranded on `spec/checkin-display-oct5` (section 1).

## 5. Standing documents to read first
`API_ARCHITECTURE_AUDIT.md` (Constitution 5 + the permission audit, dated entries), `API_DEFINITION_OF_DONE.md`,
`DEVELOPER_HANDOFF.md`, `ENGINEERING_RULES.md`, `LOCAL_DEVELOPMENT.md`, `CHANGELOG_HANDOFF.md`.

## 6. Opening prompt for the new chat
> Restore `AIPowerSalon-repo.bundle` (branch `master`, head `6485ee1c`) and read `NEW_CHAT_HANDOFF_2026-10-05.md`,
> then `API_ARCHITECTURE_AUDIT.md` (bottom) and `API_DEFINITION_OF_DONE.md`. Work the open items in section 4 in
> order, with the working method in section 3 (break-the-code checks, live runs, gates, shards, commit, bundle).
> Do not rebuild anything from `spec/checkin-display-oct5` unless I say so.
