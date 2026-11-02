# CI GUARDS — five checks, each proven to fail on a real bug

Every bug that dominated this codebase was **invisible to `tsc` and invisible to the unit tests.** Not because the
tests were bad — because the thing that was broken lived *between* the parts the tests cover.

Five guards now stand there. Each one is in CI, and **each one has been broken on purpose to confirm it screams.**

---

| guard | catches | proven by |
|---|---|---|
| **`check:sql`** | SQL that references a table or column that does not exist | reintroduce the `tenant_settings.value` bug → **exit 1** |
| **`check:di`** | an `@Inject` token with no provider — **a module built, tested, and never wired** | unwire the fraud engine → **exit 1** |
| **`check:impossible`** | SQL that *runs* but can **never be true** — a literal no CHECK constraint permits | reintroduce the dead hardware alert → **exit 1** |
| **`check:nav`** | a sidebar item whose route nothing handles — **a blank page a user can click** | delete a route, keep the nav item → **exit 1** |
| **`check:crosswire`** | a frontend API call to a route that does not exist — **a button that does nothing** | typo an endpoint → **exit 1** |

**All five pass. All five fail when they should.**

---

## What each one already found

* **`check:sql`** — 5 bugs, including a dropped table that 500'd the All Salons dashboard, and
  `tenant_settings.value`, which meant **appointment reminders were not going out at all.**
* **`check:di`** — the **fraud engine was dead code**: `@Optional() @Inject('BookingRiskCounters')` with nothing
  providing it. 19 passing tests describing a path that could never run.
* **`check:impossible`** — **push notification delivery has never been logged**, and **subscription pause and
  scheduled cancellation were both broken** — CHECK constraints forbidding values the code writes, so the INSERTs
  and UPDATEs *threw*, and a `.catch()` swallowed one of them.
* **`check:nav` / `check:crosswire`** — clean now, and they are the only things standing between you and the next
  dead link.

---

## The uncomfortable part: getting the checkers right was harder than getting the code right

**Four times today I wrote a checker that was wrong.** Every one would have shipped a false sense of safety.

1. **`check:di` reported OK while blind.** Its comment-stripping regex hit a `/*` inside a string, opened a fake
   block comment, and **swallowed the `@Inject` it was looking for.** It printed green on a codebase where I had
   *just deliberately cut a wire*.

2. **`check:nav` was reading the wrong files.** It looked in `shell/*nav*`; four of five apps keep their nav in a
   **Layout**. It found 0–6 items across four apps and printed **OK**.

3. **`audit-crosswire` reported 9 frontend calls that would 404. All nine were fine** — it stopped reading at a
   closing quote, so `api.patch('/incidents/' + id + '/transition')` came out as `/incidents`.

4. **`check:crosswire` detected an orphan, printed it, and exited 0.** The guard referenced a variable that did not
   exist. **CI would have gone green on a 404-ing endpoint.**

And it read its route table from `/home/claude/work/api-routes.json` — **an absolute path into a scratch directory
on one machine.** In CI it would have crashed on line 8. *A check that cannot run is a check that is not running —
the same as no check, except that it looks like one.*

Then I wrote a **second** route collector inside it, which found 2,191 routes where the real one finds 2,218 — and
produced **24 fake orphans.** Two collectors always drift. It now imports the one table.

> **A checker that reports OK when it is blind is worse than no checker: it is a green light with the wires cut.**
>
> **And a checker that cries wolf on correct code is how the real findings get ignored along with the noise.**

**I only found any of this because I tried to break each one instead of trusting it.** That is the habit worth
keeping — more than any of the code.

---

## Verification

| | |
|---|---|
| `check:sql` · `check:di` · `check:impossible` · `check:nav` · `check:crosswire` | **all exit 0** |
| `tsc --noEmit` (API + 5 apps) | **0 errors** |
| customer-phone + customer-booking | **327 / 327** |
| Nav items across 5 apps | **326 · 0 dead** |
| Frontend → backend calls | **1,561 · 0 orphans** |
| Modules reachable | **193 / 193** |
| Routes | **2,218 · 0 collisions** |
