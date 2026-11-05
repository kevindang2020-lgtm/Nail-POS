# Inventory — Stock Rules

- **Single source of truth:** on-hand/open/unopened/etc. are *recomputed from the bottle rows*
  (`countsFromUnits`) after every change — never blindly incremented, so concurrent writers can't drift.
- **on-hand (usable)** = unopened + opened + low. empty/damaged/expired/missing/returned/disposed are excluded.
- **Status:** out_of_stock (0) · critical (≤ ⌈reorder/2⌉) · low (≤ reorder) · overstock (> max) · else in_stock.
- **Reorder suggestion** = max(reorderQuantity, reorderLevel − onHand) when at/below reorder point, else 0.
- **Bottle lifecycle guards:** unopened→opened→low→empty/damaged; no double-empty, no double-open,
  disposed/returned are terminal. Illegal transitions return 409.
- **Movement integrity:** after = before + change; never negative unless explicitly allowed; every change
  writes an immutable `inventory_stock_movements` row. Corrections are new reversing rows (never edits).
- **Technician reports** can't be filed against an already-empty bottle / already-open bottle; duplicate
  pending reports for the same bottle+type are blocked by a unique partial index.
- **Technicians** never receive cost_cents / retail_price_cents / inventory value.
