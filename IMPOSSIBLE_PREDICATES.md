# IMPOSSIBLE PREDICATES — SQL that runs, and can never be true

The POS "Service Done" badge counted:

```sql
select count(*) from ticket_service_lines where status = 'sent_to_service_done'
```

Valid SQL. Real table. Real column. **`check:sql` passes it.** And it could **never match a row** — that literal is
stored nowhere. The badge read **0 forever**, and a `.catch(() => 0)` made it silent.

> **"The query runs" and "the query can be true" are different claims, and only the second one is worth anything.**

I only ever checked that in one file. So I built a checker and pointed it at the whole codebase.

`npm run check:impossible` — compares every SQL literal against its column's **CHECK constraint**. 346 constrained
columns, 390 comparisons.

---

## It found 3 real bugs, and they are WRITES THAT THROW — not dead reads

### 1. Push notification delivery has NEVER been logged

```ts
push.kysely.repository.logDelivery()
  .insertInto('notification_delivery_logs').values({ channel: 'push', ... })
  .catch(() => { /* logging is best-effort */ });
```

`notification_delivery_logs.channel` had `CHECK (channel IN ('sms','email'))`.

**The insert violated the constraint and threw — and the `.catch()` swallowed it in silence.**

Every push metric on the Communications screen reads **0, forever** — and reads exactly like *"we sent no push
notifications"* rather than *"we never recorded any."*

### 2 & 3. Pausing a subscription, and scheduling a cancellation, were BOTH broken

```sql
UPDATE tenant_subscriptions SET status='paused' ...                -- billing:214
UPDATE tenant_subscriptions SET status='pending_cancellation' ...  -- billing:266
```

`tenant_subscriptions.status` had `CHECK (status IN ('active','trialing','past_due','expired','cancelled'))`.

**Neither value was allowed. Both writes threw.** Inside a transaction, so the whole operation rolled back.

**Two billing operations a Super Admin would reasonably believe worked.**

### 4. The "Suppressed" deliverability figure is permanently 0

The Communications overview counts `status IN ('suppressed','blocked')` — neither was ever an allowed value. A salon
looking at their SMS deliverability saw **"0 suppressed"**, which reads as *"nothing is being blocked"* rather than
*"we do not track that."*

### 5. A Super Admin alert that never fires

```sql
select id, tenant_id from hardware_packages where status = 'pending'
```

The real value is **`pending_approval`**. So the *"Hardware shipment pending"* alert **could never fire.**

**An alert that never fires is worse than no alert, because it reassures.** Same class as the payment-gateway alert
fixed earlier today.

---

## The fixes

**The code was right in every case except the alert.** It implements features the platform genuinely has — push
notifications, subscription pause, scheduled cancellation. **The schema was behind.**

* **Migration 375** widens three CHECK constraints to permit the values the code actually writes.
* **`hardware_packages`**: `'pending'` → `'pending_approval'` in the alert and the overview — a **code** bug, fixed
  in code.

---

## Two corrections to the checker, both of which mattered

**58 → 19 → 7 → 0.** The reductions were not tuning; they were the checker being wrong.

1. **A defensive `IN` list is not a bug.** `IN ('failed','error','undelivered')` where only `failed` exists **works
   perfectly** — the filter matches the rows it means to. Flagging those buried the real ones. The rule is: an `IN`
   list is dead only if **NO** value can occur.

2. **It ignored table aliases.** It flagged `c.status = 'configured'` as impossible because the query's `FROM` was
   `tenants` — when `c` was `tenant_messaging_credentials`, where `'configured'` is perfectly valid. **A checker
   crying wolf on correct code is how the real findings get ignored along with it.**

Then it reads `ALTER TABLE ... ADD CONSTRAINT` too — because a CHECK is not only declared at `CREATE TABLE`, and a
checker that only read the original definitions would keep flagging code the schema now permits.

## And it is PROVEN, not assumed

Reintroduce the dead hardware alert → **exit 1, names the column.** Restore → passes.

**Now in CI**, alongside `check:sql` and `check:di`.

---

## Verification

| | |
|---|---|
| `check:impossible` | **0** |
| `check:sql` (1,767 statements) | **0** |
| `check:di` | **0 dead injects** |
| `tsc --noEmit` | **0** |
| super-admin-alerts · billing · overview · communications · push | **84 / 84** |
