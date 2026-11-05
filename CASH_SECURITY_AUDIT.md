# Cash Subsystem — Security & Correctness Audit

Adversarial audit of the money-handling code built this session (register drawer, mid-shift cash movements, technician
hand-offs, owner daily close-out), run before live transactions flow through it. Method: a live API harness exercising
each risk class against the real Postgres-backed endpoints.

## Results — fundamentals all PASS
| Check | Result | Evidence |
|---|---|---|
| **Tenant isolation** | ✅ PASS | A tenant-B owner hitting `/owner/cash-summary`, `/owner/cash-drawer`, `/owner/cash-handoffs` sees **zero** tenant-A markers (branch name, amounts, tech names). Scope is derived server-side; the global tenant-context middleware strips any client-supplied tenant/branch keys. |
| **Authorization** | ✅ PASS | Every mutating endpoint (`open`, `reconcile`, `movement`, `movement/void`) returns **401** with no session and **403** for a staff session lacking `pos.checkout.take_payment`. Viewing requires a valid session. |
| **SQL-injection (date param)** | ✅ PASS | `date=2026-01-01';DROP TABLE cash_drawer_movements;--` → HTTP 200, sanitized by the `YYYY-MM-DD` regex (`normDate`), table intact. All money math uses parameterized Kysely queries; the only free-text fields (reason/note) are length-capped and parameterized on insert. |
| **Amount validation** | ✅ PASS | Negative, non-numeric, and overflow-ish (`1e9999`→Infinity) amounts are all rejected with `bad_amount`. Money is integer cents (bigint) end-to-end. |

## Finding (fixed this session) — movements had no correction path
**Risk:** a mistaken or accidentally double-submitted cash movement could not be undone — un-correctable money entries are
unacceptable for a register. (Drawer open/reconcile were already idempotent via upsert on the unique business-date key;
only ad-hoc movements lacked this.)

**Fix:** soft-**void** for movements (migration `085`).
- `POST /pos/cash-drawer/movement/void { movementId, date? }` — requires `take_payment`, **tenant-scoped** (cannot void
  another tenant's row — verified), **idempotent** (re-voiding is a no-op), and **audit-preserving** (sets `voided_at` /
  `voided_by_user_id` rather than deleting). A voided movement no longer affects the expected total.
- pos-web: a **Void** action per movement; voided rows render struck-through and are excluded from the expected math.
- Verified 7/7 live: void restores expected to baseline, flags the row, is idempotent, blocks cross-tenant voids, and is
  auth-gated (staff 403 / no-cookie 401). The common double-tap is additionally guarded client-side (button disabled
  while a record is in flight); legitimate repeated movements are still allowed (no false uniqueness constraint).

## Bonus fix — latent date bug in the test suite
The UTC date rolling past midnight during this session exposed pre-existing pos-web tests (drawer reconcile, hand-off
reconcile) that **hardcoded "today"** as `2026-06-16` while the components derive the real current date — they would fail
every day after that date. Fixed to derive the expected date dynamically. (No other suite had date-param assertions.)

## Test status after the audit
api **444** · pos-web **64** · owner-web **21** · customer-web **89** · tech-web **33** — all green; all five frontends + API build clean.

## Not changed (left for your product decision — see MONEY_PATH_QA.md)
The split-payment surcharge behavior, hardcoded tax/surcharge defaults, and settings-schema tightness remain product
decisions, not security defects, and were intentionally left for you rather than changed unilaterally.
