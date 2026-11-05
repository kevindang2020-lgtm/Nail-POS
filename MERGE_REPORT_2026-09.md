# MERGE REPORT — the developer's tree (Power-Salon-main.zip) merged into the modularised repo

Final report, Sep 30 2026 (history rewritten the same day to remove the malware — §10). Supersedes the working log `MERGE_STATUS_2026-09.md` (kept for the hunk-by-hunk record).

**Result: merged, repaired and fully green.** Every test suite, gate and database check passes. Two actions remain, and both
are on the developer's side (see §1).

---

## 1. Security incident — hidden malware in the upload

**What it was.** The developer's `eslint.config.mjs` hid about 32 KB of obfuscated JavaScript after thousands of tab
characters on its last line (it begins `global.i = '…'`). This is known malware aimed at developers. It runs every time
ESLint loads the config — on `npm run lint`, in an editor with an ESLint plugin, or in CI. It was found because it carried
a GitHub token, which the `check:secrets` gate flagged.

**It executed here.** When the lint gate ran on the staged merge (Sep 29, ~10:30 UTC), a hidden `~/.node_modules` folder
appeared containing `axios` and `socket.io-client` — the second stage fetching its tools.

**Response in this environment.**
- Payload removed; the clean config from `790b1c4` restored.
- The second-stage folder deleted.
- All 938 dependencies reinstalled from the registry with lockfile integrity checks and no install scripts
  (`npm ci --ignore-scripts`).
- The whole upload, the staged merge (1,096 files) and `node_modules` scanned for any other copy — none found.
- Lint re-run afterwards does not recreate the folder; checked again at the start of every turn since, including today.

**Not malicious, but noted.** Their root `test_api.js` called an external test server of theirs by IP (removed Oct 6 2026).

**Still to do — developer side (cannot be done from here):**
1. Treat the developer's computer and GitHub account as **compromised**. Wipe or rebuild the machine; rotate every
   credential it held (GitHub, npm, cloud, database, Twilio, payment keys) from a clean device; review GitHub for unknown
   SSH keys, tokens, OAuth apps and pushes.
2. Anyone else who ran `npm` or ESLint on their tree does the same.
3. Anyone who turned on Face ID in their test builds turns it off and changes their password — those builds stored the
   password itself on the device (§2).

---

## 2. Security holes found in the developer's code — all fixed

| # | Area | What their code did | Now | Commit |
|---|---|---|---|---|
| 1 | Commission authorization codes | 4-digit `Math.random` codes, stored in plain text; a `'*'` code valid at every salon; no permission, step-up or audit; the oversight screen listed live codes | 10-character random codes, only a SHA-256 hash stored, one salon, single use (atomic), tenants.edit + step-up + reason + audit; new real-database test, mutation-checked | `7e3f182` |
| 2 | Face ID (all 4 login screens, 3 settings screens) | Saved the user's **password** (and the owner access code) to sessionStorage and then the device keychain; ignored the server's "Face ID disabled" flag; a failed face match treated as a cancel | Back to the revocable session-token design (their `disableFaceId` kept, `canEnrollFaceId` added); exact plugin codes for cancel vs failure | `7b915f3` |
| 3 | Owner access code | Stored in localStorage; required for every owner | Optional (the server decides), never stored on the device | `7b915f3` |
| 4 | Booking phone verification | The code `123456` verified **any** phone; a failed text-message send reported as "code sent", with the phone number logged | Both removed; two tests pin it | `6847e68` |
| 5 | Multi-salon booking | The salon ID the app sent was trusted unchecked, so a booking could be written into a salon of another business | Must be an active branch of the same business; the "accepts bookings" check runs on the booked branch | `6847e68` |
| 6 | `/auth/select-branch` | Excluded from the session check, so a revoked session could still pick a branch | Session check restored | `7e3f182` |
| 7 | File uploads | Customer/owner/staff avatars, skill documents, and nail-showcase photos **and video** on the public store were typed by the browser's claim | The file's bytes decide (image signatures; MP4/MOV `ftyp`; WebM `EBML`); random key suffixes | `7e3f182`, `9df5fa0` |
| 8 | POS lock screen | PIN `1234` unlocked any user who had no PIN; unlimited guesses | Removed; guesses rate-limited per user; the app sends those users to full sign-in | `7e3f182` |
| 9 | Secrets in server logs | Customer activation code + phone printed when a text failed (and still reported as sent); a new admin's temporary password + email logged | Removed; a permanent guard test fails the build if either comes back (mutation-verified) | `0f51392`, `39c55a7` |
| 10 | Branch switching | Every switch reset the user's permissions to the role's defaults, silently undoing restrictions the owner had set | Recomputed only when the branch assigns a different role; two tests | `fc71303` |
| 11 | Salon onboarding | A paused or returned application could jump to any stage — past document review straight to final review | Resumes exactly where it stopped; their "reopen a rejected application" kept but restarts from the first stage with a reason | `0b785cf` |
| 12 | AI endpoints | Honoured an `x-tenant-id` header from the client | Business taken from the session only | `7e3f182` |
| 13 | Unscoped queries | A gift-card transaction query and several AI builder statements not limited to one business | Scoped | `7e3f182` |

