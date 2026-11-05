// request-schemas.ts — BUILD_PLAN Phase 12 (#17): Super Admin system-status bodies (incidents, timeline, public
// updates, maintenance windows, post-incident reports, tenant notices). Written from each handler (the fields read);
// the incident lifecycle itself is the incident machine's (incident-workflow.ts).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
export const INCIDENT_CREATE_BODY: BodySchema = S.object({ title: str(300), componentKey: str(120), severity: str(20), impact: str(2000), affectedTenants: { type: ['number', 'string', 'null'], maxLength: 20 } });
export const INCIDENT_STATUS_BODY: BodySchema = S.object({ status: str(32), resolution: str(4000) });
export const INCIDENT_COMMANDER_BODY: BodySchema = S.object({ commander: str(200) });
export const INCIDENT_TIMELINE_BODY: BodySchema = S.object({ kind: str(40), body: str(4000), ref: str(500) });
export const PUBLIC_UPDATE_BODY: BodySchema = S.object({ title: str(300), body: str(10000), audience: str(40), incidentId: str(64) });
export const MAINTENANCE_BODY: BodySchema = S.object({ service: str(200), scope: str(200), windowStart: str(40), windowEnd: str(40), tenantImpact: { type: ['number', 'string', 'null'], maxLength: 2000 }, owner: str(200) });
export const POST_INCIDENT_REPORT_BODY: BodySchema = S.object({ title: str(300), incidentReference: str(200), summary: str(10000), rootCause: str(10000), owner: str(200) });
export const NOTIFY_TENANTS_BODY: BodySchema = S.object({ message: str(5000), channel: str(20), audience: str(40), incidentReference: str(200), sentBy: str(200) });
