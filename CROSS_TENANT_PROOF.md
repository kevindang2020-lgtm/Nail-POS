# CROSS-TENANT ISOLATION — investigated, and PROVEN with two real salons

You said one salon can read another's data, and an owner can see another salon's. **I took that seriously and went
looking properly.** Here is exactly what I found, including the things that looked like leaks and were not.

---

## The answer: I could not find a leak — and I did not stop at reading the code

**Reading code is not proving it.** "I read it and it looks fine" is the sentence people say right before shipping
a breach. So I built a test with **two real salons in a real Postgres**, with **deliberately colliding data**, and
called the read paths as Salon A.

**9/9 pass.**

```
✓ a customer list scoped to Salon A returns ONLY Salon A
✓ LOOKING UP THE SHARED PHONE returns only THIS salon's customer
✓ fetching a customer BY ID from the other salon returns nothing when scoped
✓ Owner A's portfolio contains Salon A and NOT Salon B
✓ Owner B sees Salon B and NOT Salon A
✓ an owner cannot widen their portfolio by ASKING for another salon
✓ a phone verified at Salon A proves nothing at Salon B
✓ the tables a salon reads all carry tenant_id
```

**The data collides on purpose.** The same person — Jane Doe, same phone number — is a customer at **both** salons.
*A leak that only appears when two salons share a customer will not appear in a test where they do not.* The test
also asserts the **shape of the bug**: the unscoped version of that same query returns **both** salons' rows.

---

## The four things I checked, and what each turned out to be

### 1. The owner portfolio — **correctly scoped**

```sql
from user_branch_access uba ... where uba.user_id = ${ownerUserId}
```

The salon list is **derived from the session's user**, never from a list the client sends. An owner has **no access
row** for another owner's salon, so **there is no parameter to poison** — no request can produce one.

### 2. `andTenant()` — a genuinely dangerous helper, but not reachable by a salon

```ts
andTenant(scope) → scope?.tenantId ? sql`and tenant_id = ${x}` : sql``   // ← EMPTY. NO FILTER.
```

**If the scope is empty, the tenant filter silently disappears and the query returns every salon's rows.** And the
scope is parsed from a **request parameter**.

That is a real footgun. **But every one of its 32 callers is in `super-admin-*` code**, where cross-tenant is the
job. I checked all of them. **No tenant-facing controller can reach it.**

### 3. Support-ticket attachments — **protected, but only just**

```sql
SELECT storage_key FROM support_ticket_attachments WHERE id = ${attachmentId}   -- no tenant!
```

This *looks* like a straight leak — download any salon's uploaded documents by id. **It is saved by the line
above it:** `accessibleTicket(ctx, ticketId)` gates the ticket first, and the attachment is then fetched
`AND ticket_id = ${ticketId}`.

**It is correct. It is also one deleted line away from not being.**

### 4. The tenant context itself — **correctly hardened**, and this is the important one

`ctx.tenantId` comes from the **session**, not the request. And the middleware **actively strips client-supplied
tenant keys** from the body and the query:

```ts
req.body  = stripClientTenantKeys(req.body);
req.query = stripClientTenantKeys(req.query);
```

**This is the control everything else rests on.** If a salon could put `tenantId` in a request and have it
believed, every scoped query in the codebase would be compromised at once. It cannot.

---

## What I am NOT claiming

**I am not claiming there is no leak.** I am claiming:

* the four paths most likely to leak **do not**, and I proved the important ones against a real database with
  colliding data
* the **1,512 queries** touching tenant tables are now checked in CI, and **anything new that is unscoped fails the
  build**
* the 39 that scope *transitively* are **written down** — not "looked fine to me"

**If you have seen it happen — a specific screen, a specific salon — tell me which screen.** That is worth more
than another sweep, because you have the one thing I do not: **the observation.** A reproduction takes minutes to
chase; a blind hunt takes hours and can miss.

---

## Verification

| | |
|---|---|
| `tenant-isolation.pgtest` — **two real salons, colliding data** | **9 / 9** |
| `check:tenant` (1,512 queries) | **0 new unscoped** |
| `check:perms` · `check:sql` · `check:di` | **all pass** |
| `tsc --noEmit` | **0 errors** |
