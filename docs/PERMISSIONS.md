# Permissions

> GENERATED from `packages/permissions/src/permission-registry.ts` by `tooling/permissions/generate-permission-docs.mjs`. Do not edit by hand.

447 catalog keys — critical 19, high 71, medium 120, low 237; 32 need a fresh step-up to grant or use; 183 legacy `pos.*` route keys folded in as aliases.

Authorization is by PERMISSION, never by role name: a role (or template / custom role) is a set of these keys; a per-person
ALLOW / DENY override adds or removes one; DENY always wins. Scopes say where a key applies (OWN = the person's own records,
BRANCH / SELECTED_BRANCHES = the branches they may enter, TENANT = every branch). High / critical keys are listed in the
owner's high-risk report and in every access review.

## Salon (POS)

### pos

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `pos.login` | Sign in to the POS | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Sign in to the POS at all. Every staff role needs it. |  |

### dashboard

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `dashboard.view` | View dashboard | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View dashboard. | `pos.dashboard.view` `pos.overview.view` |

### global_search

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `global_search.use` | Use global search | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Use global search. |  |

### checkin

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `checkin.view` | View checkin | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View checkin. | `pos.check_in.view` |
| `checkin.manage` | Manage checkin | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Manage checkin. | `pos.check_in.appointment` `pos.check_in.assign_technician` `pos.check_in.cancel` `pos.check_in.create_customer` `pos.check_in.edit` `pos.check_in.move_to_queue` `pos.check_in.move_to_tech_queue` `pos.check_in.start_service` `pos.check_in.walk_in` |

### booking

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `booking.view` | View booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN, CUSTOMER | View booking. | `pos.booking.view` `pos.tech_appointments.view` |
| `booking.manage` | Manage booking | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN, CUSTOMER | Manage booking. | `pos.booking.assign_technician` `pos.booking.cancel` `pos.booking.check_in` `pos.booking.create` `pos.booking.edit` `pos.booking.no_show` `pos.booking.reschedule` `pos.tech_appointments.assign_technician` `pos.tech_appointments.cancel` `pos.tech_appointments.check_in` `pos.tech_appointments.create` `pos.tech_appointments.edit` `pos.tech_appointments.no_show` `pos.tech_appointments.reschedule` |
| `booking.override` | Override booking | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Double-book a technician on purpose and complete a booking without the customer's phone code. | `pos.booking.override_conflict` `pos.booking.override_verification` `pos.booking.verification_pending` |

### queue

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `queue.view` | View queue | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View queue. | `pos.queue.view` `pos.tech_queue.view` |
| `queue.manage` | Manage queue | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Manage queue. | `pos.queue.assign_technician` `pos.queue.call_next` `pos.queue.cancel` `pos.queue.create` `pos.queue.edit` `pos.queue.move_to_serving` `pos.queue.move_to_tech_queue` `pos.queue.remove` `pos.queue.update_priority` `pos.tech_queue.accept` `pos.tech_queue.create` `pos.tech_queue.decline` `pos.tech_queue.move_to_serving` `pos.tech_queue.notify_customer` `pos.tech_queue.notify_technician` `pos.tech_queue.reassign` `pos.tech_queue.report_delay` `pos.tech_queue.update_priority` `pos.tech_queue.update_services` |

### serving

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `serving.view` | View serving | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View serving. | `pos.service_done.view` `pos.serving.view` |
| `serving.manage` | Manage serving | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Manage serving. | `pos.service_done.assign_technician` `pos.service_done.notify_customer` `pos.service_done.quality_check` `pos.service_done.reopen` `pos.service_done.send_to_checkout` `pos.service_done.update_notes` `pos.serving.assign_helper` `pos.serving.assign_technician` `pos.serving.edit_services` `pos.serving.mark_done` `pos.serving.pause_resume` `pos.serving.report_delay` `pos.serving.send_to_service_done` `pos.serving.start` `pos.serving.update_notes` |

### checkout

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `checkout.view` | View checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View checkout. | `pos.ai_checkout_upsell.view` `pos.checkout.view` |
| `checkout.process_payment` | Process payment checkout | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Take payments at checkout (card, cash, gift card, split) and close tickets. | `pos.checkout.add_tip` `pos.checkout.card_payment` `pos.checkout.cash_payment` `pos.checkout.gift_card_issue` `pos.checkout.gift_card_payment` `pos.checkout.process_payment` `pos.checkout.redeem_reward` `pos.checkout.split_payment` `pos.checkout.take_payment` `pos.customer_display.operate` `pos.receipts.send` |
| `checkout.approve_refund` | Approve refund checkout | critical | BRANCH, SELECTED_BRANCHES, TENANT | yes | OWNER, MANAGER | Refund past the salon's approval threshold (cash or large refunds) and approve a refund someone else asked for. |  |
| `checkout.manage_overrides` | Manage overrides checkout | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Void tickets, override totals, apply manual discounts, refund and reopen finished services. | `payments.refund` `payments.void` `pos.checkout.apply_discount` `pos.checkout.override_inventory` `pos.checkout.override_total` `pos.checkout.refund` `pos.checkout.reopen_service` `pos.checkout.void` |

### deals

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `deals.apply` | Apply deals | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Apply deals. | `pos.deals.apply` |

### customers

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `customers.view` | View customers | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View customers. | `pos.ai_customer_profile.view` `pos.customers.view` `pos.memberships.view` |
| `customers.edit` | Edit customers | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Create and edit customer profiles. | `pos.ai_customer_profile.churn` `pos.customers.archive` `pos.customers.create` `pos.customers.edit` `pos.customers.financial.view` `pos.customers.import` `pos.customers.loyalty.edit` `pos.customers.membership.edit` `pos.customers.merge` `pos.customers.notes.edit` `pos.customers.notes.view` `pos.memberships.manage` |
| `customers.export` | Export customers | high | BRANCH, SELECTED_BRANCHES, TENANT | yes | OWNER, MANAGER | Download the customer list (names, phone numbers, emails). Every export is recorded. | `pos.customers.export` |
| `customers.phone_manage` | Phone manage customers | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Approve, resolve and manually confirm customer phone-number changes and set the phone policy. | `pos.customers.phone.approve` `pos.customers.phone.manual_confirm` `pos.customers.phone.resolve` `pos.customers.phone.retry_sync` `pos.customers.phone.settings` |

### technicians

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `technicians.view` | View technicians | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View technicians. | `pos.technicians.export` `pos.technicians.view` |
| `technicians.edit` | Edit technicians | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Hire, edit and deactivate technicians, and change their commission and payment permissions. | `pos.technicians.app_access.edit` `pos.technicians.block_time` `pos.technicians.commission.edit` `pos.technicians.create` `pos.technicians.edit` `pos.technicians.import` `pos.technicians.manage` `pos.technicians.manage_status` `pos.technicians.permissions.edit` `pos.technicians.schedule.edit` `pos.technicians.skills.edit` `pos.technicians.status_change` |
| `technicians.view_pay` | View pay technicians | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | See a technician's commission rate, commission history and payroll summary (owners and managers; never the front desk). |  |

### services

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `services.view` | View services | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View services. | `pos.bundles.view` `pos.services.export` `pos.services.view` |
| `services.edit` | Edit services | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Edit services. | `pos.bundles.archive` `pos.bundles.create` `pos.bundles.edit` `pos.services.archive` `pos.services.commission.edit` `pos.services.create` `pos.services.edit` `pos.services.import` `pos.services.pricing.edit` `pos.services.technician_mapping.edit` |

