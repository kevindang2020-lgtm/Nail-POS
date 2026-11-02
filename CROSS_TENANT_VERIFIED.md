# CROSS-TENANT ISOLATION — verified against the real code

> *"One salon reading another salon's data, and an owner seeing other salons. Make sure it's fixed correctly."*

**It is. And here is the proof, not the reassurance.**

---

## The gap I found in my own testing

There was already a `tenant-isolation.pgtest` — two salons, a real Postgres, a shared customer phone number. It
passed.

**And it imported no repositories.**

It wrote its **own** SQL, correctly scoped with a `tenant_id`, and asserted the scoping worked.

> **That proves the SCHEMA supports isolation. It does not prove the PRODUCTION CODE does it.**
>
> The test would have passed with flying colours while **every repository in the codebase quietly forgot its tenant
> predicate** — because it was never asking them.

So I rewrote it to call **the real classes that serve the real endpoints.**

---

## The setup — deliberately colliding data

Two salons. Two owners. **The same customer, with the same phone number and the same name, at both.**

That last part is the whole test. **A leak that only appears when two salons share a customer's phone number will
not appear in a test where they don't** — and in a nail-salon chain, sharing a customer is Tuesday.

## What is now proven, by the real code

| the real class | asked for | result |
|---|---|---|
| `KyselyPhoneStore.customer()` | Salon B's customer id | **null** |
| `KyselyPhoneStore.matchesByHash()` | the shared phone | **only its own salon's customer** |
| `KyselyPhoneStore.settings()` | tenant policy | **its own, not the other's** |
| `KyselyOwnerPortfolioRepo.loadPortfolio()` | Owner A's salons | **Salon A only — never Salon B** |
| same, for an owner with **no grants** | | **nothing — not everything** |
| `booking_verified_phones` | a phone proven at Salon A | **proves nothing at Salon B** |

**14 / 14.**

### The owner path, specifically

`GET /owner/portfolio` scopes on `user_branch_access.user_id = ${ownerUserId}` — and `ownerUserId` comes from the
**session**, never from a URL or a body. **Every** call site checked: `r.ctx.userId`.

And salon switching cannot widen it: `decideSwitch()` validates the requested salon is **already in the owner's own
portfolio**, so a tampered `salonId` in the request body **cannot put an owner into a salon they do not own.**

---

## And I PLANTED BOTH LEAKS to prove the tests catch them

**Leak 1 — the customer read.** Deleted `AND tenant_id = ${tenantId}` from the real customer lookup:

```
AssertionError: Salon A must not read Salon B's customer: expected {…} to be null
1 failed | 13 passed
```

**Leak 2 — the owner portfolio.** Replaced `where uba.user_id = ${ownerUserId}` with `where 1=1`:

```
AssertionError: Owner A must NOT see the other salon: expected […] to not include 'bbbbbbbb-…'
2 failed | 12 passed
```

It also failed *"an owner with NO grants sees NOTHING — not everything"* — **the failure that matters most.** A
portfolio query with a broken `WHERE` returns *every* salon, and an empty portfolio looks identical to a working one
**until the day somebody with no grants logs in and is shown the entire platform.**

Restore either → **14/14.**

---

## Two layers, and neither is enough alone

| | |
|---|---|
| **`check:tenant`** (static) | reads every SQL statement and flags any that touches a tenant table without a `tenant_id`. **1,512 queries checked.** Anything new that is unscoped **fails the build.** |
| **`tenant-isolation.pgtest`** (runtime) | seeds two real salons and asks the **real repositories** for the other salon's data. **Proven to fail when a leak is planted.** |

Static analysis reasons about strings. The runtime test asks the database. **Each one catches things the other
cannot**, and both are now in CI.

## Verification

| | |
|---|---|
| tenant-isolation pgtest (real repositories, real Postgres) | **14 / 14** |
| common + customer-phone + owner-portfolio | **346 / 346** |
| `check:tenant` · `check:sql` · `check:di` · `check:perms` | **all exit 0** |
| `tsc --noEmit` | **0 errors** |

**A salon reads only its own data. An owner sees only their own salons. Both are proven by breaking them.**
