# ERROR_AND_BUG_REPORT

## Baseline (re-verified this pass)
- `apps/api` TypeScript typecheck: **clean** (0 errors).
- `apps/api` vitest: **661 passed (99 files)**.
- No compilation errors, broken imports, missing exports, or circular-dependency failures surfaced in the api build.

## Known, non-blocking item
- `admin-web/src/.../HardwareScreen.test.tsx` is a known **parallel-run flake** — passes in isolation / on re-run; not a regression. Documented previously.

## Not present
- No TODO/placeholder handlers, empty catch blocks, or `any`-to-silence-errors patterns were introduced by recent work; the recovery prompt's prohibition on these is already the working standard (see root `BUG_FIX_REPORT.md`, `UNFINISHED_FEATURES_REPORT.md`).

## This session's fixes (already applied + verified)
Money-path hardening: per-segment split guard, cash tender guard + conservation, card idempotent replay, tip guards, card claim-first, split `payment_attempts` reservation, **discount integer guard**, **atomic refund cap**. Each gated (tsc + vitest) and, where DB-dependent, verified against live Postgres.

## Verdict
No critical errors in the baseline. The codebase is in a green, releasable state for the api; frontend suites were last green this session (see TEST_BASELINE) and will be re-run in Phase 1.
