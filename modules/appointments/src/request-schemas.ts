// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the appointments module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from TechAppointmentsService (the fields each method reads) and pos-web
// (posTechAppointmentsApi + POSTechAppointmentsScreen) — every body sent today passes; unknown fields are stripped;
// tenantId / permissions sent where undeclared are refused.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const flag: BodySchema = S.nullable(S.boolean());
/** the screen sends an ISO date-time as startTime today (the service trims it to HH:MM) — any bounded string */
const time: BodySchema = str(40);
const ids: BodySchema = S.nullable(S.array(S.text(64), { maxItems: 50 }));
/** Smooth Refresh §14–§16 (merge Oct 12 2026): the version the client last saw — a stale copy gets 409 VERSION_CONFLICT */
const version: BodySchema = S.nullable(S.integer({ minimum: 0 }));

export const TA_CREATE_BODY: BodySchema = S.object({
  technicianId: str(64), customerId: str(64), customerName: str(200), customerPhone: str(40), serviceIds: ids,
  date: str(10), startTime: time, source: str(32), notes: str(2000), isVip: flag, managerOverride: flag,
});
export const TA_UPDATE_BODY: BodySchema = S.object({ customerName: str(200), customerPhone: str(40), serviceIds: ids, notes: str(2000), isVip: flag, expectedVersion: version });
export const TA_RESCHEDULE_BODY: BodySchema = S.object({ technicianId: str(64), startTime: time, date: str(10), managerOverride: flag, expectedVersion: version });
export const TA_ASSIGN_BODY: BodySchema = S.object({ technicianId: str(64), managerOverride: flag, expectedVersion: version });
export const TA_CANCEL_BODY: BodySchema = S.object({ reason: str(1000) });
export const TA_CONFLICT_BODY: BodySchema = S.object({ technicianId: str(64), startTime: time, endTime: time, appointmentId: str(64), date: str(10) });
