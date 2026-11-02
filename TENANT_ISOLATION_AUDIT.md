# TENANT ISOLATION — the worst bug a multi-tenant SaaS can have

```sql
select * from customers where id = $1
```

Valid SQL. Real table. Real column. **`check:sql` passes it.** It compiles, it runs, it returns a row — **and the
row may belong to another salon.**

One missing `tenant_id` is not a broken feature. It is **Salon A reading Salon B's customers** — their phone
numbers, their revenue, their appointments. And it is **invisible to every other check in this repo:**

* `tsc` sees a string.
* `check:sql` sees a perfectly valid statement.
* `check:impossible` sees literals that can all occur.
* The unit tests mock the repository and return whatever the test seeded.

> **A test suite proves a query returns what you asked for. It cannot tell you the query was *allowed* to ask.**

---

## Result

**1,512 queries** touch a tenant-scoped table. **894 carry `tenant_id` explicitly.**

**No confirmed cross-tenant leak.** The rest resolve into three legitimate classes:

| | |
|---|---|
| **553** | Super Admin / platform code — **cross-tenant *is* the job** |
| **21** | a WRITE by primary key, where the id was read under scope moments earlier |
| **5** | pre-auth — at **login** you look somebody up by email or phone, because you **do not yet know their tenant.** Scoping that by tenant would be circular. |
| **39** | scoped **transitively** — via a tenant-owned FK (`plan_id`, `promotion_id`) or a globally unique provider SID. **Reviewed, file by file, and baselined.** |

**Anything new that is unscoped now fails the build.**

---

## I got this wrong three times, and the second one would have shipped the leak

### 1. I classified super-admin by FILE PATH

It missed `ai-business-admin`, which is genuinely behind `SuperAdminGuard` and legitimately counts
`DISTINCT tenant_id`. **Crying wolf on correct code.**

### 2. Then I classified it by DIRECTORY — and this is the one that matters

`customer-phone/` has **one** oversight controller behind `SuperAdminGuard`. So **every query in the entire module
got a free pass.**

I then deleted the tenant scope from a real customer lookup:

```sql
select id, full_name, record_version from customers where id = $customerId
```

**A textbook cross-tenant read of another salon's customer. My checker waved it through.**

> **A module with one super-admin controller was exempting all of its tenant queries.** That is not a strict checker
> with a blind spot. It is a checker that would have missed the exact bug it exists for.

### 3. And I called `where id = $1` a "safe" class

I reasoned: *the id was fetched under tenant scope, so it is fine.*

**That is false, and false for the single most common leak shape there is:**

```
GET /customers/:customerId   →   select * from customers where id = $customerId
```

**The id comes from the URL. An attacker chooses it.** A read by primary key with no tenant is a leak until proven
otherwise. Only a *write*, whose id was demonstrably read under scope, earns the benefit of the doubt.

---

## So I stopped inferring the exemption. The author has to write it down.

Every heuristic I tried was wrong, and **each was wrong in the direction that hides a leak.** So a file that
legitimately queries across tenants now **declares it**:

```ts
// CROSS-TENANT BY DESIGN: customer_identities is the CENTRAL identity — one person, many salons.
//                         It has no tenant_id by definition.
```

One line. Reviewable in a diff. **Cannot be granted by accident to a file that merely sits next to one.**

Five of my own files are annotated: the hold-expiry sweep (releases lapsed holds for *every* tenant — that is the
job), the retention sweep, two Super Admin aggregates, and the central identity table.

---

## PROVEN

Delete `AND tenant_id = $tenantId` from the customer lookup:

```
customer-phone/customer-phone.kysely.ts
   tables: customers
   SELECT id, full_name, record_version FROM customers WHERE id = $customerId LIMIT 1
exit 1
```

Restore it → exit 0.

**It took three attempts to build a checker that catches that.** It slipped through the first two.

---

## Eight guards in CI

| | catches |
|---|---|
| `check:sql` | SQL hitting a table/column that does not exist |
| `check:di` | an `@Inject` with no provider — built, tested, never wired |
| `check:impossible` | SQL that runs but can never be true |
| `check:nav` | a sidebar item with no route |
| `check:nav:deep` | a sidebar item whose screen is a stub, or calls a dead endpoint |
| `check:crosswire` | any frontend call that 404s |
| `check:perms` | a permission that denies everyone, or silently demands MANAGE |
| **`check:tenant`** | **a query that could read another salon's rows** |

**All eight pass. All eight have been broken on purpose to confirm they scream.**

## Verification

| | |
|---|---|
| All eight guards | **exit 0** |
| `tsc --noEmit` | **0 errors** |
| customer-phone + customer-booking | **327 / 327** |
| Queries on tenant tables | **1,512 · 0 unreviewed unscoped** |
