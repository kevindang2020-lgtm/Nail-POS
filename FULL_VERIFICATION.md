# FULL VERIFICATION — everything run, 2026-07-13

I have been telling you all session to run the suite. I ran it. **Here is the whole thing, measured.**

---

## Tests — 7,161 passing, 0 failing

| | files | tests |
|---|---|---|
| **API** (vitest) | **684 / 684** | **4,898** |
| **API pgtest** (real Postgres) | **12 / 12** | **117** |
| API Nest-free harness | 118 / 118 | — |
| pos-web | **209 / 209** | 643 |
| admin-web | 128 / 128 | 742 |
| customer-web | 55 / 55 | 249 |
| owner-web | 38 / 38 | 218 |
| tech-web | 18 / 18 | 97 |
| **TOTAL** | **1,262 files** | **7,161** |

**Zero failures. Anywhere.**

## Builds — everything compiles

```
API   (tsc -p tsconfig.build.json)   exit 0
pos-web · owner-web · admin-web · customer-web · tech-web   (vite build)   all exit 0
```

## Guards — all green

| | |
|---|---|
| `tsc --noEmit` (API + 5 apps) | **0 errors** |
| `check:sql` — 1,767 raw SQL statements PREPAREd against the real schema | **0 errors** |
| `check:di` — every `@Inject` token has a provider | **0 dead injects** |
| DI graph | **193/193 modules reachable · 282 controllers** |
| Route table | **2,218 routes · 0 collisions** |
| POS sidebar ↔ route invariant | **holds** |
| Schema | **562 tables · 374 migrations** |

---

## One thing I checked because I did not want to be wrong about it

I have been citing the **pgtests** as my strongest evidence all session — they are the only thing that catches the
class of bug that dominated today (a table that does not exist, a status that can never occur, an `ON CONFLICT`
against a partial index).

So I checked whether they **actually run in CI**, rather than assuming.

They do. `scripts/run-core-specs.sh` runs `npx vitest run` with **no exclusion**, so all 12 pgtest files execute on
every CI run. When I saw them reported as "skipped" during this sweep, that was **my own glob being
shell-expanded wrong**, not the tests opting out — run directly, they pass 117/117.

**Worth the two minutes.** If they had been silently skipping, every "verified against a real Postgres" claim I made
today would have been worthless.

---

## What this does and does not tell you

**It tells you:** nothing is broken that the machine can see. The code compiles, the SQL resolves against the real
schema, every module is wired, every route is reachable, and 7,161 tests agree.

**It does not tell you the code is right.** Roughly **7,000 lines** were written across these modules today and
**no human has read any of them.** A test suite proves the code does what *I* thought it should. It cannot tell you
whether what I thought was what *you* wanted — and today alone I:

* shipped a fraud engine that was **never wired** (19 passing tests, dead code)
* wrote a checker that reported **OK while blind**
* bound the account-takeover warning as a **no-op**, then to the **wrong env var**
* refused a configuration you were **right** to want (`requireSmsVerification: false`)

Every one of those passed tests. **The suite is a floor, not a verdict.**

## What I would actually do next

1. **Read the diffs.** Especially `customer-phone/`, `customer-booking/`, and the two closed bypasses in
   `customers.kysely.repository.ts` and `customer.kysely.repository.ts` — those changed behaviour a salon will
   notice on day one.
2. **Run it against a real database with real data**, not PGlite. The migration chain applies on PostgreSQL 16
   (373/373 verified) but no real tenant's data has ever been through it.
3. **Turn on `check:sql` and `check:di` in CI** — both are already wired, and both have been *proven* to fail on a
   reintroduced bug rather than assumed to.
