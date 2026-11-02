# DEVELOPER_TASKS.md
### The exact order to continue — APS-numbered, five phases, acceptance = the existing gates
Rules of engagement: read DEVELOPER_HANDOFF.md first; green before AND after every change (the battery + 13
gates are the definition of "working"); never delete a failing test — pin the new truth; reuse before build.

## Phase 1 — Environment & verification (day 1–2; no owner input needed)
- **APS-001** Clone/extract → `npm install` → LOCAL_DEVELOPMENT.md end-to-end: DB up, 432/432 migrations, seed,
  API on :3000, POS + Admin running, seed logins work. *Accept: you can check a customer in and out locally.*
- **APS-002** Run the proof surface yourself: 8-shard battery (expect 6,091 + 4, 0 failed), all 15 gates,
  `security:fast` (16 PASSED), `auth-matrix-e2e` (13), `e2e:html`. *Accept: numbers match TEST_REPORT.md.*
- **APS-003** Read in order: PROJECT_STATUS → ARCHITECTURE → DATABASE_ARCHITECTURE → AUTH_AND_SECURITY →
  ENGINEERING_RULES → KNOWN_ISSUES → FRONTEND_BACKEND_GAPS. *Accept: you can answer the §51 walkthrough
  questions in DEVELOPER_HANDOFF.md.*

## Phase 2 — Credentials & integrations (as owner supplies each; independent tracks)
- **APS-010** GitHub: create private repo, follow PUSH_TO_GITHUB.md exactly, confirm security CI green on push.
- **APS-011** Twilio: env per SECRETS_REQUIRED.md → live verification SMS end-to-end → callback signature
  verified against real traffic → ledger DELIVERED lifecycle observed. *Accept: SMS report NOT-VERIFIED items
  for live sends struck, with evidence.*
- **APS-012** CommerceHub sandbox: implement the capture call in the TapToPay socket
  (`TapToPayNotImplementedError` site) → payment-attempt suites green against sandbox. *Accept: a real sandbox
  tap-to-pay charge recorded with correct integer-cent math.*
- **APS-013** SendGrid: key + domain auth → transactional sends verified.
- **APS-014** Push: APNs/Firebase env → device registration → the four triggers received on a physical device.

## Phase 3 — Hosting & deployment (after APS-010; ~week)
- **APS-020** Provision host + managed Postgres 16; envs; `db:migrate`; deploy API per DEPLOYMENT.md.
- **APS-021** Deploy the static frontends + HTML kiosk apps with configured API base; real CORS/TLS/rate
  limits. *Accept: the 4 NOT-VERIFIED security checks flip to PASSED.*
- **APS-022** Enable the 7 worker flags in the right environment; observe one nightly customer-recon and one
  03:30 SMS-recon tick file findings (not fixes).

## Phase 4 — Native & devices (Mac in hand; parallel to Phase 3)
- **APS-030** Capacitor iOS/Android builds for the 4 apps; Face-ID flip; on-device smoke per app.
- **APS-031** Store submissions per the two runbooks.
- **APS-032** ASUS V470 physical checklist; kiosk hardware pass; Fiserv reader-in-hand checks.

## Phase 5 — Launch validation (the first real salon day)
- **APS-040** Pilot salon dry-run: full open-to-close day on production — check-ins, queue, checkout with real
  tender, tips, clock-in/out, end-of-day drawer + reports. File every rough edge in KNOWN_ISSUES.md.
- **APS-041** Owner items closed: SMS pricing entered; Schedule-A signed; §42 trial credit decided.
- **APS-042** Post-pilot review: burn down the filed issues; only then widen tenants.

**Standing definition of done** for every task above: code + tests green (battery/gates unchanged or grown),
docs updated in the same commit (CHANGELOG_HANDOFF.md dated section), no invariant in ENGINEERING_RULES.md bent.
