# Inventory — Testing Checklist

## Automated (passing)
- `inventory-core.spec.ts` — 29/29 (counts, status, reorder, lifecycle guards incl. no double-empty/open,
  movement integrity, tech-report validation, summary).
- API typecheck 0 errors. pos-web typecheck 0, vite build OK.

## Manual (maps to spec §37)
1–6. Manager creates category/brand/product (brand, color name + number); adds 6 bottles; counts show
   unopened/open/low/empty correctly (recomputed from bottle rows).
7–19. Technician reports almost-empty → manager approves → bottle low; reports empty → empty once only;
   open replacement → unopened−1, open+1 (double-open blocked).
20. Low-stock alert appears at threshold; reorder suggestion shown.
31–34. Tenant A cannot see Tenant B inventory; location scoping enforced; technician cannot see cost/value;
   reception cannot approve reports (needs `inventory.technician_report.approve`).
35–36. Audit logs written; no negative/duplicate inventory.
