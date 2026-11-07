# API changes since the repository merge (manifest at `ef877c5`, Nov 2 2026) — generated Nov 6 2026

F5 §261: the human list of route changes, generated from `apps/api/openapi/manifest.txt` — the review record that `check:openapi` enforces. Every route carries its realm, permission and resource scope in the manifest.

Added routes: **262** · removed: **15** · security line changed (permission / guard / step-up / idempotency; the `resource=` and `domain=` columns ignored): **30** · routes that gained the `resource=` scope column (Nov 5, Security §38): **3706**

**Breaking changes:** every removed route is listed in full below. A changed security line can refuse a caller that was allowed before.

## Added (by area)

| Area | Routes |
|---|---|
| `/internal/backups` | 2 |
| `/owner/finance` | 1 |
| `/pos/ai` | 10 |
| `/pos/ai-analytics` | 5 |
| `/pos/ai-booking` | 9 |
| `/pos/ai-business` | 27 |
| `/pos/ai-checkout-upsell` | 4 |
| `/pos/ai-inventory` | 4 |
| `/pos/ai-marketing` | 6 |
| `/pos/ai-queue-assignment` | 4 |
| `/pos/ai-scheduling-optimizer` | 5 |
| `/pos/ai-voice-transcription` | 14 |
| `/pos/cash-drawer` | 3 |
| `/pos/catalog` | 4 |
| `/pos/checkout` | 2 |
| `/pos/churn-watch` | 6 |
| `/pos/communications` | 2 |
| `/pos/coupons` | 2 |
| `/pos/customer-ai-settings` | 7 |
| `/pos/customer-intelligence` | 6 |
| `/pos/customer-notifications` | 1 |
| `/pos/customer-search` | 5 |
| `/pos/customer-timeline` | 3 |
| `/pos/deals-offers` | 2 |
| `/pos/devices` | 1 |
| `/pos/duplicate-review` | 10 |
| `/pos/invoices` | 3 |
| `/pos/loyalty` | 9 |
| `/pos/memberships` | 2 |
| `/pos/money-protection-center` | 12 |
| `/pos/rebooking` | 7 |
| `/pos/receipt-center` | 4 |
| `/pos/referral-program` | 3 |
| `/pos/reputation` | 10 |
| `/pos/reputation-settings` | 5 |
| `/pos/retention` | 2 |
| `/pos/reviews-center` | 4 |
| `/pos/service-recommendations` | 9 |
| `/pos/settings` | 1 |
| `/pos/skills-catalog` | 7 |
| `/pos/tickets` | 1 |
| `/pos/weekly-days-off` | 4 |
| `/super-admin/advertising` | 9 |
| `/super-admin/backups` | 10 |
| `/super-admin/loyalty-network` | 1 |
| `/tech/metrics` | 1 |
| `/tenant/ai` | 6 |
| `/tenant/inventory` | 7 |

## Removed (all)

- `GET /pos/ai-customer-profile/duplicates/{groupId}/preview`
- `GET /pos/ai-customer-profile/settings`
- `GET /pos/ai-customer-profile/tenant-overview`
- `GET /pos/ai-ocr-receipt/documents`
- `GET /pos/ai-review-reputation/analytics`
- `GET /pos/ai-review-reputation/branch-comparison`
- `GET /pos/ai-review-reputation/escalations/urgent`
- `GET /pos/ai-review-reputation/inbox`
- `GET /pos/ai-review-reputation/integration-status`
- `GET /pos/ai-review-reputation/settings`
- `GET /pos/ai-review-reputation/{id}`
- `POST /pos/ai-customer-profile/tenant-overview/refresh`
- `POST /pos/customers/duplicates/{duplicateGroupId}/decision`
- `PUT /pos/ai-customer-profile/settings/{level}`
- `PUT /pos/ai-review-reputation/settings`

## Security line changed (all)

