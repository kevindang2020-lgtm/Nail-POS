# AI Inventory Assistant (spec + guide of Nov 2 2026, built Nov 3 2026)

Route `/tenant/ai/inventory`. Title, description, the six cards and the four tabs (Command Center · Low Stock · Reorder · Slow-Moving)
stay.

## Audit findings

| Area | Finding |
|---|---|
| Cards | Came from ONE branch's stock row. A salon-wide login has no branch, so every product read 0 on hand → all "Out of Stock". |
| "11 Critical / 0 Out of Stock" | Valid by the rule, but unexplained: with no critical level set, Critical = at or below **half the reorder level** (with some stock left). Nothing said which rule applied. |
| Stock accuracy | Nothing compared the stock figure with the movement history (`inventory_stock_movements.quantity_after`). |
| Search / history | No product search, no stock activity list, no dates, no pages. |
| Health check | None. |
| Reordering | The reorder recommendation service exists (lead times, inbound POs) and is kept; it still uses the login's branch. |

## What was built

- `/pos/ai-inventory/center/*` (`inventory-center.ts`, same AI package gate; `pos.ai_inventory.view` + `inventory.view`):
  `summary` (the six cards with one definition each — the same pure classification as the position service — and the reasons:
  critical by its own level vs by half the reorder level, products with no levels, stock that differs from its history, no stock
  record, open orders; scope = this branch or **all branches summed** for a salon-wide login) · `products` (search name / SKU /
  vendor / category; status incl. "no levels" and "differs from history"; most urgent first / name / lowest stock / recently changed;
  pages; each row shows on hand, reserved, on order, the levels and their source, the history's last balance) · `activity` (stock
  movements newest first; search product / SKU / reason / reference; type group; presets + From/To in salon time; pages) · `check`.
- **Check Inventory System** (migration 779 `inventory_health_runs`): products tracked, stock records present, no negative stock,
  stock matches its history, levels set, critical levels set on purpose, levels consistent, stock changes recorded (30 days), open
  purchase orders past their date, reorder information (vendor + lead time) for products that need it, tenant isolation, no side
  effects. Part + last pass on each.
- POS: the Command Center tab is `InventoryCenterPanel` (cards with definitions, reasons, products, activity, the check); the other
  three tabs are unchanged. EN/VI `icx.*`. The old `GET context` has no caller (unreached ledger; client method removed, pinned).

## Tests

- `inventory-center.pgtest.vitest.spec.ts` 8/8 on the real schema (each product in one card, derived vs explicit critical,
  salon-wide sums, permission, product search / status / sort / pages, ledger difference, activity filters / dates / scope, the check).
- POS `POSAiInventoryScreen.test.tsx` 6/6, `.403` 1/1.

## Decisions for Kevin

- A salon-wide login: the Low Stock / Reorder / Slow-Moving tabs still read one branch (none → nothing). Make them sum all branches too,
  or ask the user to pick a branch?
