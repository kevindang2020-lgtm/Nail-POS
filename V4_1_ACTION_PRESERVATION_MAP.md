# V4_1_ACTION_PRESERVATION_MAP — current half

Every working action in the current POS, derived from the actual controllers (route + server-enforced permission).
This is the contract for §9: after the old `_4_1.html` look is applied, **none** of these may become a dead click.
The **Old visual trigger** and **Preserved? / Test** columns fill in during the restyle + functional regression pass;
they're marked `pending` until then. (Tenant/branch/role are derived server-side on every one of these.)

Legend: each row = `Action → POST/PATCH endpoint (under the screen's base path) → required permission`. Old trigger: `pending _4_1.html`.

## Check-In (`/pos/check-in`, base `/pos/check-in`)
| Action | Endpoint | Permission |
|---|---|---|
| Walk-in check-in | `POST walk-in` | `pos.check_in.walk_in` |
| Appointment check-in | `POST appointment/:id` | `pos.check_in.appointment` |
| New customer | `POST create-customer` | `pos.customers.create` |
| Edit services | `POST :id/update-services` | `pos.check_in.edit` |
| Assign technician | `POST :id/assign-technician` | `pos.check_in.assign_technician` |
| Update wait estimate | `POST :id/update-wait-estimate` | `pos.check_in.edit` |
| Move to queue | `POST :id/move-to-queue` | `pos.check_in.move_to_queue` |
| Move to tech queue | `POST :id/move-to-tech-queue` | `pos.check_in.move_to_tech_queue` |
| Start service | `POST :id/start-service` | `pos.check_in.start_service` |
| Cancel | `POST :id/cancel` | `pos.check_in.cancel` |

## Queue (`/pos/queue`, base `/pos/queue`)
| Action | Endpoint | Permission |
|---|---|---|
| Create item | `POST items` | `pos.queue.create` |
| Edit item | `PATCH items/:id` | `pos.queue.edit` |
| Call next | `POST items/:id/call-next` | `pos.queue.call_next` |
| Assign / Unassign tech | `POST items/:id/assign-technician` · `.../unassign-technician` | `pos.queue.assign_technician` |
| Update services | `POST items/:id/update-services` | `pos.queue.edit` |
| Update priority | `POST items/:id/update-priority` | `pos.queue.update_priority` |
| Notify customer | `POST items/:id/notify-customer` | `pos.queue.edit` |
| Move to tech queue | `POST items/:id/move-to-tech-queue` | `pos.queue.move_to_tech_queue` |
| Start service / move to serving | `POST items/:id/start-service` · `.../move-to-serving` | `pos.queue.move_to_serving` |
| Cancel / Remove | `POST items/:id/cancel` · `.../remove` | `pos.queue.cancel` · `pos.queue.remove` |

## Serving (`/pos/serving`, base `/pos/serving`)
| Action | Endpoint | Permission |
|---|---|---|
| Start | `POST tickets/:id/start` | `pos.serving.start` |
| Pause / Resume | `POST tickets/:id/pause` · `.../resume` | `pos.serving.pause_resume` |
| Update notes | `POST tickets/:id/update-notes` | `pos.serving.update_notes` |
| Add / edit / remove service | `POST tickets/:id/add-service` · `PATCH .../services/:lineId` · `POST .../remove-service` | `pos.serving.edit_services` |
| Assign technician / helper | `POST tickets/:id/assign-technician` · `.../assign-helper` | `pos.serving.assign_technician` · `pos.serving.assign_helper` |
| Mark service done | `POST tickets/:id/mark-service-done` | `pos.serving.mark_done` |
| Send to Service Done | `POST tickets/:id/send-to-service-done` | `pos.serving.send_to_service_done` |
| Report / clear delay | `POST tickets/:id/report-delay` · `.../clear-delay` | `pos.serving.report_delay` |

## Service Done (`/pos/service-done`, base `/pos/service-done`)
| Action | Endpoint | Permission |
|---|---|---|
| Quality check | `POST tickets/:id/quality-check` | `pos.service_done.quality_check` |
| Update notes | `POST tickets/:id/update-notes` | `pos.service_done.update_notes` |
| Assign technician / helper | `POST tickets/:id/assign-technician` · `.../assign-helper` | `pos.service_done.assign_technician` |
| Mark ready / send to checkout | `POST tickets/:id/mark-ready-for-checkout` · `.../send-to-checkout` | `pos.service_done.send_to_checkout` |
| Notify customer | `POST tickets/:id/notify-customer` | `pos.service_done.notify_customer` |
| Reopen service | `POST tickets/:id/reopen-service` | `pos.service_done.reopen` |

