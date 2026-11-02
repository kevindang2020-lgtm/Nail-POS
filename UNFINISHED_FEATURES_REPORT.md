# Unfinished Features Report — AIPowerSalon

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> The split-payment surcharge limitation flagged below has since been **FIXED**: `splitCardSurchargeCents` surcharges the card portion of a split with pre-payment disclosure — splitting no longer avoids the surcharge (see `checkout-display.dto.ts` and the four-bucket compliance pass in `CHANGELOG_HANDOFF.md`).


Honest result: the deep scan found **no significant unbuilt modules**. Modules that older notes listed as "remaining"
are in fact built and wired. The only genuine gaps are one deliberate money-path limitation and a couple of
clearly-labelled "coming soon" UI sections that depend on backend not yet in scope.

| Feature | Current status | What was missing | Files | Backend endpoint | DB table | Status after this pass |
|---|---|---|---|---|---|---|
| Owner — Finance & Reports (Module 5) | **Built** | Older notes said "remaining" — it was already implemented | `owner-web/src/screens/FinanceReportsScreen.tsx` | `/owner` | `payments`, `tickets`, `expenses` | ✅ complete, builds + tests pass |
| Owner — Alerts / More (Module 6) | **Built** | Same as above | `owner-web/src/screens/AlertsScreen.tsx`, `MoreScreen.tsx`, `AuditScreen.tsx`, `ExpensesScreen.tsx` | `/owner` | alerts/audit/`expenses` | ✅ complete |
| NailShowcase Social — customer block system | **Built this session** | Block create/remove + enforcement across follow, profile, followers/following, feed; "Nearby" leaderboard scope | `nail-showcase-social.*` (service/repo/controller/dto), `customer-web` social screens | `/customer/social/block/*`, `/customer/me/blocked` | `customer_blocks`, `customer_follows` | ✅ complete; 52-check harness green |
| Owner-web / Admin-web placeholder screens | **Removed** | Dead `Placeholder.tsx` / `NotWiredScreen.tsx` (unused; misleading comments) | deleted | — | — | ✅ cleaned |
| Split-payment surcharge | **Deliberate limitation (not a fix-now item)** | When card surcharge is on, a `card` payment is surcharged but a `split` is not, so split avoids the surcharge | `apps/api/src/checkout/checkout-display.dto.ts` (documented at `computeTotals`) | `/pos/checkout` | `tickets`, `payments` | ⚠️ documented; correct fix ("Option A": surcharge the card portion + disclose on the split screen) is a coordinated checkout + customer-display change, intentionally deferred rather than half-done. See BUG_FIX_REPORT.md. |
| Customer profile — a few sections | "Coming soon" labelled | Some optional profile sections have no backend yet | `customer-web/src/screens/ProfileScreen.tsx` | — | — | ⚠️ intentionally stubbed in UI; not wired |

There are **no broken or partially-wired core modules**. Everything in the connection map is connected and tested (API 451 + 234 core-spec + 267 frontend tests, all green; typecheck clean; lint 0 errors).
