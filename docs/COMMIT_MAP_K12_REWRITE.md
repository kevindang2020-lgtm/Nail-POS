# Commit ids before and after the K-12 history rewrite

The history of `work/dual-screen-display` was rewritten on Oct 22 2026 (K-12: the tracked Android keystores and the
external database login purged from every commit). Every commit from the first purged file onward received a new id.
The status reports written on Oct 20–21 (`PROJECT_STATUS.md`, `BUG_REGISTER.md`, `TEST_REPORT.md`,
`CHANGELOG_HANDOFF.md`, `docs/FINAL_REPORT.md`) cited the OLD ids; on Oct 22 they were rewritten to the ids this history
carries, using this table. The old id is kept here so an older copy of a report can still be read against this tree.

How each row was derived: the commit that first wrote the old id into a report is the commit right after the code
commit it names (`git log -S<old id>`); the row's own description was then matched to that commit's subject. Rows marked
"range" name the first / last commit of a run of plumbing commits and are best-effort endpoints.

| Old id | Id in this history | Commit |
|---|---|---|
| `512f3d40` | `6ffc9c78` | Wave 4 final (Oct 14) — the last pre-rebuild tree, identical to the Oct 14 source zips |
| `40a4605c` | `faef6aed` | P0 §190 keystores removed; supply-chain gate R7 |
| `b7b85cb5` | `be06283e` | P0 §142 gift-card reload back door; void in one transaction |
| `4c8e9e5a` | `c2a344f9` | P0 §228/§223 lost refund answer held, never sent twice |
| `820d7546` | `6f37bab4` | P1 §121 commission precedence |
| `a9f9fe7e` | `27e3b997` | P1 §51/§78 one eligibility authority; approved time off |
| `dd66f25c` | `5d6dc0ca` | P1 §31 durable idempotency on booking create / check-in |
| `690737d3` | `cef689c8` | P1 §232 processor problem is never a DECLINE |
| `deefefa7` | `ef303be2` | P1 §210 production refuses disk media storage |
| `1beb6cf6` | `79df7020` | P1 §212 POST_RESTORE_HOLD |
| `39c4c53e` | `ac22b13c` | range start — mandate reports + final-run script |
| `b92b6dc4` | `c1cfcd41` | range end — drill-restore hold proof |
| `37b175b5` | `98a052dd` | range start — reruns after each fix (BranchHealthScreen timeout) |
| `a23de428` | `8590d46e` | range end — live-checkout-one-payment proof grants |
| `a1cdf899` | `e8b1d1ae` | B-27 (1/2) harnesses rebased |
| `97938b71` | `6c480f56` | B-29 portfolio photo delete removes the stored image |
| `16f7f2d7` | `788b77c4` | B-27 (2/3) |
| `1a34df2f` | `5c5b497b` | B-27 (3/3) harness lane 37/0/1 |
| `36fb1020` | `81883bf7` | harness fixtures take commission from the one authority |
| `16d501c3` | `dac964a3` | Reports: second full run (base of the seven evening commits) |
| `2096ed11` | `ce2fa5f5` | B-12 same-tenant trigger on every tenant FK (666) |
| `3e09e21d` | `f4c00116` | B-13 end employment for non-technician staff |
| `842c780a` | `51c3f827` | B-14 part 1 one Twilio client; direct pushes → events |
| `57fb1a0f` | `e7463677` | B-15 check:migration-safety |
| `62ad32ec` | `602fad5d` | B-17 retail stock reversible (667) |
| `9195a732` | `16f3fa89` | B-28 + B-30 paged salon browse; cached index report |
| `362b55bb` | `a5bdce20` | B-31 owner attendance day |
| `cf9b13e9` | `4428ea3c` | B-30 round 2 |
| `eeb6753d` | `331b5b67` | B-14 rest — direct emitters / hand-built actors / back-edges 0 |
| `707cb628` | `f7880f1a` | B-16 platform-managed texting provisioning (668) |
| `afd89e89` | `28ce4850` | B-32 deadlocked booking-hold insert retried once |
| `6af263a6` | `8d41bd7a` | Reports: fourth full run |
| `ceb704cc` | `98844041` | B-33 gift-card payment refunded onto the card |
| `633f0662` | `1047ee01` | B-34 cancel a Bolt terminal prompt |
| `0d494400` | `db68c371` | B-35 merchant routing never silently falls back |
| `1f612eb6` | `2ce2c0b3` | M2 — D11 booking deposits, branch service price, one appointment writer |
| `6653331d` | `59eda92b` | B-37 reminder ladder (670) |
| `9b271268` | `a8e888da` | M3 — one tax calculation, posHttp, rollout flags, ratchets |
| `040dd9b5` | `7933409a` | M4 — a11y tests, pinch-zoom, EN/VI booking page + kiosk |
| `9ed941f2` | `1853163c` | M4 — System Status storage/deployments, check-i18n, live proofs |
| `380b13fc` | `444f3852` | fifth-run head (B-46..B-48 hashes) |
| `45d178ef` | `bf9903a3` | pos-viewport-audit measures the real screens |
| `60694245` | `e8990543` | pos-web shell controls ≥ 40 px |
| `4db4aebe` | `766c0b2a` | fifth run tests-api: `_headers` regenerated, §43 envelope in specs |
| `1b98e398` | `e3c231f6` | final-run-rerun.sh |
| `33080a69` | `1e05abda` | tests-api rerun: last four projection specs allow the §43 envelope |
| `5123a532` | `4befec49` | live-pilot-day waits for every loyalty earning |
| `7964fb9b` | `45e309bf` | POS Vietnamese (1/3) |
| `8ac41473` | `c025890c` | POS Vietnamese (2/3) |
