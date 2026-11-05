# @aipowersalon/api-contracts

The API's request/response types — one definition, imported by `apps/api` **and** by every frontend (Constitution 13 §13–15). Frontends must not re-declare these types (§15); the architecture gate reports any that do.

**Realms (§14).** Each realm is its own entry point, so an app imports only the contracts it is entitled to:

| Entry | Contracts | Used by |
|---|---|---|
| `@aipowersalon/api-contracts/tenant` | salon-realm APIs (owner, cash drawer, compensation, …) | api, owner-web (so far) |
| `@aipowersalon/api-contracts/customer` | customer-realm APIs (profile, booking, salons, nearby deals, payments) | api, customer-web |
| `@aipowersalon/api-contracts/platform` | Super Admin control-plane APIs (analytics, customer-data oversight, catalog, disputes, plans, settlements) — never importable by a tenant or customer app | api, admin-web |
| `…/public-booking` | added when the public booking surface migrates | — |

**Built like every other package; apps/api reads `dist`.** The realm files hold types only, but §13 also puts *runtime* contracts here — the pagination bounds (`MAX_PAGE_SIZE`, `clampPage`, `clampPageSize`, `clampLimit`) and the interactive date-range caps (`MAX_RANGE_DAYS`, `validateDateRange`, `DateRangeError`) — imported from the root entry `@aipowersalon/api-contracts`. `apps/api` pins `"rootDir": "src"`, so it consumes this package **compiled** (its tsconfig paths point at `dist/`, the same convention as `database`, `security`, `money`), which is why runtime code here cannot move the API's build output; frontends resolve the source through Vite like the other browser-safe packages. The load-bearing rule is now **dependency-free and browser-safe (§111)**: nothing in `src/` may import from outside the package (no node built-ins, no packages, no path that leaves `src/`) — `npm run architecture:test` fails on any such import, and `"types": []` in the package tsconfig refuses node built-ins at compile time too.

**Checked strictly on its own.** Apps compile with `skipLibCheck`, which skips every `.d.ts` — so a broken realm type would silently become `any` in every consumer (proven with a planted reference to a non-existent type: the API type-checked clean). `npm run architecture:test` therefore type-checks this package with `skipLibCheck: false`.

**Same name, different realm is allowed and expected.** The API has two `CustomerProfile`s — the customer app's own view (`customer/`) and the salon's POS view (`customers/`). Each realm entry point carries its own.

**Where a contract comes from.** `tooling/contracts/move-contracts.py` moves a type from the API, taking the API's declaration text (the API is authoritative, §320). A frontend copy that differs is refused until someone adjudicates it; the commit that moves it records the verdict.