### reports

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `reports.view` | View reports | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View reports. | `pos.reports.view` |
| `reports.export` | Export reports | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Download sales, payment and staff reports. Every export is recorded. | `pos.reports.customer_view` `pos.reports.export` `pos.reports.financial_view` `pos.reports.technician_view` |

### reconciliation

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `reconciliation.view` | View reconciliation | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View reconciliation. |  |
| `reconciliation.manage` | Manage reconciliation | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Match deposits to sales, record adjustments and resolve differences in deposit reconciliation. |  |
| `reconciliation.approve` | Approve reconciliation | critical | TENANT | yes | OWNER | Approve and close a deposit reconciliation — the books for that period are final. |  |

### settings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `settings.view` | View settings | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View settings. | `pos.api_keys.view` `pos.deployments.view` `pos.devices.view` `pos.logs.view` `pos.webhooks.view` |
| `settings.edit` | Edit settings | critical | TENANT | yes | OWNER | Change salon settings, including payment processors, devices, Twilio / SMS and receipt settings. | `payment_devices.approve` `payment_devices.manage` `payment_devices.revoke` `pos.api_keys.manage` `pos.customer_display.manage` `pos.deployments.manage` `pos.devices.manage` `pos.settings.edit` `pos.webhooks.manage` |

### ai

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai.use` | Use ai | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Use ai. |  |
| `ai.manage` | Manage ai | high | TENANT | yes | OWNER | Turn AI features on or off and change their settings. |  |

### ai_business

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_business.view` | View ai business | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View ai business. | `pos.ai_business.view` |

### ai_inventory

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_inventory.view` | View ai inventory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View ai inventory. | `pos.ai_inventory.view` |
| `ai_inventory.manage_recipes` | Manage recipes ai inventory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage recipes ai inventory. |  |
| `ai_inventory.view_cost` | View cost ai inventory | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | See product cost and margin inside the AI inventory analyses. |  |

### ai_analytics

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_analytics.view` | View ai analytics | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View ai analytics. | `pos.ai_analytics.view` |

### ai_checkout_upsell

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_checkout_upsell.view` | View ai checkout upsell | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View ai checkout upsell. |  |

### subscription

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `subscription.manage` | Manage subscription | critical | TENANT | yes | OWNER | Change the salon's AIPowerSalon plan, add-ons and billing. |  |

### marketing

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `marketing.view` | View marketing | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View marketing. | `pos.ai_review_reputation.view` `pos.customer_display_ads.view` `pos.marketing.view` |
| `marketing.manage` | Manage marketing | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Create and send campaigns and promotions; manage display advertising. | `pos.ai_review_reputation.manage` `pos.customer_display_ads.archive` `pos.customer_display_ads.create` `pos.customer_display_ads.pause` `pos.customer_display_ads.publish` `pos.customer_display_ads.update` `pos.marketing.manage` |

### inventory

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.manage` | Manage inventory | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage inventory. | `pos.ai_ocr_receipt.approve` `pos.ai_ocr_receipt.manage` `pos.ai_ocr_receipt.post` |
| `inventory.view` | View inventory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View inventory. | `pos.ai_ocr_receipt.view` |
| `inventory.view_limited` | View limited inventory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, TECHNICIAN | View limited inventory. |  |
| `inventory.create` | Create inventory | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Create inventory. |  |
| `inventory.update` | Update inventory | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Update inventory. |  |
| `inventory.archive` | Archive inventory | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Archive products (they stop appearing in stock and sales). |  |
| `inventory.transfer` | Transfer inventory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Transfer inventory. |  |

### communications

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `communications.view` | View communications | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View communications. | `pos.communications.view` |
| `communications.manage` | Manage communications | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Send messages to customers and manage message templates. | `pos.communications.manage` `pos.communications.send` |

