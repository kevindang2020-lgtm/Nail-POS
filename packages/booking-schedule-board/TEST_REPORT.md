# Test Report — Booking Schedule Board (standalone)

Run date: 2026-10-27 · Node 22 · React 18.3 · Vite 5 · Vitest 2 · Chromium (Playwright)

| Lane | Command | Result |
|---|---|---|
| Typecheck (strict) | `npm run typecheck` | 0 errors |
| No-print gate | `npm run check:no-print` | OK — **negative-tested**: adding a `Print Schedule` / `window.print()` button fails it with file:line |
| Domain tests | `vitest src/tests/domain.test.ts` | 18 / 18 |
| Adapter tests | `vitest src/tests/adapter.test.ts` | 14 / 14 |
| Board UI tests | `vitest src/tests/board.test.tsx` | 15 / 15 |
| **Total unit/UI** | `npm test` | **47 / 47 passed, 0 skipped** |
| Build | `vite build` | OK |
| Real browser | `node scripts/e2e-browser.cjs` | **13 / 13 checks passed**, 0 page errors |
| Production bundle leak scan | esbuild of `src/index.ts`, grep for mock adapter / fixture names / demo tenant | 0 matches |

## Sabotage proof (the double-booking test can fail)

Removed the mock backend's mutation serialization and let validation run against stale state →
acceptance #3 failed ("expected 1 fulfilled, got 2": both stations committed the same slot).
Restored → passed. So the test genuinely guards concurrency.

## Spec §38 fixtures covered

24-technician day (demo loads 25 staff, 1 on time off → 24 working); 25-working-technician paging (12/12/1); technician with lunch
and multiple gaps (tech-002); 45- vs 60-minute fits; technician eligible for Gel Manicure but not Acrylic (tech-003); protected
future appointment (tech-005, 3:00 PM); time-off technician (tech-008); blocked-time conflict (tech-006 4–5 PM + created blocks);
simulated concurrent conflict; realtime mutation event; long names (tech-011/012); multi-service + add-on appointment spanning
120 minutes (tech-007).

## Verification pillars

| Pillar | Standalone status |
|---|---|
| Tenant isolation | Verified against the mock: foreign tenant/branch → `PERMISSION_DENIED`; foreign ids → `NOT_FOUND`/`TECHNICIAN_UNAVAILABLE` and untouched; realtime scoped. **NOT VERIFIED against the real API** (needs host repo). |
| Branch isolation | Same as above. **NOT VERIFIED against the real API.** |
| RBAC / permissions | UI gating verified (read-only hides Block time, disables booking). Server enforcement **NOT VERIFIED** — host responsibility, listed in MERGE-CHECKLIST. |
| Database persistence | **NOT VERIFIED** — no database in a standalone module by design (spec §22: no duplicate appointment table). Merge uses the existing appointments table and its overlap guard. |
| Audit | Mock records actor/previous/next for create, move, reassign, cancel, blocked time, price override. Real audit service **NOT VERIFIED.** |

## Not testable standalone

Acceptance #8 (host Add Walk-In reconciling queues/Fair Turn in the real app), the real SSE transport, and the physical 27" display.
