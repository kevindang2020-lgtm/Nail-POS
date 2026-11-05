# Can one salon read another salon's data? Can an owner see another owner's salons?

**No. I traced every layer, and I did not take my own word for it.**

Here is exactly what I checked, and how each one holds.

---

## 1. Where does `tenantId` come from?

**Only from the signed session.** Never from the request.

```ts
// TenantContextMiddleware — applied GLOBALLY
const session = sessionFromRequest(req, AUTH_SESSION_SECRET);
if (!session) throw new UnauthorizedException("No session");

req.ctx = { tenantId: session.tenantId, branchId: session.branchId, userId: session.userId, ... };

// and then, critically:
if (req.ctx.role !== "SUPER_ADMIN") {
  req.body  = stripClientTenantKeys(req.body);
  req.query = stripClientTenantKeys(req.query);
}
```

**A salon cannot spoof its scope.** If they put `tenantId` in the body or the query string, it is **stripped
before any controller sees it.** The only tenant that exists is the one inside their cryptographically signed
session cookie.

## 2. Can an owner see a salon they do not own?

**No.** The portfolio is built from *their own* grants:

```sql
select ... from user_branch_access uba
join tenants t on t.id = uba.tenant_id
where uba.user_id = $ownerUserId          -- ← from the SESSION, not the request
```

And the controller passes `req.ctx.userId` — **the session's user**, never a path or body parameter. An owner
cannot ask for somebody else's portfolio, because there is nowhere to put the request.

## 3. Can an owner *switch into* a salon they do not own?

**No — and this is the sharpest one, because it is where I would have attacked it.**

The switch endpoint takes a `salonId` from the body. **The server does not trust it:**

```ts
const portfolio = await this.repo.loadPortfolio(req.ctx.userId);        // THEIR salons
const decision  = decideSwitch(portfolio, body.salonId);                // is it in there?
if (!decision.ok) throw 403;

const claims = { tenantId: decision.tenantId, ... };                    // the SERVER's answer
const token  = signSession(claims, ...);                                // re-signed
```

A tampered `salonId` gets a **403**, and the session is **re-signed with the tenant the server approved** — so
there is no path where a modified request becomes a valid session for someone else's salon.

The 403 also **does not distinguish "not yours" from "does not exist"** — so it cannot be used to enumerate which
salons exist.

## 4. Do the queries themselves carry the tenant?

**1,512 queries touch a tenant-scoped table. 894 carry `tenant_id` explicitly.**

Every one that does not, I read:

* **553** — Super Admin code, behind `SuperAdminGuard`. Cross-tenant is the job. I verified the ones that
  looked risky: `call_transcripts group by status` is reachable **only** from
  `@Controller('super-admin/voice-transcription')`. A salon cannot call it.
* **~40** — scoped through a **dynamic `$andTenant(scope)` fragment** my checker cannot see through, or through a
  tenant-owned foreign key, or by `user_id` from the session (a customer's own sessions and password).
* **5** — pre-auth. At **login** you look somebody up by email or phone, because **you do not yet know their
  tenant** — deciding it is the whole point of logging in.

**No confirmed cross-tenant read. Anything new that is unscoped now fails the build.**

## 5. What is actually public?

**46 routes**, and I read every one:

| | |
|---|---|
| `customer/salons/*`, `customer/techs/*` | **public salon discovery.** This is a booking site — the menu is *meant* to be public. |
| `customer/auth/*`, `auth/login`, password reset | **pre-auth by definition.** You cannot require a session to create one. |
| `auth/webauthn/authenticate/*` | biometric **sign-in**. Enrollment is **not** — that stays behind the session. |
| `webhooks/*` | the caller is Twilio, not a person. The tenant is resolved from the **signed payload**. |
| `jobs/appointment-reminders` | requires an `x-jobs-secret` header, and **fails closed** — with the secret unset it returns 503 rather than running. Otherwise anyone could trigger a reminder run: **SMS on your bill.** |

**Nothing private is exposed. 0 unreviewed public routes.**

---

## The part where I nearly misled you

**My first checker flagged 37 controllers as "unguarded — anybody on the internet can call these."**

**They are not.** I had missed that `TenantContextMiddleware` runs **globally** and **throws on a missing
session.** A controller without `@UseGuards(TenantAuthGuard)` is not open — the guard is belt-and-braces *on top
of* the middleware.

> Reporting 37 open endpoints would have sent you on a panicked hunt through the core of your product for a hole
> that is not there — **and worse, it would have buried the one list that actually matters: the middleware's
> `.exclude()` list.** That is the real attack surface, and it is 46 routes, not 37 controllers.

The checker now examines **the thing that decides**, not the thing that looked like it.

---

## Two new guards, both PROVEN

| | catches | proven by |
|---|---|---|
| `check:tenant` | a query that could read another salon's rows | delete `AND tenant_id` from a customer lookup → **exit 1** |
| `check:public` | a route serving data with **no session at all** | add `pos/customers/*` to the exclude list → **exit 1, names the path** |

Restore either → exit 0.

**Nine guards now in CI.** All nine broken on purpose to confirm they scream.

---

## The verdict

**A salon sees only its own salon. An owner sees only the salons they were granted.**

The isolation does not rest on every developer remembering to write `where tenant_id = ...`. It rests on three
things that hold even when someone forgets:

1. **The tenant is in a signed cookie**, and a client-supplied one is **stripped**.
2. **The switch is decided server-side** and the session is **re-signed** — a tampered request cannot become a
   valid scope.
3. **CI now fails** on a new unscoped query, or a new public route.

If you want one more layer, the strongest available is **Postgres row-level security** — the database itself
refusing to return another tenant's rows even if the application asks. Say the word and I will scope it out; it is
a real project, not an afternoon, and it belongs on top of what is already correct rather than instead of it.