## 3. Fake data removed

| Screen | What it showed | Now | Commit |
|---|---|---|---|
| Devices dashboard | A fixed 98% health, 1,420 API calls, random 95–99% sync | Real values, or "not connected" | `7e3f182` |
| Integration health | Hard-coded figures | Real values or empty | `7e3f182` |
| POS Account | The same sample account for **every** salon — "Sophia Nguyen", "Luxe Nails", a VISA ending 4242, three San Francisco branches, 12 of 20 users, fake backups; a "Run Backup Now" button that did nothing | Built from the salon's real records, blank where there is no source; the fake button removed; "Export Account Data" → "View Activity Logs" | `4536bf0` |
| Owner notifications | A hard-coded demo list | The owner's real alerts | `3614c96` |

## 4. Honesty and features restored on their redesigned screens

- **Find Salons** (`15d3e63`): the location-permission prompt is back (their version searched 30 miles around you as soon as
  the screen opened); "Book Now" only where this account can actually book; Google attribution, the not-configured message
  and the Call button restored.
- **Booking screen** (`04bec6d`, `e2c9c72`, `d18f4d9`): the salon picker offers only bookable salons; a technician's rating
  is shown only with its review count; "View profile" restored.
- **POS** (`7dc55f5`, `d346f33`, `0101c1c`): a dead "Generate detailed summary" button re-wired; promotion form labels
  re-attached to their inputs (screen readers); a print control that did nothing removed; browser pop-up dialogs →
  inline; money typed with floating-point parsing → the exact shared parser.
- **Super Admin** (`07b1e2c`, `f32d49d`, `e26c904`, `e8ac10f`): sidebar entries for AI Platform and System Operations
  restored; a colour-only payment-gateway status given text; three regressions in SMS packages billing fixed.
- **Retail** (`fc71303`): retail sales always failed on a real database (a typo in the stock lookup made every product "not
  sellable", and the error was hidden). Fixed.
- **Team list** (`fc71303`): a technician who works at several salons no longer appears twice, or with another salon's photo.
- **Their product changes kept as designed:** multi-register cash drawers; loyalty on skip-line checkout; queue, serving and
  clock-in cascades (now inside transactions, with domain events); multi-service booking and add-ons; staff avatars (cap set
  to 10 MB, matching portfolio photos); Face ID in the Owner and Technician apps; the new layouts; skill requests; manager
  messages; the compensation overview listing every salon (unconfigured ones read all zeros).

## 5. Database changes

| Migration | Contents |
|---|---|
| 472–478 | Their migrations 432–437, renumbered after ours |
| 479 | Commission security tables (were applied by an ad-hoc script, not a migration) |
| 480 | Booking start source, queue statuses, default commission (ad-hoc scripts, folded in) |
| 481 | `technician_manager_messages` — their code wrote to this table but nothing created it |

On real Postgres 16: all 481 apply to a fresh database and as an upgrade from 471; a second run changes nothing; the
generated database types match the schema (649 tables).

## 6. Test repairs

Their tree arrived with **94 failing app tests** (POS 22, Super Admin 41, customer 24, owner 7) — the same failures run on
their upload as-is: screens redesigned without updating tests. All 94 now pass. Each test was updated to the new screen
without weakening what it checks; where a failure was a real bug, the bug was fixed instead (listed in §2–§4).

Later module runs found three more failures (two onboarding, one compensation) — fixed in `0b785cf`.

## 7. Final verification (Sep 29–30, on the final commit `0b785cf`)

| Check | Result |
|---|---|
| API, 6 shards | 268 / 311 / 213 / 283 (+14 skipped) / 276 (+2 skipped) / 236 = **1,587 pass**, 16 skipped by design |
| Apps | POS 759 · Super Admin 855 · Owner 262 · Customer 221 · Technician 108 · Manager Pay 57 · Customer Display 43 — **all pass** |
| Modules | ai 1405 · analytics 237 · audit 21 · booking 433 · catalog 26 · communications 290 · customers 176 · deals 112 · gift-cards 21 · identity 360 · loyalty 4 · memberships 107 · payments 185 · platform 66 · queue 290 · reports 11 · safety 295 · security-center 14 · super-admin 714 + 689 (4 skipped) · support 14 · tenants 69 · workforce 406 — **all pass** (appointments, inventory and checkout have no module suites; the API battery covers them) |
| Gates | 25 gates + 3 audits **pass** (the third, hidden code, added in §10) |
| CI security lane | **22 passed, 0 failed**, 4 not verifiable in this environment |
| Real Postgres 16 | 481 migrations fresh ✔ · re-run no-op ✔ · types match (649 tables) ✔ |
| Malware re-check | No second-stage folder ✔ |

## 8. Other things worth knowing

- **Two sessions worked on this at once** on Sep 29. The other session's commits (`3614c96`, `1dea9dd`, `f32d49d`,
  `e26c904`) were reviewed and are correct. Edits made between 11:47 and 12:11 UTC outside either session's turns were
  reviewed line by line after the incident and are benign. Run one session at a time from here.
