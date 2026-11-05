# Payment Gateways — Bug-Fix Report

## Product bugs found in existing code
- **None in the secure backend.** The audit specifically checked the highest-risk path: the platform list endpoint selects
  the raw `merchant_id` but **masks it** (`'••••' + last4`) before returning — confirmed correct, not a leak. Encryption,
  write-only forms, masked-only returns, and tenant isolation were all already correct. No security regression was needed
  or introduced.

## Build-time issues fixed during this build
- **`setupBadge` type cast** (`PaymentGatewaysScreen.tsx`): the status→style lookup objects don't carry the label `t`
  (added later via spread); the cast was narrowed to `Record<string,{bg;fg;ic}>` so `tsc` passes.
- **Test assertions** (`PaymentGatewaysScreen.test.tsx`): the tenant name appears 3× (row + detail + event), so the load
  gate was switched to `findAllByText`; KPI value lookups were scoped to `.v`; the array result of `findAllByText` was no
  longer asserted with `toBeInTheDocument`; the Configure-drawer test now clicks **Edit** to reveal the write-only form
  before asserting the "encrypted at rest" text (that text lives behind the edit toggle by design).

## Honest non-bugs
- Design KPI figures (2,418 etc.) are seed/dev values; real values reflect actual tenants. Not a defect.