### payroll

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `payroll.view` | View payroll | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | See every technician's pay, commission and tips for a pay period. | `pos.payroll.view` |
| `payroll.manage` | Manage payroll | critical | TENANT | yes | OWNER, MANAGER | Run payroll, edit pay rules and finalize pay periods (money paid to staff). | `pos.payroll.manage` |
| `payroll.approve` | Approve payroll | critical | TENANT | yes | OWNER | Approve and lock a pay period (and reopen an approved one with a reason) — the figures every technician is paid. |  |
| `payroll.export` | Export payroll | high | TENANT |  | OWNER | Download a pay period as CSV / Excel for the accountant or a payroll provider (every export is audited). |  |
| `payroll.adjust` | Adjust payroll | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Add bonuses, corrections and configured deductions to an open pay period (large ones wait for an owner's approval). |  |
| `payroll.issue_check` | Issue check payroll | critical | TENANT | yes | OWNER, MANAGER | Issue, deliver, void and replace payroll checks for an approved pay week (check numbers are recorded). |  |
| `payroll.cash_handoff` | Cash handoff payroll | critical | TENANT | yes | OWNER, MANAGER | Prepare payroll cash (from the register drawer, the safe or the bank), hand it to a technician and take their PIN confirmation. |  |

### audit

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `audit.view` | View audit | medium | TENANT |  | OWNER, MANAGER | Read the salon's audit log. |  |

### payouts

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `payouts.manage` | Manage payouts | critical | TENANT | yes | OWNER | Record what was actually paid to technicians for an approved pay period (cash, check, direct deposit). |  |

### locations

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `locations.view` | View locations | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View locations. |  |
| `locations.create` | Create locations | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Create locations. |  |
| `locations.update` | Update locations | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Update locations. |  |
| `locations.publish` | Publish locations | medium | TENANT |  | OWNER, MANAGER | Publish a location to the customer app and marketplace. |  |
| `locations.unpublish` | Unpublish locations | medium | TENANT |  | OWNER, MANAGER | Hide a location from the customer app and marketplace. |  |
| `locations.archive` | Archive locations | high | TENANT | yes | OWNER | Archive a salon location (it stops taking bookings). |  |

### locations.map

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `locations.map.update` | Update locations map | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Update locations map. |  |

### locations.hours

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `locations.hours.manage` | Manage locations hours | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage locations hours. |  |

### locations.booking

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `locations.booking.manage` | Manage locations booking | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage locations booking. |  |

### inventory.stock

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.stock.add` | Add inventory stock | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Add inventory stock. |  |
| `inventory.stock.adjust` | Adjust inventory stock | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Correct stock counts by hand (shrinkage, damage, recount). |  |
| `inventory.stock.count` | Count inventory stock | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Count inventory stock. |  |

### inventory.purchase_order

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.purchase_order.view` | View inventory purchase order | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View inventory purchase order. |  |
| `inventory.purchase_order.create` | Create inventory purchase order | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Create inventory purchase order. |  |
| `inventory.purchase_order.approve` | Approve inventory purchase order | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Approve a purchase order — commits the salon to paying the vendor. |  |
| `inventory.purchase_order.receive` | Receive inventory purchase order | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Receive inventory purchase order. |  |

### loyalty.bonus

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `loyalty.bonus.approve` | Approve loyalty bonus | high | TENANT |  | OWNER | Approve bonus loyalty points a manager asked for — spends the salon's prepaid reward tokens. Salon owner only. |  |

### inventory.vendor

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.vendor.manage` | Manage inventory vendor | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage inventory vendor. |  |

### inventory.category

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.category.manage` | Manage inventory category | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage inventory category. |  |

### inventory.brand

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.brand.manage` | Manage inventory brand | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage inventory brand. |  |

### inventory.color

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.color.manage` | Manage inventory color | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage inventory color. |  |

### inventory.reports

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.reports.view` | View inventory reports | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View inventory reports. |  |

### inventory.cost

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.cost.view` | View inventory cost | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | See what the salon pays for products (unit cost). |  |

### inventory.value

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.value.view` | View inventory value | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | See the money value of stock on hand. |  |

### inventory.technician_report

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.technician_report.submit` | Submit inventory technician report | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, TECHNICIAN | Submit inventory technician report. |  |
| `inventory.technician_report.approve` | Approve inventory technician report | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Approve inventory technician report. |  |

### inventory.product_usage

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.product_usage.submit` | Submit inventory product usage | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, TECHNICIAN | Submit inventory product usage. |  |

### inventory.bottle

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.bottle.open` | Open inventory bottle | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, TECHNICIAN | Open inventory bottle. |  |

### inventory.barcode

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `inventory.barcode.manage` | Manage inventory barcode | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage inventory barcode. |  |

### mobile_checkout

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `mobile_checkout.login` | Login mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Login mobile checkout. |  |
| `mobile_checkout.view_queue` | View queue mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View queue mobile checkout. |  |
| `mobile_checkout.open_ticket` | Open ticket mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Open ticket mobile checkout. |  |
| `mobile_checkout.add_product` | Add product mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Add product mobile checkout. |  |
| `mobile_checkout.tip` | Tip mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Tip mobile checkout. |  |
| `mobile_checkout.split_payment` | Split payment mobile checkout | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Split one ticket across several payments on the mobile checkout. |  |
| `mobile_checkout.tap_to_pay` | Tap to pay mobile checkout | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Take card payments on an approved phone with Tap to Pay. | `payment_branch.switch` `payment_devices.register` `payments.tap_to_pay` |
| `mobile_checkout.send_receipt` | Send receipt mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Send receipt mobile checkout. |  |
| `mobile_checkout.view_history` | View history mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View history mobile checkout. |  |
| `mobile_checkout.view_reports` | View reports mobile checkout | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View reports mobile checkout. |  |
| `mobile_checkout.refund_request` | Refund request mobile checkout | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Ask for a refund from the mobile checkout (it still needs the refund approval rules). |  |
| `mobile_checkout.void_request` | Void request mobile checkout | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Ask for a void from the mobile checkout. |  |

### reception_copilot

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `reception_copilot.use` | Use reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Use reception copilot. |  |
| `reception_copilot.view_customer_context` | View customer context reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View customer context reception copilot. |  |
| `reception_copilot.view_queue` | View queue reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View queue reception copilot. |  |
| `reception_copilot.view_recommendations` | View recommendations reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View recommendations reception copilot. |  |
| `reception_copilot.view_ai_phone_activity` | View ai phone activity reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View ai phone activity reception copilot. |  |
| `reception_copilot.explain_services` | Explain services reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Explain services reception copilot. |  |
| `reception_copilot.suggest_waitlist` | Suggest waitlist reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Suggest waitlist reception copilot. |  |
| `reception_copilot.draft_messages` | Draft messages reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Draft messages reception copilot. |  |
| `reception_copilot.create_appointment` | Create appointment reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Create appointment reception copilot. |  |
| `reception_copilot.reschedule_appointment` | Reschedule appointment reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Reschedule appointment reception copilot. |  |
| `reception_copilot.cancel_appointment` | Cancel appointment reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Cancel appointment reception copilot. |  |
| `reception_copilot.send_message` | Send message reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Send message reception copilot. |  |
| `reception_copilot.take_over_calls` | Take over calls reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Take over calls reception copilot. |  |
| `reception_copilot.give_feedback` | Give feedback reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Give feedback reception copilot. |  |
| `reception_copilot.manage_settings` | Manage settings reception copilot | high | TENANT | yes | OWNER, MANAGER | Change what the Reception Copilot may do on its own. |  |
| `reception_copilot.view_learning` | View learning reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View learning reception copilot. |  |
| `reception_copilot.approve_learning` | Approve learning reception copilot | high | TENANT |  | OWNER, MANAGER | Approve what the Reception Copilot learns from the salon's conversations. |  |
| `reception_copilot.view_usage` | View usage reception copilot | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View usage reception copilot. |  |

### ai_booking

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_booking.view` | View ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View ai booking. |  |
| `ai_booking.search_availability` | Search availability ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Search availability ai booking. |  |
| `ai_booking.create` | Create ai booking | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Create ai booking. |  |
| `ai_booking.reschedule` | Reschedule ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Reschedule ai booking. |  |
| `ai_booking.cancel` | Cancel ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Cancel ai booking. |  |
| `ai_booking.confirm` | Confirm ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Confirm ai booking. |  |
| `ai_booking.override_duplicate` | Override duplicate ai booking | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Let the AI book a customer who already has an overlapping booking. |  |
| `ai_booking.override_conflict` | Override conflict ai booking | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Let the AI double-book a technician. |  |
| `ai_booking.use_alternate_branch` | Use alternate branch ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Use alternate branch ai booking. |  |
| `ai_booking.manage_partner_links` | Manage partner links ai booking | medium | TENANT |  | OWNER, MANAGER | Manage the booking partner links the AI may use. |  |
| `ai_booking.view_sources` | View sources ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View sources ai booking. |  |
| `ai_booking.view_conversion` | View conversion ai booking | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View conversion ai booking. |  |
| `ai_booking.manage_settings` | Manage settings ai booking | high | TENANT | yes | OWNER, MANAGER | Change how the AI booking assistant books, overrides and uses partner links. |  |
| `ai_booking.support_mode` | Support mode ai booking | high | TENANT |  | OWNER, MANAGER | Let platform support act inside the AI booking assistant for this salon. |  |

### ai_money_protection

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_money_protection.view` | View ai money protection | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View ai money protection. |  |
| `ai_money_protection.view_alerts` | View alerts ai money protection | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View alerts ai money protection. |  |
| `ai_money_protection.manage_rules` | Manage rules ai money protection | high | TENANT | yes | OWNER | Change what the money-protection AI treats as suspicious. |  |
| `ai_money_protection.investigate` | Investigate ai money protection | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER | Open an investigation into a flagged money anomaly (refund, void or discount pattern). |  |
| `ai_money_protection.resolve` | Resolve ai money protection | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER | Close a money-protection alert or investigation with a finding. |  |
| `ai_money_protection.escalate` | Escalate ai money protection | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER | Escalate ai money protection. |  |
| `ai_money_protection.manage_settings` | Manage settings ai money protection | high | TENANT | yes | OWNER | Turn money-protection monitoring on or off and set its thresholds. |  |
| `ai_money_protection.export` | Export ai money protection | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER | Download money-protection alerts and investigations. |  |

### ai_voice_transcription

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_voice_transcription.view` | View ai voice transcription | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View ai voice transcription. |  |
| `ai_voice_transcription.view_transcripts` | View transcripts ai voice transcription | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View transcripts ai voice transcription. |  |
| `ai_voice_transcription.manage_rules` | Manage rules ai voice transcription | medium | TENANT |  | OWNER | Change what the transcription AI flags in calls. |  |
| `ai_voice_transcription.manage_settings` | Manage settings ai voice transcription | high | TENANT | yes | OWNER | Turn call transcription on or off and set its retention. |  |
| `ai_voice_transcription.play_recording` | Play recording ai voice transcription | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER | Listen to recorded customer calls. |  |
| `ai_voice_transcription.view_raw` | View raw ai voice transcription | critical | BRANCH, SELECTED_BRANCHES, TENANT | yes | OWNER | Read unredacted call transcripts (card digits, phone numbers as spoken). |  |
| `ai_voice_transcription.delete` | Delete ai voice transcription | critical | TENANT | yes | OWNER | Delete call recordings and transcripts permanently. |  |
| `ai_voice_transcription.export` | Export ai voice transcription | high | BRANCH, SELECTED_BRANCHES, TENANT | yes | OWNER | Download call transcripts (customer conversations). |  |

### ai_queue_assignment

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_queue_assignment.view` | View ai queue assignment | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View ai queue assignment. |  |
| `ai_queue_assignment.recommend` | Recommend ai queue assignment | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Recommend ai queue assignment. |  |
| `ai_queue_assignment.assign` | Assign ai queue assignment | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Assign ai queue assignment. |  |
| `ai_queue_assignment.override` | Override ai queue assignment | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Overrule the AI's queue suggestion and lock an assignment. |  |
| `ai_queue_assignment.manage_rules` | Manage rules ai queue assignment | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Set the rotation, thresholds and rules for AI queue assignment. |  |
| `ai_queue_assignment.manage_auto` | Manage auto ai queue assignment | high | TENANT | yes | OWNER, MANAGER | Turn automatic AI queue assignment on or off. |  |
| `ai_queue_assignment.resolve_alerts` | Resolve alerts ai queue assignment | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Resolve alerts ai queue assignment. |  |
| `ai_queue_assignment.export` | Export ai queue assignment | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Download queue-assignment decisions and metrics. |  |

### ai_scheduling

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai_scheduling.view` | View ai scheduling | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View ai scheduling. |  |
| `ai_scheduling.view_own` | View own ai scheduling | low | OWN |  | OWNER, TECHNICIAN | View own ai scheduling. |  |
| `ai_scheduling.generate` | Generate ai scheduling | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Generate ai scheduling. |  |
| `ai_scheduling.review` | Review ai scheduling | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Review ai scheduling. |  |
| `ai_scheduling.approve` | Approve ai scheduling | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Approve the AI's duration, staffing and availability insights. |  |
| `ai_scheduling.apply` | Apply ai scheduling | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Apply an AI schedule change to real bookings. |  |
| `ai_scheduling.configure` | Configure ai scheduling | high | TENANT | yes | OWNER | Change scheduling-AI settings, automation and the kill switch. |  |
| `ai_scheduling.export` | Export ai scheduling | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Download scheduling recommendations and outcomes. |  |

### community.feed

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.feed.view` | View community feed | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View community feed. |  |

### community.incident

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.incident.create` | Create community incident | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Create community incident. |  |

### community.advisory

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.advisory.draft` | Draft community advisory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Draft community advisory. |  |
| `community.advisory.submit` | Submit community advisory | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Submit community advisory. |  |
| `community.advisory.approve` | Approve community advisory | medium | TENANT |  | OWNER, MANAGER | Approve a safety advisory for publication to other salons. |  |

### community.comment

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.comment.create` | Create community comment | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Create community comment. |  |

### community.evidence

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.evidence.upload` | Upload community evidence | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Upload community evidence. |  |

### community.settings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.settings.manage` | Manage community settings | medium | TENANT |  | OWNER | Change the salon's Safety Community settings. |  |

### community.report

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.report.create` | Create community report | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Create community report. |  |

### community.dispute

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.dispute.create` | Create community dispute | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Create community dispute. |  |

### community.appeal

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.appeal.create` | Create community appeal | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Create community appeal. |  |

### community

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `community.follow` | Follow community | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Follow community. |  |

### roles

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `roles.view` | View roles | medium | TENANT |  | OWNER, MANAGER | See the team's roles, permissions, branch access and the authorization audit. |  |
| `roles.manage` | Manage roles | critical | TENANT | yes | OWNER, MANAGER | Assign roles and build custom roles — never above your own permissions, never on yourself. |  |

### branch_access

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `branch_access.manage` | Manage branch access | critical | TENANT | yes | OWNER | Decide which branches each team member may sign in to. |  |

### permissions

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `permissions.override` | Override permissions | critical | TENANT | yes | OWNER | Give one person an extra permission (ALLOW, optionally temporary) or take one away (DENY). |  |

### ownership

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ownership.transfer` | Transfer ownership | critical | TENANT | yes | OWNER | Transfer ownership of the salon to another team member. |  |

### access_review

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `access_review.view` | View access review | medium | TENANT |  | OWNER | See access reviews and their decisions. |  |
| `access_review.manage` | Manage access review | critical | TENANT | yes | OWNER | Run an access review: keep, change or revoke each person's access. |  |

### security_reports

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `security_reports.view` | View security reports | high | TENANT |  | OWNER | See who holds high-risk permissions, dormant accounts and permission denials. |  |

### approvals

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `approvals.view` | View approvals | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | View approvals. |  |
| `approvals.request` | Request approvals | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Request approvals. |  |
| `approvals.decide` | Decide approvals | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Approve or reject requests (refunds over threshold, voids, discounts, purchase orders) within your limit. |  |
| `approvals.manage_policies` | Manage policies approvals | critical | TENANT | yes | OWNER | Change what needs approval, the thresholds and who may approve. |  |

### self.profile

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `self.profile.view` | View self profile | low | OWN |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View self profile. |  |
| `self.profile.edit` | Edit self profile | medium | OWN |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Edit self profile. |  |

### self

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `self.notifications` | Notifications self | low | OWN |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Notifications self. |  |

### self.operations

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `self.operations.view` | View self operations | low | OWN |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View self operations. |  |

### help

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `help.view` | View help | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | View help. |  |
| `help.request` | Request help | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN | Request help. |  |
| `help.triage` | Triage help | medium | TENANT |  | OWNER, MANAGER | See every support ticket the salon filed, triage them and file a critical (outage) ticket. |  |

### compensation

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `compensation.view_all` | View all compensation | high | TENANT |  | OWNER | See every technician's compensation plan, wage settings and earnings statements. |  |
| `compensation.manage` | Manage compensation | critical | TENANT | yes | OWNER | Change commission plans, wage configuration and technician pay agreements. |  |

### ai.control

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `ai.control.manage` | Manage ai control | high | TENANT | yes | OWNER | Change how much the salon's AI assistants may do on their own (recommend only, approval required, automation). |  |

### tips

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tips.adjust` | Adjust tips | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Re-split a ticket's tip between the technicians who worked it; after payment the change is a recorded tip adjustment. |  |

### turn_queue

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `turn_queue.read` | Read turn queue | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | See the technician turn board: who is next and why, who is serving, on break or on hold (never anyone's money). |  |
| `turn_queue.join` | Join turn queue | low | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Add a clocked-in technician to today's rotation (she joins where the salon's join rule places her). |  |
| `turn_queue.hold` | Hold turn queue | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Put a technician on queue hold and release her (a hold is not a payroll break). |  |
| `turn_queue.assign` | Assign turn queue | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER, FRONT_DESK, RECEPTION | Assign the recommended technician and record that a guest declined a technician (never costs her a turn). |  |
| `turn_queue.auto_assign` | Auto assign turn queue | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Run automatic turn assignment for the location. |  |
| `turn_queue.manual_assign` | Manual assign turn queue | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Assign someone other than the recommended technician, with a manual-override reason (audited). |  |
| `turn_queue.reorder` | Reorder turn queue | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Move a technician in the rotation (set next, before someone, to the back) with a reason — changes the future order only, history is kept. |  |
| `turn_queue.adjust` | Adjust turn queue | high | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Correct a technician's turn credit (+/− turns) for a genuine operational error, and close a business day — reason required, audited. |  |

### turn_queue.settings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `turn_queue.settings.manage` | Manage turn queue settings | high | TENANT |  | OWNER | Change the salon's turn rules: assignment mode, fairness mode, turn weights, requested / appointment / break / decline policies. |  |

### turn_queue.history

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `turn_queue.history.read` | Read turn queue history | medium | BRANCH, SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Read the turn history, the fairness dashboard and the team turn reports. |  |

## Owner App

### owner.dashboard

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.dashboard.view` | View owner dashboard | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner dashboard. |  |

### owner.branches

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.branches.view` | View owner branches | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner branches. |  |
| `owner.branches.compare` | Compare owner branches | low | SELECTED_BRANCHES, TENANT |  | OWNER | Compare owner branches. |  |

### owner.bookings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.bookings.view` | View owner bookings | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner bookings. |  |
| `owner.bookings.details` | Details owner bookings | low | SELECTED_BRANCHES, TENANT |  | OWNER | Details owner bookings. |  |

### owner.staff

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.staff.view` | View owner staff | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner staff. |  |

### owner.staff.performance

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.staff.performance.view` | View owner staff performance | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner staff performance. |  |

### owner.staff.earnings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.staff.earnings.view` | View owner staff earnings | high | SELECTED_BRANCHES, TENANT |  | OWNER | See every staff member's earnings in the Owner App. |  |

### owner.finance

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.finance.view` | View owner finance | high | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | See revenue, deposits, fees and profit in the Owner App. |  |

### owner.reports

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.reports.view` | View owner reports | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner reports. |  |
| `owner.reports.export` | Export owner reports | high | SELECTED_BRANCHES, TENANT |  | OWNER | Download Owner App reports. Every export is recorded. |  |

### owner.alerts

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.alerts.view` | View owner alerts | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner alerts. |  |
| `owner.alerts.resolve` | Resolve owner alerts | medium | SELECTED_BRANCHES, TENANT |  | OWNER | Resolve owner alerts. |  |

### owner.settings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.settings.view` | View owner settings | low | SELECTED_BRANCHES, TENANT |  | OWNER | View owner settings. |  |
| `owner.settings.edit` | Edit owner settings | high | TENANT | yes | OWNER | Change Owner App settings and the Owner Access Code. |  |

### owner.notifications

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.notifications.manage` | Manage owner notifications | medium | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Manage owner notifications. |  |

### owner.expenses

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.expenses.view` | View owner expenses | low | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | View owner expenses. |  |
| `owner.expenses.manage` | Manage owner expenses | high | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Record receipts and expenses and edit drafts — the salon's spending records. |  |
| `owner.expenses.approve` | Approve owner expenses | high | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Approve or reject receipts and expenses, void an approved one with a reason, decide suspected duplicates, correct an approved expense (audited). |  |
| `owner.expenses.export` | Export owner expenses | high | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Download expense records as CSV / Excel for the accountant or tax preparer (every export is audited). |  |
| `owner.expenses.delete_draft` | Delete draft owner expenses | medium | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Delete an expense that is still a draft (anything submitted or approved can only be voided or archived). |  |
| `owner.expenses.archive` | Archive owner expenses | medium | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Archive an expense out of the working lists, and restore it. |  |

### owner.expenses.categories

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.expenses.categories.manage` | Manage owner expenses categories | medium | TENANT |  | OWNER | Add custom expense categories, map categories to accounting codes, set categorization rules and expense settings. |  |

### owner.expenses.reimbursements

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.expenses.reimbursements.manage` | Manage owner expenses reimbursements | high | TENANT |  | OWNER | Approve and mark paid the reimbursements owed to staff who paid for salon supplies themselves. |  |

### owner.expenses.bills

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.expenses.bills.manage` | Manage owner expenses bills | high | SELECTED_BRANCHES, TENANT |  | OWNER, MANAGER | Record payments against a vendor bill (partial or full) and match them to bank / card payments. |  |

### owner.tenant_branding

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.tenant_branding.view` | View owner tenant branding | low | SELECTED_BRANCHES, TENANT |  | OWNER | View owner tenant branding. |  |
| `owner.tenant_branding.update` | Update owner tenant branding | medium | TENANT |  | OWNER | Change the salon's own logo and colours. |  |

### owner.portfolio

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `owner.portfolio.view` | View owner portfolio | low | SELECTED_BRANCHES, TENANT |  | OWNER | View owner portfolio. |  |

## Technician App

### tech.dashboard

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.dashboard.view` | View tech dashboard | low | OWN |  | OWNER, MANAGER, TECHNICIAN | View tech dashboard. |  |

### tech.schedule

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.schedule.view` | View tech schedule | low | OWN |  | OWNER, MANAGER, TECHNICIAN | View tech schedule. |  |

### tech.ticket

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.ticket.view` | View tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | View tech ticket. |  |
| `tech.ticket.accept` | Accept tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Accept tech ticket. |  |
| `tech.ticket.decline` | Decline tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Decline tech ticket. |  |
| `tech.ticket.cancel_request` | Cancel request tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Cancel request tech ticket. |  |
| `tech.ticket.transfer_request` | Transfer request tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Transfer request tech ticket. |  |
| `tech.ticket.add_addon` | Add addon tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Add addon tech ticket. |  |
| `tech.ticket.edit_lines` | Edit lines tech ticket | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Edit lines tech ticket. |  |

### tech.service

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.service.start` | Start tech service | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Start tech service. |  |
| `tech.service.complete` | Complete tech service | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Complete tech service. |  |
| `tech.service.note_add` | Note add tech service | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Note add tech service. |  |
| `tech.service.pause` | Pause tech service | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Pause tech service. |  |

### tech.break

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.break.start` | Start tech break | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Start tech break. |  |
| `tech.break.end` | End tech break | low | OWN |  | OWNER, MANAGER, TECHNICIAN | End tech break. |  |

### tech.timeclock

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.timeclock.punch` | Punch tech timeclock | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Punch tech timeclock. |  |

### tech.walkin

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.walkin.request` | Request tech walkin | low | OWN |  | OWNER, MANAGER, TECHNICIAN | Request tech walkin. |  |

### tech.earnings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.earnings.view` | View tech earnings | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | A technician sees their own earnings, tips and commission. |  |

### tech.payroll

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.payroll.view` | View tech payroll | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | A technician sees their own pay statements. |  |

### tech.profile

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.profile.edit` | Edit tech profile | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | Edit tech profile. |  |

### tech.notifications

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.notifications.manage` | Manage tech notifications | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | Manage tech notifications. |  |

### tech.time_off

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.time_off.request` | Request tech time off | low | OWN |  | OWNER, MANAGER, TECHNICIAN | A technician requests time off for herself and withdraws her own pending request (a manager decides it). |  |

### tech.turn_queue

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.turn_queue.view` | View tech turn queue | low | OWN |  | OWNER, MANAGER, TECHNICIAN | A technician sees her own turn position, status and today's turns — the rest of the team only as far as the salon's visibility setting allows, never anyone's money. |  |

### tech.followups

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.followups.manage` | Manage tech followups | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | Manage tech followups. |  |

### tech.cash

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.cash.manage` | Manage tech cash | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | Manage tech cash. |  |

### tech.deals

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `tech.deals.manage` | Manage tech deals | medium | OWN |  | OWNER, MANAGER, TECHNICIAN | Manage tech deals. |  |

## Platform (Super Admin)

### tenants

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.tenants.view` | View tenants | low | PLATFORM |  | platform roles | View tenants. |  |
| `super_admin.tenants.create` | Create tenants | medium | PLATFORM |  | platform roles | Create tenants. |  |
| `super_admin.tenants.edit` | Edit tenants | medium | PLATFORM |  | platform roles | Edit tenants. |  |
| `super_admin.tenants.suspend` | Suspend tenants | low | PLATFORM |  | platform roles | Suspend tenants. |  |

### users

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.users.manage` | Manage users | medium | PLATFORM |  | platform roles | Manage users. |  |
| `super_admin.users.view` | View users | low | PLATFORM |  | platform roles | View users. |  |

### subscriptions

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.subscriptions.manage` | Manage subscriptions | medium | PLATFORM |  | platform roles | Manage subscriptions. |  |

### billing

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.view` | View billing | low | PLATFORM |  | platform roles | View billing. |  |
| `super_admin.billing.pause` | Pause billing | low | PLATFORM |  | platform roles | Pause billing. |  |
| `super_admin.billing.cancel` | Cancel billing | low | PLATFORM |  | platform roles | Cancel billing. |  |
| `super_admin.billing.export` | Export billing | high | PLATFORM |  | platform roles | Export billing. |  |
| `super_admin.billing.manage` | Manage billing | medium | PLATFORM |  | platform roles | Manage billing. |  |

### billing.invoices

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.invoices.create` | Create billing invoices | medium | PLATFORM |  | platform roles | Create billing invoices. |  |
| `super_admin.billing.invoices.finalize` | Finalize billing invoices | low | PLATFORM |  | platform roles | Finalize billing invoices. |  |

### billing.credits

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.credits.apply` | Apply billing credits | low | PLATFORM |  | platform roles | Apply billing credits. |  |

### billing.payments

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.payments.retry` | Retry billing payments | low | PLATFORM |  | platform roles | Retry billing payments. |  |

### billing.plans

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.plans.change` | Change billing plans | low | PLATFORM |  | platform roles | Change billing plans. |  |

### billing.addons

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.addons.manage` | Manage billing addons | medium | PLATFORM |  | platform roles | Manage billing addons. |  |

### billing.trials

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.trials.extend` | Extend billing trials | low | PLATFORM |  | platform roles | Extend billing trials. |  |

### billing.discounts

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.discounts.manage` | Manage billing discounts | medium | PLATFORM |  | platform roles | Manage billing discounts. |  |

### billing.requests

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.billing.requests.review` | Review billing requests | low | PLATFORM |  | platform roles | Review billing requests. |  |

### ai_packages

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.ai_packages.manage` | Manage ai packages | medium | PLATFORM |  | platform roles | Manage ai packages. |  |

### catalog

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.catalog.manage` | Manage catalog | medium | PLATFORM |  | platform roles | Manage catalog. |  |
| `super_admin.catalog.view` | View catalog | low | PLATFORM |  | platform roles | View catalog. |  |

### disputes

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.disputes.view` | View disputes | low | PLATFORM |  | platform roles | View disputes. |  |
| `super_admin.disputes.manage` | Manage disputes | medium | PLATFORM |  | platform roles | Manage disputes. |  |
| `super_admin.disputes.override` | Override disputes | high | PLATFORM |  | platform roles | Override disputes. |  |
| `super_admin.disputes.export` | Export disputes | high | PLATFORM |  | platform roles | Export disputes. |  |

### disputes.evidence

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.disputes.evidence.submit` | Submit disputes evidence | low | PLATFORM |  | platform roles | Submit disputes evidence. |  |

### disputes.outcome

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.disputes.outcome.record` | Record disputes outcome | low | PLATFORM |  | platform roles | Record disputes outcome. |  |

### disputes.risk

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.disputes.risk.flag` | Flag disputes risk | low | PLATFORM |  | platform roles | Flag disputes risk. |  |

### memberships

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.memberships.view` | View memberships | low | PLATFORM |  | platform roles | View memberships. |  |
| `super_admin.memberships.manage` | Manage memberships | medium | PLATFORM |  | platform roles | Manage memberships. |  |
| `super_admin.memberships.export` | Export memberships | high | PLATFORM |  | platform roles | Export memberships. |  |
| `super_admin.memberships.support_mode` | Support mode memberships | high | PLATFORM |  | platform roles | Support mode memberships. |  |
| `super_admin.memberships.correct` | Correct memberships | low | PLATFORM |  | platform roles | Correct memberships. |  |
| `super_admin.memberships.disable` | Disable memberships | low | PLATFORM |  | platform roles | Disable memberships. |  |

### audit_logs

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.audit_logs.view` | View audit logs | low | PLATFORM |  | platform roles | View audit logs. |  |

### customer_sync

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.customer_sync.view` | View customer sync | low | PLATFORM |  | platform roles | View customer sync. |  |
| `super_admin.customer_sync.run` | Run customer sync | low | PLATFORM |  | platform roles | Run customer sync. |  |
| `super_admin.customer_sync.review` | Review customer sync | low | PLATFORM |  | platform roles | Review customer sync. |  |
| `super_admin.customer_sync.merge` | Merge customer sync | low | PLATFORM |  | platform roles | Merge customer sync. |  |
| `super_admin.customer_sync.resolve_conflict` | Resolve conflict customer sync | low | PLATFORM |  | platform roles | Resolve conflict customer sync. |  |

### applications

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.applications.view` | View applications | low | PLATFORM |  | platform roles | View applications. |  |
| `super_admin.applications.review` | Review applications | low | PLATFORM |  | platform roles | Review applications. |  |
| `super_admin.applications.assign` | Assign applications | medium | PLATFORM |  | platform roles | Assign applications. |  |
| `super_admin.applications.contact` | Contact applications | low | PLATFORM |  | platform roles | Contact applications. |  |
| `super_admin.applications.note` | Note applications | low | PLATFORM |  | platform roles | Note applications. |  |
| `super_admin.applications.update_status` | Update status applications | low | PLATFORM |  | platform roles | Update status applications. |  |
| `super_admin.applications.approve` | Approve applications | medium | PLATFORM |  | platform roles | Approve applications. |  |
| `super_admin.applications.reject` | Reject applications | low | PLATFORM |  | platform roles | Reject applications. |  |
| `super_admin.applications.convert` | Convert applications | low | PLATFORM |  | platform roles | Convert applications. |  |
| `super_admin.applications.view_sensitive` | View sensitive applications | low | PLATFORM |  | platform roles | View sensitive applications. |  |
| `super_admin.applications.export` | Export applications | high | PLATFORM |  | platform roles | Export applications. |  |
| `super_admin.applications.archive` | Archive applications | high | PLATFORM |  | platform roles | Archive applications. |  |

### onboarding

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.onboarding.view` | View onboarding | low | PLATFORM |  | platform roles | View onboarding. |  |
| `super_admin.onboarding.create` | Create onboarding | medium | PLATFORM |  | platform roles | Create onboarding. |  |
| `super_admin.onboarding.assign_specialist` | Assign specialist onboarding | low | PLATFORM |  | platform roles | Assign specialist onboarding. |  |
| `super_admin.onboarding.review` | Review onboarding | low | PLATFORM |  | platform roles | Review onboarding. |  |
| `super_admin.onboarding.approve` | Approve onboarding | medium | PLATFORM |  | platform roles | Approve onboarding. |  |
| `super_admin.onboarding.reject` | Reject onboarding | low | PLATFORM |  | platform roles | Reject onboarding. |  |
| `super_admin.onboarding.return_for_correction` | Return for correction onboarding | low | PLATFORM |  | platform roles | Return for correction onboarding. |  |
| `super_admin.onboarding.activate` | Activate onboarding | low | PLATFORM |  | platform roles | Activate onboarding. |  |
| `super_admin.onboarding.export` | Export onboarding | high | PLATFORM |  | platform roles | Export onboarding. |  |
| `super_admin.onboarding.manage` | Manage onboarding | medium | PLATFORM |  | platform roles | Manage onboarding. |  |

### onboarding.identity

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.onboarding.identity.override` | Override onboarding identity | high | PLATFORM |  | platform roles | Override onboarding identity. |  |

### onboarding.data_import

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.onboarding.data_import.approve` | Approve onboarding data import | medium | PLATFORM |  | platform roles | Approve onboarding data import. |  |

### onboarding.notes

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.onboarding.notes.view` | View onboarding notes | low | PLATFORM |  | platform roles | View onboarding notes. |  |
| `super_admin.onboarding.notes.create` | Create onboarding notes | medium | PLATFORM |  | platform roles | Create onboarding notes. |  |

### onboarding.audit

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.onboarding.audit.view` | View onboarding audit | low | PLATFORM |  | platform roles | View onboarding audit. |  |

### integrations

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.view` | View integrations | low | PLATFORM |  | platform roles | View integrations. |  |
| `super_admin.integrations.search` | Search integrations | low | PLATFORM |  | platform roles | Search integrations. |  |
| `super_admin.integrations.create` | Create integrations | medium | PLATFORM |  | platform roles | Create integrations. |  |
| `super_admin.integrations.edit` | Edit integrations | medium | PLATFORM |  | platform roles | Edit integrations. |  |
| `super_admin.integrations.enable` | Enable integrations | low | PLATFORM |  | platform roles | Enable integrations. |  |
| `super_admin.integrations.disable` | Disable integrations | low | PLATFORM |  | platform roles | Disable integrations. |  |
| `super_admin.integrations.export` | Export integrations | high | PLATFORM |  | platform roles | Export integrations. |  |
| `super_admin.integrations.manage` | Manage integrations | medium | PLATFORM |  | platform roles | Manage integrations. |  |

### integrations.details

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.details.view` | View integrations details | low | PLATFORM |  | platform roles | View integrations details. |  |

### integrations.connection

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.connection.test` | Test integrations connection | low | PLATFORM |  | platform roles | Test integrations connection. |  |

### integrations.authentication

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.authentication.refresh` | Refresh integrations authentication | low | PLATFORM |  | platform roles | Refresh integrations authentication. |  |

### integrations.sync

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.sync.view` | View integrations sync | low | PLATFORM |  | platform roles | View integrations sync. |  |
| `super_admin.integrations.sync.retry` | Retry integrations sync | low | PLATFORM |  | platform roles | Retry integrations sync. |  |

### integrations.webhooks

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.webhooks.view` | View integrations webhooks | low | PLATFORM |  | platform roles | View integrations webhooks. |  |

### integrations.webhooks.details

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.webhooks.details.view` | View integrations webhooks details | low | PLATFORM |  | platform roles | View integrations webhooks details. |  |

### integrations.errors

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.errors.view` | View integrations errors | low | PLATFORM |  | platform roles | View integrations errors. |  |

### integrations.api_health

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.api_health.view` | View integrations api health | low | PLATFORM |  | platform roles | View integrations api health. |  |

### integrations.tenant_access

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.tenant_access.view` | View integrations tenant access | low | PLATFORM |  | platform roles | View integrations tenant access. |  |
| `super_admin.integrations.tenant_access.manage` | Manage integrations tenant access | medium | PLATFORM |  | platform roles | Manage integrations tenant access. |  |

### integrations.marketplace

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.marketplace.view` | View integrations marketplace | low | PLATFORM |  | platform roles | View integrations marketplace. |  |

### integrations.audit

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.audit.view` | View integrations audit | low | PLATFORM |  | platform roles | View integrations audit. |  |

### integrations.compromised

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.compromised.disable` | Disable integrations compromised | low | PLATFORM |  | platform roles | Disable integrations compromised. |  |

### integrations.cross_tenant

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.cross_tenant.view` | View integrations cross tenant | low | PLATFORM |  | platform roles | View integrations cross tenant. |  |
| `super_admin.integrations.cross_tenant.export` | Export integrations cross tenant | high | PLATFORM |  | platform roles | Export integrations cross tenant. |  |

### integrations.credentials

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.credentials.view` | View integrations credentials | high | PLATFORM |  | platform roles | View integrations credentials. |  |
| `super_admin.integrations.credentials.manage` | Manage integrations credentials | high | PLATFORM |  | platform roles | Manage integrations credentials. |  |
| `super_admin.integrations.credentials.rotate` | Rotate integrations credentials | high | PLATFORM |  | platform roles | Rotate integrations credentials. |  |

### integrations.raw_payload

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.raw_payload.view` | View integrations raw payload | low | PLATFORM |  | platform roles | View integrations raw payload. |  |

### integrations.shared_connection

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.shared_connection.manage` | Manage integrations shared connection | medium | PLATFORM |  | platform roles | Manage integrations shared connection. |  |

### integrations.production_webhook

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.integrations.production_webhook.manage` | Manage integrations production webhook | medium | PLATFORM |  | platform roles | Manage integrations production webhook. |  |

### branding

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.branding.view` | View branding | low | PLATFORM |  | platform roles | View branding. |  |
| `super_admin.branding.update` | Update branding | medium | PLATFORM |  | platform roles | Update branding. |  |

### branding.asset

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.branding.asset.upload` | Upload branding asset | low | PLATFORM |  | platform roles | Upload branding asset. |  |
| `super_admin.branding.asset.restore` | Restore branding asset | low | PLATFORM |  | platform roles | Restore branding asset. |  |

### general_settings

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.general_settings.view` | View general settings | low | PLATFORM |  | platform roles | View general settings. |  |
| `super_admin.general_settings.edit` | Edit general settings | medium | PLATFORM |  | platform roles | Edit general settings. |  |
| `super_admin.general_settings.reset` | Reset general settings | low | PLATFORM |  | platform roles | Reset general settings. |  |

### system_operations

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.system_operations.view` | View system operations | low | PLATFORM |  | platform roles | View system operations. |  |

### database

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.database.view` | View database | low | PLATFORM |  | platform roles | View database. |  |
| `super_admin.database.manage` | Manage database | medium | PLATFORM |  | platform roles | Manage database. |  |

### backups

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.backups.view` | View backups | low | PLATFORM |  | platform roles | View backups. |  |
| `super_admin.backups.plan` | Plan backups | low | PLATFORM |  | platform roles | Plan backups. |  |
| `super_admin.backups.approve` | Approve backups | medium | PLATFORM |  | platform roles | Approve backups. |  |
| `super_admin.backups.execute` | Execute backups | low | PLATFORM |  | platform roles | Execute backups. |  |

### mobile_versions

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.mobile_versions.view` | View mobile versions | low | PLATFORM |  | platform roles | View mobile versions. |  |
| `super_admin.mobile_versions.manage` | Manage mobile versions | medium | PLATFORM |  | platform roles | Manage mobile versions. |  |

### telemetry

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.telemetry.view` | View telemetry | low | PLATFORM |  | platform roles | View telemetry. |  |

### telemetry.sensitive

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.telemetry.sensitive.view` | View telemetry sensitive | low | PLATFORM |  | platform roles | View telemetry sensitive. |  |

### general_settings.legal_documents

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.general_settings.legal_documents.view` | View general settings legal documents | low | PLATFORM |  | platform roles | View general settings legal documents. |  |
| `super_admin.general_settings.legal_documents.manage` | Manage general settings legal documents | medium | PLATFORM |  | platform roles | Manage general settings legal documents. |  |
| `super_admin.general_settings.legal_documents.publish` | Publish general settings legal documents | medium | PLATFORM |  | platform roles | Publish general settings legal documents. |  |

### general_settings.maintenance

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.general_settings.maintenance.view` | View general settings maintenance | low | PLATFORM |  | platform roles | View general settings maintenance. |  |
| `super_admin.general_settings.maintenance.manage` | Manage general settings maintenance | medium | PLATFORM |  | platform roles | Manage general settings maintenance. |  |

### general_settings.business_categories

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.general_settings.business_categories.view` | View general settings business categories | low | PLATFORM |  | platform roles | View general settings business categories. |  |
| `super_admin.general_settings.business_categories.manage` | Manage general settings business categories | medium | PLATFORM |  | platform roles | Manage general settings business categories. |  |

### general_settings.tenant_presets

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.general_settings.tenant_presets.view` | View general settings tenant presets | low | PLATFORM |  | platform roles | View general settings tenant presets. |  |
| `super_admin.general_settings.tenant_presets.manage` | Manage general settings tenant presets | medium | PLATFORM |  | platform roles | Manage general settings tenant presets. |  |

### platform_locations

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.platform_locations.view` | View platform locations | low | PLATFORM |  | platform roles | View platform locations. |  |
| `super_admin.platform_locations.verify` | Verify platform locations | low | PLATFORM |  | platform roles | Verify platform locations. |  |
| `super_admin.platform_locations.reject` | Reject platform locations | low | PLATFORM |  | platform roles | Reject platform locations. |  |
| `super_admin.platform_locations.suspend` | Suspend platform locations | low | PLATFORM |  | platform roles | Suspend platform locations. |  |
| `super_admin.platform_locations.correct` | Correct platform locations | low | PLATFORM |  | platform roles | Correct platform locations. |  |

### platform_locations.audit

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.platform_locations.audit.view` | View platform locations audit | low | PLATFORM |  | platform roles | View platform locations audit. |  |

### sms_packages

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.sms_packages.view` | View sms packages | low | PLATFORM |  | platform roles | View sms packages. |  |
| `super_admin.sms_packages.manage` | Manage sms packages | medium | PLATFORM |  | platform roles | Manage sms packages. |  |

### sms_tenant_plan

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.sms_tenant_plan.view` | View sms tenant plan | low | PLATFORM |  | platform roles | View sms tenant plan. |  |
| `super_admin.sms_tenant_plan.change` | Change sms tenant plan | low | PLATFORM |  | platform roles | Change sms tenant plan. |  |

### sms_usage

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.sms_usage.view` | View sms usage | low | PLATFORM |  | platform roles | View sms usage. |  |
| `super_admin.sms_usage.adjust` | Adjust sms usage | medium | PLATFORM |  | platform roles | Adjust sms usage. |  |

### sms_billing

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.sms_billing.view` | View sms billing | low | PLATFORM |  | platform roles | View sms billing. |  |
| `super_admin.sms_billing.adjust` | Adjust sms billing | medium | PLATFORM |  | platform roles | Adjust sms billing. |  |

### sms_emergency

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.sms_emergency.disable` | Disable sms emergency | low | PLATFORM |  | platform roles | Disable sms emergency. |  |

### technicians

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.technicians.view` | View technicians | low | PLATFORM |  | platform roles | View technicians. |  |
| `super_admin.technicians.manage` | Manage technicians | medium | PLATFORM |  | platform roles | Manage technicians. |  |
| `super_admin.technicians.pause` | Pause technicians | low | PLATFORM |  | platform roles | Pause technicians. |  |
| `super_admin.technicians.reactivate` | Reactivate technicians | low | PLATFORM |  | platform roles | Reactivate technicians. |  |
| `super_admin.technicians.suspend` | Suspend technicians | low | PLATFORM |  | platform roles | Suspend technicians. |  |
| `super_admin.technicians.restore` | Restore technicians | low | PLATFORM |  | platform roles | Restore technicians. |  |
| `super_admin.technicians.transfer` | Transfer technicians | low | PLATFORM |  | platform roles | Transfer technicians. |  |
| `super_admin.technicians.memberships_manage` | Memberships manage technicians | low | PLATFORM |  | platform roles | Memberships manage technicians. |  |
| `super_admin.technicians.profile_moderate` | Profile moderate technicians | low | PLATFORM |  | platform roles | Profile moderate technicians. |  |
| `super_admin.technicians.support_mode` | Support mode technicians | high | PLATFORM |  | platform roles | Support mode technicians. |  |
| `super_admin.technicians.merge` | Merge technicians | low | PLATFORM |  | platform roles | Merge technicians. |  |
| `super_admin.technicians.delete_request` | Delete request technicians | low | PLATFORM |  | platform roles | Delete request technicians. |  |
| `super_admin.technicians.anonymize` | Anonymize technicians | high | PLATFORM |  | platform roles | Anonymize technicians. |  |
| `super_admin.technicians.hard_delete` | Hard delete technicians | high | PLATFORM |  | platform roles | Hard delete technicians. |  |
| `super_admin.technicians.security_manage` | Security manage technicians | low | PLATFORM |  | platform roles | Security manage technicians. |  |

### analytics

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.analytics.view` | View analytics | low | PLATFORM |  | platform roles | View analytics. |  |
| `super_admin.analytics.manage` | Manage analytics | medium | PLATFORM |  | platform roles | Manage analytics. |  |

### plans

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.plans.view` | View plans | low | PLATFORM |  | platform roles | View plans. |  |
| `super_admin.plans.manage` | Manage plans | medium | PLATFORM |  | platform roles | Manage plans. |  |

### payments

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.payments.view` | View payments | low | PLATFORM |  | platform roles | View payments. |  |
| `super_admin.payments.manage` | Manage payments | medium | PLATFORM |  | platform roles | Manage payments. |  |

### communications

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.communications.view` | View communications | low | PLATFORM |  | platform roles | View communications. |  |
| `super_admin.communications.manage` | Manage communications | medium | PLATFORM |  | platform roles | Manage communications. |  |

### marketing

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.marketing.view` | View marketing | low | PLATFORM |  | platform roles | View marketing. |  |
| `super_admin.marketing.manage` | Manage marketing | medium | PLATFORM |  | platform roles | Manage marketing. |  |

### ai

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.ai.view` | View ai | low | PLATFORM |  | platform roles | View ai. |  |
| `super_admin.ai.manage` | Manage ai | high | PLATFORM |  | platform roles | Manage ai. |  |

### customers

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.customers.view` | View customers | low | PLATFORM |  | platform roles | View customers. |  |
| `super_admin.customers.manage` | Manage customers | medium | PLATFORM |  | platform roles | Manage customers. |  |

### operations

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.operations.view` | View operations | low | PLATFORM |  | platform roles | View operations. |  |
| `super_admin.operations.manage` | Manage operations | medium | PLATFORM |  | platform roles | Manage operations. |  |

### support

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.support.view` | View support | low | PLATFORM |  | platform roles | View support. |  |
| `super_admin.support.manage` | Manage support | medium | PLATFORM |  | platform roles | Manage support. |  |

### system

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.system.manage` | Manage system | medium | PLATFORM |  | platform roles | Manage system. |  |

### security

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.security.view` | View security | low | PLATFORM |  | platform roles | View security. |  |
| `super_admin.security.manage` | Manage security | medium | PLATFORM |  | platform roles | Manage security. |  |

### audit

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.audit.manage` | Manage audit | medium | PLATFORM |  | platform roles | Manage audit. |  |

### platform_roles

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.platform_roles.manage` | Manage platform roles | critical | PLATFORM | yes | platform roles | Manage platform roles. |  |

### tickets

| Key | Label | Sensitivity | Scopes | Step-up | Default roles | Description | Legacy aliases |
|---|---|---|---|---|---|---|---|
| `super_admin.tickets.remove` | Remove tickets | low | PLATFORM |  | platform roles | Remove tickets. |  |

