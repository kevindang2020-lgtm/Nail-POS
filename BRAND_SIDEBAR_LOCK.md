# 🔒 AI PowerSalon — Sidebar Brand Lock

The sidebar palette across all apps is **locked** to match the official AI PowerSalon logo
(champagne gold + cream). These values must not change by accident.

## Locked palette (scoped to `.sidebar` in each app's `styles.css`)
| Token | Value | Role |
|---|---|---|
| `--sidebar` | `#FBF7EF` | cream ground (logo background) |
| `--grad` | `linear-gradient(135deg, #E4BE7A, #BE9143)` | champagne gold — active nav item |
| `--g7` / `--gold` | `#BE9143` | gold accents / icons |
| `--g8` | `#A9772E` | deep gold |
| `--gline` | `#D8BE86` | dots / lines |
| `--cream2` | `#F3E8D3` | hover |
| logo asset | transparent PNG/WebP | blends on the cream ground |

## Where
Locked block lives at the bottom of each of these files, scoped to `.sidebar`
(so only the sidebar is affected — the rest of the app keeps its own tokens):
- `apps/pos-web/src/styles.css`   (POSLayout left sidebar)
- `apps/admin-web/src/styles.css` (AdminLayout left sidebar)

> Note: only pos-web and admin-web render a left sidebar. tech-web uses a bottom nav
> (`tech-bottomnav`) and customer-web uses a customer nav (`cust-nav`) — different UIs,
> not covered by this sidebar lock.

## The guard
`scripts/verify-brand-lock.mjs` checks that every locked value is present, verbatim,
in every app. It exits non-zero if any value is missing or changed. Wire it into CI
or a pre-commit hook so an accidental edit fails the build:

```
node scripts/verify-brand-lock.mjs
```

To intentionally change the brand later, update the values here, in each `styles.css`
`.sidebar` block, AND in `verify-brand-lock.mjs` together — deliberately, in one commit.
