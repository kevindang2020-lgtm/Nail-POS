# VERIFICATION REPORT — 2026-07-12

All session I said the same thing: *"I cannot run the build, so please run it locally."* I finally got the build
running. Here is what it found.

**The install hang was `playwright`** — its postinstall downloads browsers. `npm install --ignore-scripts`
completes in 20 seconds. Everything below is from the **real toolchain**, not my harness.

---

## Results

| | |
|---|---|
| `tsc --noEmit` — **API** | **0 errors** |
| `tsc --noEmit` — owner-web, admin-web, pos-web, customer-web, tech-web | **0 errors each** |
| API vitest (663 spec files) | **4,589 passed, 0 failed** |
| API Nest-free harness suites | **118 passed, 0 failed** |
| owner-web vitest | **218 passed** (38 files) |
| pos-web vitest | **209 files, 0 failed** |
| admin-web vitest | **742 passed** (128 files) |
| **API production build** (`tsc -p tsconfig.build.json`) | **clean** |
| **owner-web / admin-web / pos-web `vite build`** | **all exit 0** |
| Route table | **2,190 routes, 0 collisions** |
| DI graph | **192/192 modules, 272/272 controllers, 98/98 services** |

**Every spec I wrote this session ran under the real vitest and passed** — schema-guard (5), route-collision (3),
owner-portfolio-dashboard (17), ai-gated-completion (14), ai-entitlement.guard (17), ocr blob (13) / textract (26)
/ rescan (8) / usage (16).

---

## The build found 2 bugs. Both were mine. Both are fixed.

### 1. `tsc` — duplicate `AppDatabase` import

`ai-marketing.module.ts` imported `AppDatabase` twice (from my Part 5 gate work). **`TS2300`.**

A syntax parse — all I had before — happily accepts this. **Only a typecheck sees it.** This is the second time
that exact gap bit me: I also shipped `app.module.ts` with a *missing* `DATABASE` import earlier and caught it
by hand. Both are invisible to everything except `tsc`.

### 2. The Super Admin owners console crashed — and my "safe" catch didn't save it

`SuperAdminOwnersScreen.test.tsx`: **7/7 failing.** My new portfolio panel called
`superAdminApi.ownerPortfolio(...)` in an effect. The existing test mocks `superAdminApi` with a partial object,
so the method was `undefined` — and calling `undefined` throws **synchronously**.

**That is the part worth dwelling on.** I had written `.catch(() => …)` and believed the panel was safe. It was
not: a synchronous throw means **no promise ever exists**, so there is nothing for `.catch()` to attach to. The
exception escaped into the render tree and **unmounted the entire Super Admin owners console** — the owner list,
the salon assignment panel, the audit timeline. All of it, killed by one supporting panel.

In production the method *does* exist, so this would not have fired the same way — but a network-layer change, a
bad build, or a stale bundle would reproduce it exactly, and a side panel must never be able to take the page
down.

Fixed properly, in both components:

```ts
try {
  Promise.resolve(superAdminApi.ownerPortfolio(ownerId))   // survives a sync throw AND an undefined return
    .then(...).catch(...);
} catch { /* degrade this panel only */ }
```

The panel now degrades to an empty list; **everything else on the screen keeps working.** The mock was also
extended, because the screen legitimately calls that method now.

---

## What this changes about the rest of the session

**It corroborates it.** 4,589 API tests and 1,169 frontend tests pass, the DI graph is intact, and every fix I
made — the `/owner/context` collision, the `queue_entries` 500, the refund-netting, the permanently-zero Service
Done badge, the OCR pipeline, the AI entitlement gate — compiles and runs.

But it also proves the thing I kept saying: **a syntax parse and a mocked unit test are not a build.** Two real
bugs were sitting in code I had described as verified, and neither was reachable by anything I could run at the
time.

---

## Still NOT verified — be clear about this

* **`pgtest` specs did not run.** They need a real Postgres, which is not provisioned here. **These are the ones
  that matter most**, because every serious bug I found this session — a nonexistent table, an impossible status
  value, unsubtracted refunds — was a *database* bug that only a real database can catch. Run them.
* **Migrations from an empty database** — not run.
* **Lint** — not run.
* **Manual end-to-end** (owner switching, unauthorized switch, Store Code login, merchant isolation) — not run.

## Reproduce

```bash
npm install --ignore-scripts     # --ignore-scripts: playwright's browser download is what hangs
npm run typecheck
npm test --workspace @aipowersalon/api
npx vitest run                   # per app: owner-web, admin-web, pos-web
npm run build
```