- **Lint baseline reset once**, documented: 124 unused variables and 84 hook-dependency warnings remain in their screens.
  Not failures; worth a cleanup pass.
- **Commit chain** (29 commits): `eba3e0c` (their tree as uploaded) → `3638b72` → `7e3f182` (merge) → `a71a6da` →
  `7b915f3` → `3614c96` → `1dea9dd` → `a166a5d` → `4ee23b4` → `7dc55f5` → `d346f33` → `0101c1c` → `4536bf0` → `69fea4e` →
  `2d8bfeb` → `07b1e2c` → `f32d49d` → `e26c904` → `e8ac10f` → `9df5fa0` → `6847e68` → `15d3e63` → `04bec6d` → `e2c9c72` →
  `d18f4d9` → `0f51392` → `39c55a7` → `fc71303` → `0b785cf` → this report.

## 9. Advice for future developer handoffs

1. Never run `npm install`, `npm run`, ESLint or an editor on a received tree before scanning it. Scan config files
   (`*.config.*`, `.eslintrc*`, `package.json` scripts) for very long lines and obfuscated code first.
2. Require migrations for every schema change — no ad-hoc scripts (three had to be folded in here, and one table had none).
3. Require the test suites to pass before delivery; 94 failures hid real bugs.
4. Never accept test codes (`123456`, `1234`, `'*'`) or sample data in delivered code.

## 10. The payload was removed from the repository's history (Sep 30 2026)

**Finding.** The commit that records the developer's tree exactly as uploaded (§8, the first in the chain) still contained
the malicious `eslint.config.mjs`, and it is an ancestor of `master` through the merge. Working on `master` was always
safe — its config is clean — but checking out that commit, or the `developer-2026-09` branch, and then running lint or
opening it in an editor would have run the malware. **The repository bundle delivered on Sep 29 contains it.**

**What was done.**
- In the two developer-side commits the malicious file was replaced by our clean config. Their version differed from ours
  only by the hidden payload and a `createRequire` import that existed solely so the payload could call `require()`;
  nothing else uses it.
- The 30 commits from their upload onward were rewritten with only that change, and commit-message references to one
  another were re-pointed to the new hashes. Proof that nothing else changed: 28 of the 30 trees are byte-identical to
  the originals, and the final tree is identical to the pre-rewrite tip; the other two differ only in
  `eslint.config.mjs`. Authors and dates are unchanged.
- Backup refs and reflogs deleted and the object store garbage-collected: the malicious file no longer exists anywhere in
  the repository. The developer worktree was reset to the clean commit and its `node_modules` (installed from their tree)
  deleted.
- New bundle built, cloned fresh and scanned: no copy of the payload in any commit, and no config line longer than 500
  characters.

**New permanent check.** The secret scan caught this only because the payload happened to carry a GitHub token.
`tooling/security/check-hidden-code.py` now runs with the gates and fails on the disguise itself: code hidden after
200+ whitespace characters (legitimate alignment here peaks at 78), lines over 1,000 characters in files tools run
automatically (`*.config.*`, `.eslintrc*`, `package.json`, git hooks), any npm install script, and this malware's marker.
The real malicious file trips three of those rules independently; a planted hidden-code file fails the gate runner.

**Your action.** Delete any copy of the Sep 29 `AIPowerSalon-repo.bundle` and any clone made from it; replace it with the
new one. If a clone from it was ever switched to `developer-2026-09` (or to the upload commit) and lint was run or the
folder opened in an editor with ESLint, treat that computer like the developer's (§1). The handoff zips were scanned and
are clean.

**Old → new commit hashes** (everything before the merge is unchanged, e.g. `790b1c4`, `1c483a7`):

| Old | New |
|---|---|
| `1027815` | `eba3e0c` |
| `6f0acfd` | `3638b72` |
| `8ac092b` | `7e3f182` |
| `46136ee` | `a71a6da` |
| `9a5f374` | `7b915f3` |
| `6ee7c6d` | `3614c96` |
| `eb563d3` | `1dea9dd` |
| `2804622` | `a166a5d` |
| `d025f5b` | `4ee23b4` |
| `91938ae` | `7dc55f5` |
| `27790f0` | `d346f33` |
| `5d7282b` | `0101c1c` |
| `ef6c82a` | `4536bf0` |
| `1c3ec1e` | `69fea4e` |
| `8c4a2fa` | `2d8bfeb` |
| `d29732a` | `07b1e2c` |
| `908fcac` | `f32d49d` |
| `57dcfd9` | `e26c904` |
| `f92fbf3` | `e8ac10f` |
| `7149c5a` | `9df5fa0` |
| `313b3e8` | `6847e68` |
| `f6e7ca5` | `15d3e63` |
| `ddb0080` | `04bec6d` |
| `2d010e7` | `e2c9c72` |
| `5e49a1f` | `d18f4d9` |
| `0bfa89e` | `0f51392` |
| `368a0bb` | `39c55a7` |
| `12eecf0` | `fc71303` |
| `c79e297` | `0b785cf` |
| `91d3fee` | `b31d3c8` |