## Checkout (`/pos/checkout`, base `/pos/checkout`)
| Action | Endpoint | Permission |
|---|---|---|
| Review | `POST tickets/:id/review` | `pos.checkout.view` |
| Send to customer display | `POST tickets/:id/send-to-customer-display` | `pos.customer_display.manage` |
| Apply tip | `POST tickets/:id/apply-tip` | `pos.checkout.add_tip` |
| Apply discount | `POST tickets/:id/apply-discount` | `pos.checkout.apply_discount` |
| Recalculate | `POST tickets/:id/recalculate` | `pos.checkout.view` |
| Reopen service | `POST tickets/:id/reopen-service` | `pos.checkout.reopen_service` |
| Pay cash / card / gift / split | `POST tickets/:id/pay/{cash,card,gift-card,split}` | `pos.checkout.take_payment` |
| Gift cards issue/reload/void | `POST gift-cards` · `.../:code/reload` · `.../:code/void` | `pos.checkout.gift_card_issue` |
| Receipt sms/email/app/all | `POST tickets/:id/receipt/{sms,email,app,send-all}` | `pos.receipts.send` |
| Refund | `POST payments/:paymentId/refund` | `pos.checkout.refund` |

## Customers (`/pos/customers`, base `/pos/customers`)
| Action | Endpoint | Permission |
|---|---|---|
| Merge duplicates | `POST duplicates/:groupId/merge` | `pos.customers.merge` |
| Create / Import | `POST ` · `POST import` | `pos.customers.create` · `pos.customers.import` |
| Archive / Reactivate | `POST :id/archive` · `.../reactivate` | `pos.customers.archive` |
| Edit notes / tags / profile | `PATCH :id/notes` · `.../tags` · `PATCH :id` | `pos.customers.notes.edit` · `pos.customers.edit` |
| Edit loyalty / membership | `PATCH :id/loyalty` · `.../membership` | `pos.customers.loyalty.edit` · `pos.customers.membership.edit` |

## Technicians (`/pos/technicians`, base `/pos/technicians`)
| Action | Endpoint | Permission |
|---|---|---|
| Create / Import | `POST ` · `POST import` | `pos.technicians.create` · `pos.technicians.import` |
| Activate/Suspend/Archive/Reactivate | `POST :id/{activate,suspend,archive,reactivate}` | `pos.technicians.status_change` |
| Edit schedule / shifts | `PATCH :id/schedule` · `.../shifts` | `pos.technicians.schedule.edit` |
| Edit skills / services | `PATCH :id/skills` · `.../services` | `pos.technicians.skills.edit` |
| Edit commission | `PATCH :id/commission` | `pos.technicians.commission.edit` |
| App access / permissions | `PATCH :id/app-access` · `.../permissions` | `pos.technicians.app_access.edit` · `pos.technicians.permissions.edit` |
| Edit profile | `PATCH :id` | `pos.technicians.edit` |

## Booking (`/pos/booking`, base `/pos/booking`)
| Action | Endpoint | Permission |
|---|---|---|
| Create appointment | `POST appointments` | `pos.booking.create` |
| Check conflicts | `POST conflicts/check` | `pos.booking.view` |
| Edit / Reschedule | `PATCH appointments/:id` · `POST .../reschedule` | `pos.booking.edit` · `pos.booking.reschedule` |
| Check-in / Cancel / No-show | `POST appointments/:id/{check-in,cancel,no-show}` | `pos.booking.check_in` · `.cancel` · `.no_show` |
| Assign technician | `POST appointments/:id/assign-technician` | `pos.booking.assign_technician` |
| Move to queue / tech queue | `POST appointments/:id/move-to-queue` · `.../move-to-tech-queue` | `pos.queue.create` · `pos.tech_queue.create` |
| Start service | `POST appointments/:id/start-service` | `pos.serving.start` |

## Not yet enumerated here (fill during restyle)
`overview`, `dashboard`, `tech-queue`, `tech-appointments`, `services`, `reports`, `settings`, and the customer-display
routes — same method: pull `@Post/@Patch + @RequirePermission` from each controller. These are mostly read + a smaller
set of actions; they get the same row treatment when their screens are restyled.

## How this is used
During the restyle, each screen's edit ends with: confirm every action above still fires its endpoint (network tab /
the existing screen test), and that permission gating is unchanged. Any row that can't be re-confirmed is logged in
`FUNCTIONAL_REGRESSION_REPORT.md` / `REMAINING_BLOCKERS.md` rather than silently dropped.
