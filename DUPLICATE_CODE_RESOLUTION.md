# DUPLICATE_CODE_RESOLUTION (§6 No-Duplication Rule)

Reference-independent audit of the current `apps/pos-web`. Goal: confirm exactly one canonical screen/component per
route before any restyle, so the old layout is applied to a single target (no `DashboardV4` / `CheckoutCopy` forks).

## Result: no duplication to remediate
- **Duplicate-named components:** none. No files matching `V2/V4/old/new/copy/final/backup/legacy/_2/deprecated`.
- **Screens vs routes:** 18 non-test screen components ↔ 18 routes — a 1:1 mapping. Each `/pos/*` route already resolves
  to a single canonical screen (see `CURRENT_POS_STRUCTURE.md` for the table).
- **Shell:** one layout (`shell/POSLayout.tsx`), one sidebar definition (`NAV`), one header.
- **API clients:** one client module per domain (21 total), no parallel/legacy copies.

## Implication for the restore
The restyle applies the old `_4_1.html` look **in place** to each existing canonical screen. There is nothing to
deprecate or delete on duplication grounds. The only "merge" concern is the opposite of duplication: making sure the
restyle does not *introduce* a second implementation — so all visual changes must edit the canonical screen/shell, not
add a new variant.

## Guardrail for the restyle phase
- Edit `POSLayout.tsx` + the 15 canonical screens directly; do not create `*V4`, `*Old`, `*New` files.
- If a screen needs a large new sub-section from the old build, add it as a child component imported by the canonical
  screen (e.g. `components/SelectedTicketPanel.tsx`) — still one screen per route.
