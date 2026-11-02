# Duplicate Review (POS) — Nov 2 2026

Guides: *Duplicate Review* FULL and COMPLETE (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile/duplicates` (unchanged).

## Audit findings (before the build)

| Finding | Status before | What was wrong |
|---|---|---|
| The screenshot's "Strong / Similar name" on two "test" profiles | **Broken** | `ai-customer-profile.service` built a set of the **non-empty** phones only. One profile with a phone plus one without gave a set of size 1, so the code decided "same phone" → Strong. Two records with no shared contact at all were labelled Strong. |
| Duplicate detection | Partial, did not scale | `detectDuplicates` loaded the **whole directory into memory** on every page view. |
| Group ids | **Broken** | Groups had positional ids (`dup_1`, `dup_2` …). The merge recomputed the groups, so a preview of `dup_1` could merge a different group if the directory changed in between. |
| Merge | Solid core, no guard | One transaction (loyalty through the ledger, merge logs, `customer.merged` outbox event), but no idempotency and no check that the data was unchanged since the preview. |
| Keep Separate / Not Sure | Verified | `customer_duplicate_decisions` (migration 487). Reused, not replaced. |
| Freshness | Missing | The "Live – updated 9:59 AM" was the page-load time, not real data freshness. |
| Search, dates, pages, history, health check | Missing | — |

## What was built

- **Detection scan.** Set-based SQL, never a whole-directory load.
  - **Keys:** groups profiles by stored phone, trimmed lower-case email, or Vietnamese-folded full name.
  - **One group per distinct set of profiles.** Each group has a stable id, and groups are never chained together.
  - **Oversized keys:** a value shared by more than 20 profiles (such as the salon's own number) is counted, not grouped.
  - **Records:** each run is stored in `customer_duplicate_scans`, which is the real freshness shown on screen.
  - **Rate limit:** at most one scan per salon per 60 s. The screen scans once on open when the data is stale or has never been scanned.
- **Confidence rule `dr-2026-11-02`.**
  - **Per-field evidence:** each field is recorded as `match`, `partial`, `conflict` or `missing`. A blank value is "not provided", never a match.
  - **Exact** needs the same phone, email and name on every profile.
  - **Strong** needs the same phone or email, plus the same name, with no conflicting contact.
  - **Everything else is Possible,** including a name-only match and a shared family phone with different names.
  - **Old endpoint fixed too:** the older `/pos/ai-customer-profile/duplicates` uses the same rule now.
- **Review states:** `pending`, `in_review`, `deferred` (Review later), `kept_separate`, `merged`, `failed`, and `resolved` (no longer detected; its history is kept).
  - **Keep Separate** needs a reason, and identical evidence never re-flags the group.
  - **Materially new evidence** reopens a Keep Separate group. This happens visibly, as a `reopened` event, never silently.
- **Append-only timeline.** `customer_duplicate_events`; a trigger refuses UPDATE and DELETE.
- **Queue:**
  - Search by name (with or without accents), phone in any format, email, customer id, group id, appointment id or ticket id.
  - Filters for status, confidence and matched-on field.
  - Date field (detected, updated, reviewed, merged, customer created) with the presets Today, Yesterday, This week, Last 7, This month, Last 30, Last month, This year and Custom (From/To month calendar).
  - Dates use salon-local days: inclusive start, exclusive next-day end.
  - Pages of 10/25/50/100, newest detected first, with a stable tie-break. A "new candidates" banner appears instead of moving the reviewer off their page.
- **Side-by-side comparison** of every member, drawn from each system of record:
  - **Identity:** phone (verified or not), email, branch, created and updated dates.
  - **Visits and bookings:** visits, last visit, upcoming appointments, cancellations and no-shows, open tickets.
  - **Staff:** last and preferred technician.
  - **Value:** loyalty points, active memberships, gift cards with a balance, saved-card **reference** count.
  - **Consent and tags:** marketing consent per channel, and tags.
  - **Evidence and history:** the per-field evidence and the group's review history.
  - **Privacy:** every open is audited, fail-closed. Contact details are masked unless the user has `pos.customers.export`.
- **"Merge into this"** keeps its label, but now it only proposes that profile as the one to keep. Nothing is sent until **Preview merge**.
- **Preview** is read-only and recorded. It shows:
  - How many rows move, per table.
  - **Blockers**: group closed, a profile already archived, out of the user's branches, an open ticket on the source, the customer in the salon today, or active memberships on more than one profile.
  - **Acknowledgements**: name only, contact conflict, consent differs, points on both profiles, future appointments move, gift cards move, membership moves, saved cards move.
  - A state hash and a 10-minute expiry.
- **Confirm** needs `pos.customers.merge`, the preview hash, a request key and every acknowledgement.
  - Inside one transaction under a group lock, it recomputes the preview. Any change (a new booking, an edited profile, another reviewer's merge) is refused as stale.
  - It then runs the **canonical merge** (`customers/customer-merge.ts`, extracted unchanged from the original route) and records the operation, group state, event and audit, all committed together.
  - **A repeated request key** returns the first answer and applies nothing twice.
  - **A failed attempt** changes nothing and is recorded as `failed`.
- **Health check:** 12 read-only checks. Each is Passed, Warning, Failed or Not enough data, with a next step.
  - The checks cover scan freshness and failures, the confidence rule, **legacy over-labelling (the screenshot diagnosis)**, normalizers, indexes, archived members in open groups, tenant isolation, merge integrity, failed merges, loyalty-ledger agreement after merges, and over-shared keys.
  - Rate-limited to one run per 30 s.

## Permissions

| Action | Permission |
|---|---|
| View the queue, comparison, history, preview; run a scan or the check | `pos.customers.view` |
| In review, Review later, reopen, notes | `pos.customers.edit` |
| Keep Separate (it ends the review), confirm a merge | `pos.customers.merge` |
| Full phone / email | `pos.customers.export` |

## API (`/pos/duplicate-review`)

`GET summary` · `GET groups` · `POST scan` · `GET groups/:id` · `POST groups/:id/decision` · `POST groups/:id/notes` ·
`POST groups/:id/preview` · `POST groups/:id/merge` · `GET history` · `POST check`

**Retired routes** (no caller left; the tests pin them as retired):
- `GET /pos/ai-customer-profile/duplicates/:groupId/preview` — the positional-group preview. The service method stays for the AI tool.
- `POST /pos/customers/duplicates/:id/decision` — replaced by `POST groups/:id/decision`, which writes the same decision pairs.

## Database (migration 761, additive)

**Tables:** `customer_duplicate_scans`, `customer_duplicate_groups`, `customer_duplicate_events` (append-only), `customer_duplicate_merge_ops`, `customer_duplicate_health_runs`.

**Constraints:**
- The idempotency key is unique per salon.
- At most one completed merge per group (partial unique index).

**Indexes on `customers`:** `ix_customers_tenant_email_norm`, `ix_customers_tenant_name_fold`.

**Rollback:** drop the five tables and two indexes. No customer row is rewritten by the migration.

## Proof

- **pgtest: 22/22.** Three deliberate breaks prove the tests guard what they claim:
  - removing the preview-hash check fails 2;
  - counting a blank as a match fails 2;
  - removing the tenant filter from detection fails 6.
- **Real Postgres 16, 2/2:**
  - two reviewers confirm the same merge at once: exactly one merge, points moved once;
  - two simultaneous scans produce one set of groups.
- **The existing merge tests still pass on real Postgres** (`customer-merge.postgres`, 2/2).
- **POS screen tests: 9/9.**
- **Old AI profile endpoint: 39/39.** It has new tests for the blank-phone fix.
- **Checks:** typecheck, all builds and `check:boot` (DI_GRAPH_OK) are green.
- **`ci:gates`:** only the five gates that were already failing still fail, with lint, opaque-body and mirrored-type counts unchanged.
- **Customers module: 400 tests pass.** Its five failures are on the merge report's list of failures that were already there.

## Open

- **Background scan.** Detection runs on demand: Scan now, plus once on open when the data is stale. A nightly worker could be added later.
- **Assigning a reviewer.** The API accepts an assignee and a due date. The screen sets only the due date.
- **Rows that move to the kept profile.** Saved-card references and gift-card ownership move, as they did before. Kevin may want the preview to *block* instead (see the decisions list in `CONTINUE_HERE.md`).
- **Vietnamese strings** await native review: `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`.
