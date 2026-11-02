# AIPowerSalon — new-chat handoff (Oct 22 2026)

Give this file and the code package to a new chat. This file is written for the next Claude (or developer) who continues from here.

## 1. What is in the package

Every file is under 20 MB so it can be uploaded to a cloud session. `<hash>` is the head commit of the cleaned (K-12 rewritten) history, branch `work/dual-screen-display`.

**Source: 4 parts, each a normal `.tar.gz` that unpacks on its own into the same folder.** None has `.git`, `node_modules` or build output.

| Part | Contents |
|---|---|
| `aipowersalon-<hash>-part1-core.tar.gz` | root files and docs, `packages/`, `tooling/`, `apps/api`, `apps/pos-web`, `apps/admin-web` |
| `aipowersalon-<hash>-part2-modules.tar.gz` | `modules/`, `apps/customer-display`, `apps/go-check-in-kiosk`, `apps/manager-pay-web`, `apps/booking-public` |
| `aipowersalon-<hash>-part3-apps.tar.gz` | `apps/customer-web`, `apps/owner-web`, `apps/tech-web` |
| `aipowersalon-<hash>-part4-assets.tar.gz` | `marketing/`, `brand/`, `final-run/` (proof screenshots) |

To restore the source:

```
mkdir aipowersalon && for f in aipowersalon-*-part*.tar.gz; do tar -xzf "$f" -C aipowersalon; done
```

**History (optional): the git bundle cut into pieces.** Join the pieces before using them.

```
cat aipowersalon-<hash>-history.bundle.0* > aipowersalon.bundle
git clone -b work/dual-screen-display aipowersalon.bundle aipowersalon-git
```

**Checks:** run `sha256sum -c aipowersalon-<hash>-SHA256SUMS.txt`. It lists every part and every piece, plus the joined bundle.

Use the bundle when you want the full history; it is recommended for continuing the work. Use the four parts when the files are enough.

## 2. Standing rules (Kevin's, keep them)

- **Never push to GitHub.** Commit locally only, as `git -c user.name=Claude -c user.email=noreply@anthropic.com`.
- **K-12 security steps are Kevin's, in this order:** rebuild the machine → rotate credentials → revoke the Firebase key → new Play upload keys → change the DB password and close port 5432 → only then push the rewritten history.
- **Secrets:** never paste a password or key into chat.
- **Casino content:** never associate AIPowerSalon with casino content.
- **Don't remove anything:** harden or deprecate instead.
- **Code bundles:** send one after every milestone, built on the rewritten history (`git format-patch` + `git am`, never fetch).
- **Working style:** Kevin writes tersely. "continue" means: do the next logical unit fully and on your own, then report honestly.

## 3. Read first (inside the repo)

1. `PROJECT_STATUS.md` — what is Complete, Partial or Blocked, with the last verified run.
2. `BUG_REGISTER.md` — every defect found and fixed (B-01 … B-65), plus open items.
3. `CHANGELOG_HANDOFF.md` — plain-language changes per milestone.
4. `docs/HOSTING_ACTIONS_FOR_KEVIN.md` — the account and hosting steps only Kevin can do.
5. The latest milestone reports:
   - `docs/PLATFORM_ANNOUNCEMENTS_FINAL_REPORT.md` (Oct 22)
   - `docs/PAYCHECK_FINAL_REPORT.md` (Oct 21)
   - `docs/RECEIPT_EXPENSE_FINAL_REPORT.md`

## 4. Stack and how to run

**Stack:** a NestJS + Kysely + PostgreSQL 16 monorepo.
- `apps/`: api, pos-web, admin-web, owner-web, tech-web, customer-web, customer-display, go-check-in-kiosk, …
- `modules/`: domain modules (communications, workforce, checkout, …)
- `packages/`: database, events, realtime-contracts, api-contracts, permissions, …

**Install and build:**
```
npm ci
node tooling/modules/build-modules.mjs             # packages + modules
(cd apps/api && npx tsc -p tsconfig.build.json)    # API
(cd apps/pos-web && npx vite build)                # each frontend the same way
```

**Database:** migrations are in `apps/api/db/migrations` (latest is `674_platform_pos_announcements.sql`).
- The pgtests run every migration on PGlite.
- For a local Postgres, apply the migrations, then the seeds (`seed.ts`, `seed-demo.ts`, `seed-local-accounts.ts`) to get the pilot salon `PILOT01`.

**Gates and tests:**
```
DATABASE_URL=postgres://... npm run -s ci:gates     # 51 gates + 16 audits, all green at the head
cd <module or app> && npx vitest run                # API: use --shard=k/3 to keep runs short
DATABASE_URL=... node tooling/e2e/pos-announcement-layout.mjs   # real-browser proof (51 checks)
```

When a gate complains, regenerate its record with the script it names. Examples: `audit-state-transitions.mjs --write-vocab`, `db-ownership.mjs --write`, `gen-actor-columns.mjs`, `role-matrix.mjs --write`, `openapi.mjs --manifest`, `audit-event-producers.mjs --write-catalog`, `generate-realtime-catalog.mjs`.

**Development note:** the outbox publisher is OFF in development unless `EVENT_PUBLISHER_ENABLED=on`.

## 5. Where the project stands

- **Complete (built, wired, tested):**
  - POS: queue, booking, checkout, payments on the fake processor, gift cards, refunds
  - Payroll and weekly paychecks
  - Expenses
  - Analytics
  - Super Admin control plane
  - Platform announcements on the POS top bar
  - Security and audit
  - The realtime and event architecture
- **Complete without providers** (they need Kevin's accounts): the AI platform (provider keys) and expense OCR / AI categories.
- **Partial:**
  - Inventory (B-19 override, K-01 add-ons)
  - Communications (providers; A2P for platform-managed salons and offboarding are not built)
  - Files / media (B-18; the ClamAV service)
  - Platform announcements show on the **POS only** (the `surfaces` column is ready for the Owner, Tech and Customer apps)
- **Blocked** (Kevin's steps):
  - Hosting (Railway, TLS, WAF, backups, Redis, OTLP)
  - Mobile store builds (upload keys, an iOS machine)
  - Tap to Pay (Apple entitlement, CommerceHub SDK)
  - Live providers (Twilio A2P, SendGrid, FCM / APNs)
  - K-12 security steps → push

## 6. Suggested next steps

1. Kevin: do the K-12 steps, then push the rewritten history.
2. Kevin: hosting (`docs/HOSTING_ACTIONS_FOR_KEVIN.md` A–F) and provider accounts.
3. Code: close the Partial items above (B-18, B-19, K-01; A2P on platform-managed salons, number offboarding; announcements on the other apps if wanted).
4. A staging pilot day with real providers, then the first real salon.

## 7. Prompt to start the new chat

> I'm Kevin, solo founder of AIPowerSalon (multi-tenant nail-salon POS SaaS). Attached: the full code (4 source parts, plus the git history in pieces) and `docs/NEW_CHAT_HANDOFF.md`. Restore the repo (join the bundle pieces and clone, or unpack the 4 parts into one folder), read NEW_CHAT_HANDOFF.md, PROJECT_STATUS.md and BUG_REGISTER.md, run the gates to confirm the baseline is green, then continue finishing the project. Follow the standing rules in the handoff (never push; local commits only; send a code bundle after every milestone; never paste secrets). "continue" means proceed on your own.
