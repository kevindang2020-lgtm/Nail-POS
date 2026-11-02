// modules/appointments — the appointments domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { TechAppointmentsModule } from './tech-appointments/tech-appointments.module';
export * from './tech-appointments/tech-appointments.dto';
export { recordAppointmentChanges } from './appointments/appointment-change-log';   // used by the API today
export { resolveCatalogLines, CatalogLineError, PRICE_OVERRIDE_PERMISSION, type CatalogService, type CatalogLineInput, type ResolvedCatalogLine } from './appointments/catalog-lines';   // booking, check-in, queue, tech-queue (Oct 1)
export { KyselyTechApptRepository } from './tech-appointments/tech-appointments.kysely.repository';   // used by the API today
export { TechAppointmentsService } from './tech-appointments/tech-appointments.service';   // used by the API today
export { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from './appointments/front-desk-lifecycles';   // Phase 12 (#27): booking, queue
// Merge Oct 12 2026 (other-chat booking concurrency): the ONE technician-day slot guard for every writer of a technician's
// time on pos_tech_appointments (booking, tech-appointments, live schedule, customer booking) and the ONE manager-override rule.
export { writeAppointmentSlot, detectSlotConflict, isOverlapViolation, techDayLockKey, overbookColumns, AppointmentSlotConflict, AppointmentVersionConflict, type SlotWrite, type SlotOverlap } from './appointments/appointment-slot-guard';
export { resolveManagerOverride, ManagerOverrideForbiddenError, MANAGER_OVERRIDE_PERMISSION, type ManagerOverrideUse } from './appointments/manager-override';
export { AppointmentWriter, type NewAppointmentRow, type AppointmentActor } from './appointments/appointment-writer';   // Oct 21 2026: THE one place an appointment row is born
