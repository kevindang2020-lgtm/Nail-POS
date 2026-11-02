# Lower-environment data handling (Security Deep Scan §157)

**Rule.** Production personal data and production secrets never reach a development, test, CI, staging or demo
environment, a laptop, a ticket, a chat or a screenshot. A lower environment runs on **seed data**
(`npm run db:seed`, the pilot / proof scripts' generated salons) or on an **anonymised copy** made exactly as below.
Nothing else.

## What counts

| Class (`apps/api/db/ownership/registry.generated.json` → `sensitivity`) | In a lower environment |
|---|---|
| `PAYMENT_RESTRICTED` (payments, cards, payouts, funding) | card data is never stored (`card-data.pgtest`); amounts, statuses and last-4 may stay |
| `HIGHLY_SENSITIVE` / `CONFIDENTIAL` (customers, staff, messages, notes, receipts, AI transcripts) | pseudonymised or blanked by the anonymiser |
| `SECURITY_SECRET` (credential columns, sessions, tokens, provider secrets) | nulled / emptied by the anonymiser; lower environments have their own keys |
| `INTERNAL` / `PUBLIC` (catalogue, settings, plans) | may stay |

## Making an anonymised copy (the only allowed path)

1. Restore the production backup into a **new, isolated** database whose name says it is a copy
   (e.g. `aipowersalon_copy_20261027`), on a host the lower environment can reach — never by pointing anything at
   production. Nobody's application connects to it yet.
2. Run, as that database's owner (triggers are switched off for the rewrite, which needs the owner):

   ```
   node apps/api/scripts/anonymize-dump.mjs --database-url=postgres://owner@host:5432/aipowersalon_copy_20261027 \
     --confirm-copy=aipowersalon_copy_20261027 --out=aipowersalon-anon-20261027.dump
   ```

   It refuses `NODE_ENV=production`, a database whose name is not exactly `--confirm-copy`, a name that does not look like
   a copy, and a database other sessions are connected to. It then:
   - **empties** sessions, refresh tokens, auth events, login attempts, one-time links (not-me, device approval, password
     reset), device credentials (Face ID, passkeys, push tokens), recovery codes and OTPs;
   - **rewrites, by column name, in every table**: e-mail → `u<md5>@example.invalid`, phone → `+1555…`, person names →
     `Person <md5>`, addresses → `Redacted`, date of birth / IP / user agent → NULL, notes / messages / transcripts / prompts /
     review text → `redacted`, every `*_enc` / `*_ciphertext` / `*_hash` / `*token*` / `*secret*` / `*password*` column →
     NULL. Pseudonyms are deterministic (joins by e-mail / phone survive) and keys, money and state are never touched;
   - **samples** every rewritten table and fails if an e-mail or phone shape survived (extend
     `apps/api/scripts/lib/anonymize.mjs` and re-run);
   - writes the dump (`pg_dump --no-owner --no-privileges`).
3. Drop the copy database. Only the anonymised dump moves to the lower environment.
4. In the lower environment: every account's password and PIN are gone — sign in with the seeded Super Admin, reset
   passwords through the normal flow; provider credentials are re-entered with **sandbox** keys only.

Rules are tested on the real schema: `apps/api/src/common/anonymize-dump.pgtest.vitest.spec.ts`.

## Never

- `pg_dump` of production to a laptop or CI artifact; a production URL in a lower environment's variables.
- Copying a production row into a test fixture, a bug report, or a chat. Describe it, or reproduce with seed data.
- Using production Twilio / SendGrid / processor / AI keys outside production (`SECURITY_SECRETS.md`).

Exceptions need Kevin's written approval, a ticket, and an expiry, and are listed here.

| Date | Who approved | What | Expires |
|---|---|---|---|
| — | — | (none) | — |