- `DELETE /owner/expenses/{id}` — was `realm=staff auth=session perm=owner.expenses.manage` → now `realm=staff auth=session perm=owner.expenses.delete_draft`
- `DELETE /owner/finance/expenses/{id}` — was `realm=staff auth=session perm=owner.expenses.manage guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=owner.expenses.delete_draft guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/network/earning/history` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/network/purchases` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/network/purchases/{id}` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/network/state` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/network/wallet` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/network/wallet/ledger` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `GET /super-admin/release-evidence` — was `realm=super_admin auth=session derived=UNCLASSIFIED guards=SuperAdminGuard` → now `realm=super_admin auth=session derived=super_admin.system_operations.view guards=SuperAdminGuard`
- `POST /owner/finance/expenses/{id}/archive` — was `realm=staff auth=session perm=owner.expenses.manage guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=owner.expenses.archive guards=RolePermissionGuard,TenantAuthGuard`
- `POST /owner/finance/expenses/{id}/bill-payments` — was `realm=staff auth=session perm=owner.expenses.manage guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=owner.expenses.bills.manage guards=RolePermissionGuard,TenantAuthGuard`
- `POST /owner/finance/expenses/{id}/restore` — was `realm=staff auth=session perm=owner.expenses.manage guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=owner.expenses.archive guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-queue-assignment/alerts/scan` — was `realm=staff auth=session perm=ai_queue_assignment.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=ai_queue_assignment.resolve_alerts guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/cash-drawer/movement` — was `realm=staff auth=session perm=checkout.process_payment` → now `realm=staff auth=session perm=checkout.process_payment idempotency=optional`
- `POST /pos/cash-drawer/open` — was `realm=staff auth=session perm=checkout.process_payment` → now `realm=staff auth=session perm=checkout.process_payment idempotency=optional`
- `POST /pos/cash-drawer/reconcile` — was `realm=staff auth=session perm=checkout.process_payment` → now `realm=staff auth=session perm=checkout.process_payment idempotency=optional`
- `POST /pos/customers` — was `realm=staff auth=session perm=pos.customers.create guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.create idempotency=optional guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/earning/activate` — was `realm=staff auth=session perm=pos.settings.edit step-up guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.settings.edit step-up feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/earning/drafts` — was `realm=staff auth=session perm=pos.settings.edit guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.settings.edit feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/earning/drafts/{id}/discard` — was `realm=staff auth=session perm=pos.settings.edit guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.settings.edit feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/earning/preview` — was `realm=staff auth=session perm=pos.customers.view guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.customers.view feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/earning/use-global` — was `realm=staff auth=session perm=pos.settings.edit guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.settings.edit feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/earning/versions/{id}/cancel` — was `realm=staff auth=session perm=pos.settings.edit guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.settings.edit feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/purchases` — was `realm=staff auth=session perm=pos.settings.edit step-up idempotency=required guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.settings.edit step-up idempotency=required feature=loyalty guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/memberships/enroll` — was `realm=staff auth=session perm=pos.memberships.manage feature=memberships guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=pos.memberships.manage idempotency=optional feature=memberships guards=RolePermissionGuard,TenantAuthGuard`
- `POST /super-admin/release-evidence` — was `realm=super_admin auth=session derived=UNCLASSIFIED guards=SuperAdminGuard` → now `realm=super_admin auth=session derived=super_admin.system.manage guards=SuperAdminGuard`
- `POST /tenant/inventory/purchase-orders` — was `realm=staff auth=session perm=inventory.purchase_order.create guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=inventory.purchase_order.create idempotency=optional guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/purchase-orders/{id}/receive` — was `realm=staff auth=session perm=inventory.purchase_order.receive guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=inventory.purchase_order.receive idempotency=optional guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/recipes/{serviceId}/consume` — was `realm=staff auth=session perm=inventory.product_usage.submit guards=RolePermissionGuard,TenantAuthGuard` → now `realm=staff auth=session perm=inventory.product_usage.submit idempotency=required guards=RolePermissionGuard,TenantAuthGuard`
- `POST /webhooks/voice/retell` — was `realm=shared auth=session unversioned` → now `realm=shared auth=public unversioned`

## Added (all)

- `DELETE /pos/ai-business/center/assistant/history/{id}  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /owner/finance/expenses/summary  realm=staff  auth=session  domain=finance  perm=owner.expenses.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-analytics/center/run  realm=staff  auth=session  domain=ai  perm=pos.ai_analytics.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-analytics/center/runs  realm=staff  auth=session  domain=ai  perm=pos.ai_analytics.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-analytics/center/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_analytics.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-analytics/forecast/readiness  realm=staff  auth=session  domain=ai  perm=pos.ai_analytics.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-booking/activity  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-booking/health  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-booking/overview  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-booking/recovery  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-booking/recovery/{caseKey}/alternatives  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-booking/requests/{requestId}  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/anomaly  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/events/{id}/explain  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/history  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/incidents  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/incidents/{id}  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/rules  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/summary  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/alerts/{id}/delivery  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/assistant/history  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/branches/explain  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/branches/scorecard  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/reports  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/reports/summary  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-business/center/reports/{id}  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-checkout-upsell/center/activity  realm=staff  auth=session  domain=checkout  perm=pos.ai_checkout_upsell.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-checkout-upsell/center/history  realm=staff  auth=session  domain=checkout  perm=pos.ai_checkout_upsell.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-checkout-upsell/center/summary  realm=staff  auth=session  domain=checkout  perm=pos.ai_checkout_upsell.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-inventory/center/activity  realm=staff  auth=session  domain=ai  perm=pos.ai_inventory.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-inventory/center/products  realm=staff  auth=session  domain=ai  perm=pos.ai_inventory.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-inventory/center/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_inventory.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-marketing/center/recommendations  realm=staff  auth=session  domain=ai  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-marketing/center/summary  realm=staff  auth=session  domain=ai  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-queue-assignment/entries/{queueEntryId}/detail  realm=staff  auth=session  domain=ai  perm=ai_queue_assignment.view  resource=BRANCH/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-queue-assignment/health  realm=staff  auth=session  domain=ai  perm=ai_queue_assignment.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-queue-assignment/history  realm=staff  auth=session  domain=ai  perm=ai_queue_assignment.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-scheduling-optimizer/center/history  realm=staff  auth=session  domain=ai  perm=ai_scheduling.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-scheduling-optimizer/center/recommendations  realm=staff  auth=session  domain=ai  perm=ai_scheduling.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-scheduling-optimizer/center/summary  realm=staff  auth=session  domain=ai  perm=ai_scheduling.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-scheduling-optimizer/recommendations/{id}/day  realm=staff  auth=session  domain=ai  perm=ai_scheduling.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/calls  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/calls/detail  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/calls/summary  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/center/records  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/center/summary  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/follow-ups/items  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/follow-ups/items/history  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai-voice-transcription/follow-ups/summary  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai/business-setup/closures  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai/business-setup/health/last  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai/follow-ups-center/health/history  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/ai/follow-ups-center/recommended-assignee  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/cash-drawer/history  realm=staff  auth=session  domain=payments  perm=pos.checkout.view  resource=BRANCH/permission`
- `GET /pos/cash-drawer/registers  realm=staff  auth=session  domain=payments  perm=pos.checkout.view  resource=BRANCH/permission`
- `GET /pos/catalog/services/{serviceId}/pricing-impact  realm=staff  auth=session  domain=catalog  perm=pos.services.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/checkout/tickets/{ticketId}/tip-selection  realm=staff  auth=session  domain=checkout  perm=pos.checkout.view  resource=BRANCH/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/churn-watch/customers  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/churn-watch/customers/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/churn-watch/history  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/churn-watch/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/communications/inbox/source-campaigns  realm=staff  auth=session  domain=communications  perm=pos.communications.view  resource=BRANCH/permission  feature=communications  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/coupons/health/runs  realm=staff  auth=session  domain=deals  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-ai-settings/history  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-ai-settings/history/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-ai-settings/state  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-intelligence/customers  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-intelligence/customers/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-intelligence/scans  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-intelligence/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-notifications/records/export  realm=staff  auth=session  domain=communications  perm=pos.communications.view  resource=BRANCH/permission  async=pos.customer-notifications.export  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-search/customers  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-search/customers/{id}  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-search/options  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-search/summary  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-timeline/customers/{id}/events  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/customer-timeline/customers/{id}/events/{eventId}  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/deals-offers/health/runs  realm=staff  auth=session  domain=deals  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/devices/payment-terminals/audit  realm=staff  auth=session  domain=payments  perm=pos.checkout.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/duplicate-review/groups  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/duplicate-review/groups/{id}  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/duplicate-review/history  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/duplicate-review/summary  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/invoices/catalog  realm=staff  auth=session  domain=finance  perm=pos.checkout.process_payment  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/bonus-requests  realm=staff  auth=session  domain=loyalty  perm=pos.customers.view  resource=BRANCH/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/bonus-requests/health  realm=staff  auth=session  domain=loyalty  perm=pos.customers.loyalty.edit  resource=BRANCH/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/bonus-requests/preview  realm=staff  auth=session  domain=loyalty  perm=pos.customers.view  resource=BRANCH/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/loyalty/tiers  realm=staff  auth=session  domain=loyalty  perm=pos.customers.view  resource=BRANCH/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/memberships/members/{membershipId}/first-payment  realm=staff  auth=session  domain=memberships  perm=pos.memberships.view  resource=TENANT/records  feature=memberships  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/alerts  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view_alerts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/alerts/detail  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view_alerts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/detection/runs  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/investigations  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/investigations/timeline  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/rules  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/settings/history  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/money-protection-center/summary  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/rebooking/customers  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/rebooking/customers/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/rebooking/history  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/rebooking/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/receipt-center/documents  realm=staff  auth=session  domain=ai  perm=pos.ai_ocr_receipt.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/receipt-center/documents/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_ocr_receipt.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/receipt-center/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_ocr_receipt.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/referral-program/filter-options  realm=staff  auth=session  domain=loyalty  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/referral-program/health/last  realm=staff  auth=session  domain=loyalty  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation-settings/history  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation-settings/history/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation-settings/state  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/approvals  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/branches  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/complaints  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/integrations  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/requests  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/reviews  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/reviews/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reputation/trends  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reviews-center/check/last  realm=staff  auth=session  domain=customers  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/reviews-center/staff  realm=staff  auth=session  domain=customers  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/service-recommendations/history  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/service-recommendations/recommendations  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/service-recommendations/recommendations/{id}  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/service-recommendations/scans  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/service-recommendations/summary  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/settings/payments-checkout/terminals/processors  realm=staff  auth=session  domain=tenants  perm=settings.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/skills-catalog  realm=staff  auth=session  domain=workforce  perm=pos.technicians.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/skills-catalog/technician/{technicianId}  realm=staff  auth=session  domain=workforce  perm=pos.technicians.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/skills-catalog/technician/{technicianId}/removal-impact/{assignmentId}  realm=staff  auth=session  domain=workforce  perm=pos.technicians.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /pos/weekly-days-off  realm=staff  auth=session  domain=workforce  perm=pos.technicians.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `GET /super-admin/advertising/ads  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/advertising/fleet  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/advertising/policy  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/advertising/preview  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/backups/overview  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/backups/recovery-points  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/backups/recovery-points/{id}  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/backups/restore-plans  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/backups/restore-plans/{id}  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /super-admin/backups/tenants  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.view  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `GET /tech/metrics  realm=staff  auth=session  domain=workforce  perm=tech.earnings.view  resource=OWN/path`
- `GET /tenant/ai/receptionist/settings/check/last  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=TenantAuthGuard`
- `GET /tenant/ai/receptionist/settings/history  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=TenantAuthGuard`
- `GET /tenant/ai/usage-screen/reconcile  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `PATCH /tenant/inventory/purchase-orders/{id}  realm=staff  auth=session  domain=inventory  perm=inventory.purchase_order.create  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /internal/backups/recovery-points  realm=shared  auth=public  domain=operations  resource=PUBLIC/realm`
- `POST /internal/backups/recovery-points/{id}/verification  realm=shared  auth=public  domain=operations  resource=PUBLIC/realm`
- `POST /pos/ai-analytics/center/check  realm=staff  auth=session  domain=ai  perm=pos.ai_analytics.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-booking/health/run  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-booking/recovery/{caseKey}/dismiss  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  idempotency=optional  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-booking/recovery/{caseKey}/request-approval  realm=staff  auth=session  domain=ai  perm=ai_booking.view  resource=BRANCH/permission  idempotency=optional  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/alerts/check  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/alerts/events/{id}/acknowledge  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/alerts/incidents/{id}/action  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/alerts/incidents/{id}/notes  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/alerts/{id}/delivery  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/alerts/{id}/evaluate  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/assistant/check  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/branches/check  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/reports/check  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/reports/generate  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/reports/{id}/regenerate  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-business/center/reports/{id}/verify  realm=staff  auth=session  domain=analytics  perm=pos.ai_business.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-checkout-upsell/center/check  realm=staff  auth=session  domain=checkout  perm=pos.ai_checkout_upsell.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-inventory/center/check  realm=staff  auth=session  domain=ai  perm=pos.ai_inventory.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-marketing/center/check  realm=staff  auth=session  domain=ai  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-marketing/center/eligibility  realm=staff  auth=session  domain=ai  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-marketing/center/estimate  realm=staff  auth=session  domain=ai  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-marketing/center/save-draft  realm=staff  auth=session  domain=ai  perm=pos.marketing.manage  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-queue-assignment/health/run  realm=staff  auth=session  domain=ai  perm=ai_queue_assignment.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-scheduling-optimizer/center/check  realm=staff  auth=session  domain=ai  perm=ai_scheduling.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-voice-transcription/calls/check  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-voice-transcription/center/check  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-voice-transcription/follow-ups/check  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-voice-transcription/follow-ups/items/dismiss  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-voice-transcription/follow-ups/items/reopen  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai-voice-transcription/follow-ups/items/task  realm=staff  auth=session  domain=ai  perm=ai_voice_transcription.view_transcripts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai/business-setup/closures  realm=staff  auth=session  domain=ai  perm=ai.manage  resource=TENANT/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai/business-setup/closures/{id}/remove  realm=staff  auth=session  domain=ai  perm=ai.manage  resource=TENANT/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai/business-setup/faqs/{id}/tags  realm=staff  auth=session  domain=ai  perm=ai.manage  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai/business-setup/health/run  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai/follow-ups-center/import-sources  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/ai/follow-ups-center/tasks/{id}/edit  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/cash-drawer/approve  realm=staff  auth=session  domain=payments  perm=checkout.manage_overrides  resource=BRANCH/permission  idempotency=optional`
- `POST /pos/catalog/services/{serviceId}/pricing/revert  realm=staff  auth=session  domain=catalog  perm=pos.services.pricing.edit  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/catalog/services/{serviceId}/pricing/schedule  realm=staff  auth=session  domain=catalog  perm=pos.services.pricing.edit  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/catalog/services/{serviceId}/pricing/schedule/cancel  realm=staff  auth=session  domain=catalog  perm=pos.services.pricing.edit  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/checkout/gift-cards/{cardId}/adjust  realm=staff  auth=session  domain=checkout  perm=pos.checkout.void  resource=TENANT/records  step-up  idempotency=optional  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/churn-watch/check  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/churn-watch/customers/{id}/review  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/communications/inbox/threads/{id}/booking  realm=staff  auth=session  domain=communications  perm=pos.communications.view  resource=TENANT/records  feature=communications  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/coupons/health/run  realm=staff  auth=session  domain=deals  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-ai-settings/assistant  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-ai-settings/check  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-ai-settings/preview  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-ai-settings/thresholds  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.churn  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-intelligence/check  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-intelligence/scan  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-search/check  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/customer-timeline/check  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/deals-offers/health/run  realm=staff  auth=session  domain=deals  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/duplicate-review/check  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/duplicate-review/groups/{id}/decision  realm=staff  auth=session  domain=customers  perm=pos.customers.edit  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/duplicate-review/groups/{id}/merge  realm=staff  auth=session  domain=customers  perm=pos.customers.merge  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/duplicate-review/groups/{id}/notes  realm=staff  auth=session  domain=customers  perm=pos.customers.edit  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/duplicate-review/groups/{id}/preview  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/duplicate-review/scan  realm=staff  auth=session  domain=customers  perm=pos.customers.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/invoices/{id}/credit  realm=staff  auth=session  domain=finance  perm=pos.checkout.void  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/invoices/{id}/deliver  realm=staff  auth=session  domain=finance  perm=pos.checkout.process_payment  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/bonus-requests  realm=staff  auth=session  domain=loyalty  perm=pos.customers.loyalty.edit  resource=BRANCH/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/members/{customerId}/tier  realm=staff  auth=session  domain=loyalty  perm=pos.settings.edit  resource=TENANT/records  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/network/wallet/levels  realm=staff  auth=session  domain=loyalty  perm=pos.settings.edit  resource=TENANT/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/tiers  realm=staff  auth=session  domain=loyalty  perm=pos.settings.edit  resource=TENANT/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/loyalty/tiers/{tierId}  realm=staff  auth=session  domain=loyalty  perm=pos.settings.edit  resource=TENANT/permission  feature=loyalty  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/memberships/members/{membershipId}/first-payment  realm=staff  auth=session  domain=memberships  perm=pos.memberships.manage  resource=TENANT/records  idempotency=optional  feature=memberships  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/money-protection-center/alerts/action  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view_alerts  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/money-protection-center/check  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/money-protection-center/detection/run  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/money-protection-center/rules/save  realm=staff  auth=session  domain=ai  perm=ai_money_protection.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/rebooking/check  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/rebooking/customers/{id}/handoff  realm=staff  auth=session  domain=ai  perm=pos.booking.create  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/rebooking/customers/{id}/review  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/receipt-center/check  realm=staff  auth=session  domain=ai  perm=pos.ai_ocr_receipt.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/referral-program/health/run  realm=staff  auth=session  domain=loyalty  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/reputation-settings/check  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/reputation-settings/save  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.manage  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/reputation/check  realm=staff  auth=session  domain=ai  perm=pos.ai_review_reputation.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/retention/sms/campaigns/{campaignId}/cancel  realm=staff  auth=session  domain=marketing  perm=pos.marketing.manage  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/retention/winback/audience/picked  realm=staff  auth=session  domain=marketing  perm=pos.marketing.manage  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/reviews-center/check/run  realm=staff  auth=session  domain=customers  perm=pos.marketing.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/reviews-center/reviews/{id}/assign  realm=staff  auth=session  domain=customers  perm=pos.marketing.manage  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/service-recommendations/check  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/service-recommendations/recommendations/{id}/handoff  realm=staff  auth=session  domain=ai  perm=pos.booking.create  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/service-recommendations/recommendations/{id}/review  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=TENANT/records  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/service-recommendations/scan  realm=staff  auth=session  domain=ai  perm=pos.ai_customer_profile.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/skills-catalog  realm=staff  auth=session  domain=workforce  perm=pos.technicians.skills.edit  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/skills-catalog/assign  realm=staff  auth=session  domain=workforce  perm=pos.technicians.skills.edit  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/skills-catalog/revoke  realm=staff  auth=session  domain=workforce  perm=pos.technicians.skills.edit  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/skills-catalog/{id}/archive  realm=staff  auth=session  domain=workforce  perm=pos.technicians.skills.edit  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/tickets/{id}/tip-adjustments  realm=staff  auth=session  domain=finance  perm=tips.adjust  resource=BRANCH/records  idempotency=required`
- `POST /pos/weekly-days-off/end  realm=staff  auth=session  domain=workforce  perm=pos.technicians.schedule.edit  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /pos/weekly-days-off/preview  realm=staff  auth=session  domain=workforce  perm=pos.technicians.view  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /super-admin/advertising/ads  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.manage  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `POST /super-admin/advertising/ads/{id}/{action}  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.manage  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `POST /super-admin/advertising/media  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.manage  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `POST /super-admin/backups/restore-plans  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.plan  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `POST /super-admin/backups/restore-plans/{id}/approve  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.approve  resource=PLATFORM/realm  step-up  guards=SuperAdminGuard`
- `POST /super-admin/backups/restore-plans/{id}/cancel  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.plan  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `POST /super-admin/backups/restore-plans/{id}/execute  realm=super_admin  auth=session  domain=operations  perm=super_admin.backups.execute  resource=PLATFORM/realm  step-up  guards=SuperAdminGuard`
- `POST /super-admin/loyalty-network/fraud-alerts/{id}/account-status  realm=super_admin  auth=session  domain=loyalty  perm=super_admin.billing.manage  resource=PLATFORM/realm  step-up  guards=RolePermissionGuard,SuperAdminGuard`
- `POST /tenant/ai/receptionist/settings/check  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=TenantAuthGuard`
- `POST /tenant/ai/receptionist/settings/consent/approve  realm=staff  auth=session  domain=ai  perm=ai.manage  resource=TENANT/permission  guards=TenantAuthGuard`
- `POST /tenant/ai/usage-screen/check  realm=staff  auth=session  domain=ai  perm=ai.use  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/transfers/{id}/cancel  realm=staff  auth=session  domain=inventory  perm=inventory.transfer  resource=TENANT/records  idempotency=optional  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/transfers/{id}/receive  realm=staff  auth=session  domain=inventory  perm=inventory.transfer  resource=TENANT/records  idempotency=optional  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/units/{unitId}/dispose  realm=staff  auth=session  domain=inventory  perm=inventory.update  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/units/{unitId}/found  realm=staff  auth=session  domain=inventory  perm=inventory.stock.adjust  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/units/{unitId}/mark-expired  realm=staff  auth=session  domain=inventory  perm=inventory.update  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `POST /tenant/inventory/units/{unitId}/mark-missing  realm=staff  auth=session  domain=inventory  perm=inventory.stock.adjust  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `PUT /pos/weekly-days-off  realm=staff  auth=session  domain=workforce  perm=pos.technicians.schedule.edit  resource=BRANCH/permission  guards=RolePermissionGuard,TenantAuthGuard`
- `PUT /super-admin/advertising/ads/{id}  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.manage  resource=PLATFORM/realm  guards=SuperAdminGuard`
- `PUT /super-admin/advertising/policy  realm=super_admin  auth=session  domain=marketing  derived=super_admin.marketing.manage  resource=PLATFORM/realm  step-up  guards=SuperAdminGuard`
