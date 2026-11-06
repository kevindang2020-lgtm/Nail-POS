# F4 Full System Test / F6 Full System Run & Repair — Nov 6 2026

One logged run of every lane (`tooling/ci/final-run.sh`, install lane skipped — no network here) at commit 0160556,
then repairs. `final-run-summary.txt` is that run's own log; `pilot-rerun-1.log` is the pilot day re-run after the first repairs.

## Lane results (first run, 0160556)

| Lane | Result | After repair |
|---|---|---|
| migrations (fresh / harness / race / live / pilot) | 760 applied, rc 0 | — |
| builds (packages, modules, api, frontends), typecheck, lint | rc 0 (lint 0 / 0) | — |
| gates | 1 red: `check:api-contract` — 845 routes name no api-contracts wire type | still red: a backlog, not a regression (decision list). 50 stale baseline lines removed (the ratchet only shrinks) |
| tests-packages | pass | — |
| tests-modules | 3 failures | fixed (below) |
| tests-apps | 1 failure | fixed |
| tests-api | 5 failures in 3 files | 4 fixed; `route-domains` = the same 845-route wire-type backlog |
| harnesses | 8 / 9 (`verify-live-socket` 21 / 26) | 26 / 26 |
| race lane | 3 files red | all pass (one was a 5 s timeout under full-run load; passes alone, twice) |
| live route sweep | 1 × 500 + 41 4xx with real fixtures | the 500 fixed; the 4xx list is triaged below |
| live API harnesses, display lifecycle, drill restore | pass | — |
| live event wiring | 18 / 19 (phase-4 booking verification proof) | proof 50 / 50 |
| live pilot day | 224 pass / 10 fail | re-run: 230 / 5; the remaining 5 are below |
| e2e-html | could not start (browser path) | pass (24 API calls verified) |

## Product defects found and fixed

1. **Tech App "change service" answered 500** — the serving floor read its lines and sessions with `.catch(() => [])`, so any
   failed read made a ticket look empty ("Service line not found"), and the tech controller turned every serving refusal
   into a 500. The two reads now surface their error; `servingHttpError()` is the one mapping for both controllers
   (missing line → 404 `SERVICE_LINE_NOT_FOUND`). Test: `serving-http-error.vitest.spec.ts`.
2. **Reschedule refused a time the salon clock allowed** — a coarse UTC-day guard ran even when the salon's own clock was
   available. It now runs only without a salon clock.
3. **Segments "stored history" day with a bad date → 500** — the retention snapshot error was not mapped. Now 400
   `SNAPSHOT_INVALID_DATE` (test in `segments.pgtest`).
4. **Scheduled price changes job** — ran outside `runTick`, so its runs and failures were not in job telemetry.
5. (from the F1 unit, same day) PostgreSQL JIT compiled every directory query — off by default (`PG_JIT=on`).

## Tests / proofs that were out of date (rewritten to the current truth, never deleted)

- Time-of-day dependent tests (a call or event 2–3 h ago read with "today": fails in the salon's first hours) — AI Calls KP-02,
  Payment Terminals audit history; a test that assumed a US time zone (AI package trial end date).
- Loyalty race seed used the retired `repo.adjust` (staff never change points by hand since Nov 5) → seeded through the ledger.
- AI Receptionist race: a fixed voice-key hash collided with the unique active-hash index on a reused database.
- OpenAPI manifest line now carries `resource=SCOPE/source` (aae3cd1).
- Live proofs: booking actions must be ARMED by the salon (AI Receptionist guide, Oct 31); a paid membership waits for its
  first payment (D6, Nov 4) — the pilot plan opens with a trial; the Technician App pay stub is English only (POSLanguage
  §11–12, Oct 28) — the Vietnamese stub is the POS's; a Tap to Pay refund now goes to the CommerceHub rail (Kevin, Oct 28)
  — S11 proves one signed CommerceHub refund, nothing to the branch gateway, no double refund on retry; a location with
  its own merchant needs its own Tap to Pay MID (migration 704) — the S14 annex is given one.
- The live-socket harness's PGlite socket serves one connection: the API runs there with `PG_POOL_MAX=1`.
- Playwright browser path: newer boxes link `/opt/pw-browsers/chromium` straight to the binary.
- The pilot read the Customer Queue while it still said "Đang tải…" (it checked only the first 300 characters; the API
  answered in ~0.1 s at 200 technicians — measured).

## Second round (commits 0016ac6, 53bfdc9, 835b58e)

More product defects found and fixed:

6. **Tech Queue crashed** into "Something went wrong on this screen" when a finished ticket had no primary technician
   (its service-mix column had a null name; `null.split`). The server groups the mix by the line's technician (else the
   ticket's) and leaves out lines with neither; the screen guards the name. Test in `POSTechQueueScreen.test`.
7. **Check-In tables broken**: a global `.ci-row{display:flex}` (Customer Communications) turned the Live Check-In Queue and
   Waiting Lounge rows into flex rows — every cell squeezed to one letter. Scoped to `div.ci-row`.
8. **AI Analytics, AI Business and AI Marketing refused every owner and manager** ("Your role cannot …"): the services
   checked `permissions.includes(key)`, and those keys are alias-granted; the route guard (the platform rule) had let them
   in. Seven AI centres now use `hasPermission()`. Test with real catalog sessions.
9. **One screen at 1920 × 945 (§66–§79)**: 2 / 18 module × language checks passed on the busy floor; now 18 / 18 (busy, on
   the pilot's own 200-technician data) and 18 / 18 (light). Row actions ran past their cards (Checkout, Tech Queue,
   Service Done, Customer Queue, Check-In); compact controls had no 44 px hit area where the button clipped its own label
   (`overflow: clip` + clip margin now, honoured by `hitSlop`), where the cell clipped it, near a card's rounded corner, or
   behind a toggle's knob; older transparent hit extenders now obey the measuring switch.

Pilot / sweep corrections:
- The pilot gave browser pages a session's cookies; a page that refreshed the session rotated its refresh token, and the
  proof's next refresh replayed the used one — the platform rightly revoked the Super Admin (REFRESH_REUSE_DETECTED). Pages
  now hand their cookies back on close.
- The Customer Queue Manage view is a modal (it covers the topbar); §107's switch is delivered to the control directly.
- Route sweep: owner 403s on the AI centres are gone (41 → 30 listed); the rest are fixture gaps (a made-up id → 404, a
  missing required parameter → 400) and two retired routes (410 ENDPOINT_RETIRED — now on the by-design list).

## Final pilot day (835b58e): 236 / 236 PASS, 0 FAIL — `pilot-final.log`

## Still open after the re-run

- **One screen, busy, 200 technicians (§66–§78)**: 7 of 9 modules fail the layout rules at 1920×945 (clipped button text,
  pills cut off by their card, controls shorter than 44 px) in English and Vietnamese. It was 54 / 54 in October, so the
  later screen work regressed it. Being repaired next.
- **13f language switching**: the switch was not found on /booking in that step; the next run records a screenshot and
  the page text.
- **Live route sweep 4xx list**: mostly fixture gaps (a made-up id → 404, a missing parameter → 400); the AI Analytics /
  Business / Marketing centres answer 403 to the owner — most likely the AI package gate (the pilot salon without the
  package shows "Subscribe to unlock"); not yet confirmed on the sweep's salon; the sweep's explained-4xx list predates Batches C–G.
