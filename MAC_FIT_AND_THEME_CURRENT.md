# MAC_FIT_AND_THEME_CURRENT (§14 + theme baseline)

Reference-independent audit of the **current** `apps/pos-web` shell against the 24-inch Mac-fit standard, plus the
current cream/gold token set. The OLD-file comparison (exact sidebar width, palette values, spacing) fills in once
`AIPowerSalon-POS-APP_4_1.html` is uploaded.

## Mac-fit standard — current compliance: PASS (structural)
- **No forbidden hacks:** no `zoom:` and no `transform: scale(...)` anywhere in pos-web. Layout is real, not scaled.
- **Fixed shell present and correct** (`src/styles.css`):
  - `html, body, #root { height: 100vh; overflow: hidden; }`
  - `.shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); height: 100vh; overflow: hidden; }`
  - `.main { display: grid; grid-template-rows: 56px minmax(0, 1fr); height: 100vh; overflow: hidden; }`
  - `.work { padding: 18px 20px; overflow-y: auto; height: 100%; }` — internal scroll, not body scroll.
  - `.sidebar { height: 100vh; position: sticky; top: 0; overflow: hidden; }`, `.nav { overflow-y: auto; flex: 1; }`
  - `.topbar { position: sticky; top: 0; z-index: 5; }`, `.list { max-height: 320px; overflow-y: auto; }`
- This matches the documented invariant: tables/lists scroll internally via `minmax(0,1fr)` rather than pushing bottom
  strips off-screen; targets 1440×900 min and 1920×1080 @100%.

**To verify against the old file:** the *structure* is compliant, but pixel fit per screen (KPI card sizes, panel
heights, Technician Insights not cut off, etc.) still needs the old layout + a desktop-browser pass — the same
browser-QA caveat noted elsewhere. Headless checks can confirm CSS invariants, not rendered fit.

## Current cream/gold tokens (`:root` in `src/styles.css`)
Baseline to preserve and to diff against the old palette:

| Token | Value | Role |
|---|---|---|
| `--page` | `#F7EFE3` | app background |
| `--card` | `#FFFCF6` | card/surface |
| `--sidebar` | `#FFF9EF` | sidebar background |
| `--text` | `#2C2118` | primary text |
| `--soft` | `#6D5F50` | secondary text |
| `--muted` | `#9B8B78` | muted text |
| `--line` | `#E9DAC4` | hairline borders |
| `--gline` | `#E2C686` | gold border |
| `--g7` / `--g8` | `#A96F22` / `#8B5A18` | gold accents (deep) |
| `--cream2` | `#F3E7D2` | cream alt |
| `--ok` / `--ok-bg` | `#3E8F57` / `#EEF7EF` | success |
| `--warn` / `--warn-bg` | `#D09A36` / `#FFF6E5` | warning |
| `--danger` | `#B85B4D` | danger |
| `--info` | `#3C7FB6` | info |
| `--grad` | `linear-gradient(180deg, #F2D892, #D7A646)` | gold button/brand gradient |

- **Fonts:** body `Hanken Grotesque`; headings/KPI values `Playfair Display`.
- **Key metrics:** sidebar `232px`; topbar `56px`; work padding `18px 20px`; card radius/shadows per `.panel`/`.kpi`.

## On upload — the theme reconciliation
1. Diff the old file's palette + fonts against the table above; align tokens (the family already matches).
2. Confirm old **sidebar width** (current `232px`) and adjust if the old build differs.
3. Match card radius, borders, shadows, spacing per the old composition — editing tokens/`styles.css`, not per-screen
   one-offs, so the whole POS stays consistent.
