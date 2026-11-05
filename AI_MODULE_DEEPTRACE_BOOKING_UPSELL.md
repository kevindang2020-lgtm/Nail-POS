# AI Write-Sensitive Modules — Deep-Chain Trace (ai_booking, ai_checkout_upsell)

The two modules with the strongest "AI must never write directly / approval required" constraints. Both
registered in AppModule (`AiBookingModule`, `AiCheckoutUpsellModule`).

## ai_booking  → `ai-booking/`

- Controllers: `api/ai-booking/v1` (`TenantAuthGuard`), `api/ai-booking/v1/public` (public receptionist/web
  entry), `super-admin/tenants` (`SuperAdminGuard` — link issue/revoke, metrics, system-status).
- Endpoints: `availability/search`, `recommendations`, `context`, `appointments` (create),
  `appointments/:id/reschedule|cancel|confirm`, `appointments/:id` (read), `conversion-events`,
  `conversion/summary|metrics`.
- **Never writes directly (per spec):** appointment writes go through the approved
  **`BookingService.createAppointment(ctx, …)`** (imported from `../booking/booking.service`), which raises
  `ValidationError` / `ConflictError` / `ForbiddenError` — so conflict detection, duplicate detection, and
  validation are enforced by the canonical booking service, not by the AI. The AI never issues SQL against
  appointments.
- Recommendations (alternative times/technicians) are computed and returned as suggestions; creation is a
  separate explicit call.
- Tests: **12 spec files**. **Status: Complete.**

## ai_checkout_upsell  → `ai-checkout-upsell/`

- Controller: `pos/ai-checkout-upsell` (`TenantAuthGuard` + `RolePermissionGuard`), permissions
  `pos.ai_checkout_upsell.view` + `pos.settings.edit`.
- **Never auto-adds (per spec):** `ai-checkout-upsell-core.ts` is **pure** recommendation logic — its own
  header states it "NEVER mutates a cart, never computes a final total." It returns ranked, capped, transparent
  recommendation cards (add-ons, membership, loyalty, gift-card, rebooking) over **approved** candidates only.
- **Approval = explicit staff action:** applying a recommendation is a separate permission-gated POST the staff
  member (or customer) makes — `checkout/:id/addons/:addOnId/add`, `membership/:planId/enroll`,
  `loyalty/:rewardId/redeem`, `promotions/:promotionId/apply`, `next-appointment/:serviceId`. Plus `dismiss`
  and `feedback`. The AI proposes; a human disposes.
- Tests: **12 spec files**. **Status: Complete.**

## Invariants confirmed (both)
- `ai_booking` performs appointment writes only through the approved `BookingService` — no direct DB writes by
  the AI; conflict/duplicate/validation enforced centrally.
- `ai_checkout_upsell` never mutates the cart or computes totals; every add/enroll/redeem/apply is an explicit,
  permission-gated human action.
- Both are tenant-scoped and guarded; recommendation logic is deterministic and transparent (no fabricated
  availability, prices, or add-ons — only approved candidates).
