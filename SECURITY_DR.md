# SECURITY_DR.md — Disaster recovery (Constitution 12 §225–240)

Written September 22, 2026 against this tree. Where the answer depends on your Railway plan or settings, it says so.

## What is — and is not — in a database backup
| Data | In the Postgres backup? | Recovery |
|---|---|---|
| All business data (salons, customers, tickets, payments, bookings, audit and security logs) | **Yes** | Restore the backup |
| Encrypted credentials (payment processor, Twilio, bank, MFA, webhook, ticket-removal) | **Yes — but only as ciphertext** | Useless without the **encryption keys** (next section) |
| Uploaded photos (technician avatars, portfolios, showcase) | **No** | Only safe if `MEDIA_STORE=s3` (then your bucket's own versioning/backup) — on container disk they are already lost at every deploy (O1) |
| Redis (cache, rate-limit counters, realtime sequence numbers) | **No** | Rebuilt automatically; nothing to restore |
| Secrets and encryption keys (Railway variables) | **No** | Must be kept separately — see below |

## THE KEYS ARE PART OF THE BACKUP
Since Phase 7, credentials are encrypted under seven purpose keys (`MFA_ENC_KEY`, `PAYMENT_ENC_KEY`,
`PROVIDER_VAULT_KEK`, `FUNDING_VAULT_KEK`, `WEBHOOK_SIGNING_KEK`, `AI_PROVIDER_KEK`, `TICKET_DELETION_ENC_KEY`).
**A backup restored without the matching keys restores "successfully" and every encrypted credential in it is
unreadable** — every salon would have to re-enter its payment and Twilio credentials.
- Store a copy of every key **outside Railway** — a password manager or a sealed offline record — updated whenever a key
  is rotated. If the Railway project were lost, the backup alone would not bring the credentials back.
- When rotating, keep the old value as `<KEY>_PREVIOUS` until every backup taken under it has aged out, or those
  backups cannot be decrypted with the new key alone.

## Recovery objectives (targets, not measured)
- **RPO (data you can afford to lose):** equal to Railway's backup interval for your plan — daily by default; point-in-time
  recovery only if your plan provides it (the backup report records `pitrEnabled`).
- **RTO (time to restore service):** target 2 hours — restore the backup, redeploy the API with the same variables, run
  `restore-verify`. Unmeasured until the first drill.

## Restore drill — quarterly (§231)
1. Restore the latest backup into a **scratch** Postgres (a separate Railway database, never production).
2. With **the production encryption keys** in the environment and `DATABASE_URL` pointing at the scratch database:
   `npx tsx apps/api/scripts/restore-verify.ts` (add `BACKUP_REPORT_URL` + `BACKUP_REPORT_TOKEN` to report it).
3. It checks the schema is complete, the core tables hold data, and **one sample of every encrypted column decrypts
   with those keys**. It is read-only and never prints a decrypted value. Exit 0 = the backup is usable.
4. The report lands in `/internal/backups/report`; the Security Center and the Constitution 11 `backups` health signal
   show it. No drill in 90 days → the backups component degrades.
5. Delete the scratch database.

## Disaster scenarios
- **Database corrupted / deleted:** restore the latest backup into a new database, point `DATABASE_URL` at it, redeploy.
- **Railway project lost:** new project, restore the backup, re-enter every variable **from your off-Railway record**
  (keys especially — see above), redeploy, repoint DNS.
- **An encryption key lost:** the data it protects cannot be recovered. Set a new key, and have each affected salon
  re-enter those credentials. This is why the off-Railway copy matters.
- **A key or secret leaked:** rotate it (`SECURITY_SECRETS.md`), keep the old value as `_PREVIOUS` long enough to
  re-encrypt, then remove it.
