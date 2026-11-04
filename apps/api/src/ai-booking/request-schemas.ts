// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the AI-booking API bodies (staff/agent channel, the public signed-link
// channel, Super Admin link minting), applied with @Body(ValidatedBody(SCHEMA)). Written from each handler (the fields it
// reads); tenant and branch always come from the session or the signed token, never from the body. Unknown fields are
// stripped.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const bool: BodySchema = S.nullable(S.boolean());
const ids: BodySchema = S.nullable(S.array(S.text(64), { maxItems: 50 }));
const chan = { source: str(40), correlationId: str(128) };
const slot = { date: str(10), serviceIds: ids, technicianId: str(64) };
const gate = { confirm: bool, idempotencyKey: str(200) };

export const AIB_CONTEXT_BODY: BodySchema = S.object(chan);
export const AIB_SEARCH_BODY: BodySchema = S.object({ ...chan, ...slot });
export const AIB_CREATE_BODY: BodySchema = S.object({ ...chan, ...slot, ...gate, customerName: str(200), customerId: str(64), customerPhone: str(40), startTime: str(40), notes: str(2000) }, [], { 'x-forbidden': ['status'] });
export const AIB_RESCHEDULE_BODY: BodySchema = S.object({ ...chan, ...gate, startTime: str(40), date: str(10), technicianId: str(64) }, [], { 'x-forbidden': ['status'] });
export const AIB_CANCEL_BODY: BodySchema = S.object({ ...chan, ...gate, reason: str(1000) });
export const AIB_CONFIRM_BODY: BodySchema = S.object({ ...chan, ...gate });
export const AIB_CONVERSION_BODY: BodySchema = S.object({ ...chan, stage: str(40), outcome: str(40), failureReason: str(500), appointmentId: str(64) });

// public signed-link channel (booking-public): the token carries tenant / branch / allowed services
const link = { token: str(4096), correlationId: str(128) };
export const AIB_PUBLIC_SERVICES_BODY: BodySchema = S.object(link);
export const AIB_PUBLIC_SEARCH_BODY: BodySchema = S.object({ ...link, ...slot });
export const AIB_PUBLIC_CREATE_BODY: BodySchema = S.object({ ...link, ...slot, ...gate, customerName: str(200), customerPhone: str(40), startTime: str(40), bookingSessionId: str(512), deviceId: str(200) }, [], { 'x-forbidden': ['status'] });
export const AIB_PUBLIC_VERIFY_SEND_BODY: BodySchema = S.object({ ...link, bookingSessionId: str(512), deviceId: str(200), customerPhone: str(40), captchaToken: str(4096) });
export const AIB_PUBLIC_VERIFY_CHECK_BODY: BodySchema = S.object({ ...link, bookingSessionId: str(512), deviceId: str(200), customerPhone: str(40), code: { type: ['string', 'number', 'null'], maxLength: 12 } });

// Super Admin (tenant from the path)
export const AIB_MINT_LINK_BODY: BodySchema = S.object({ source: str(40), branchId: str(64), allowedServiceIds: ids, partnerId: str(120), campaignId: str(120), ttlDays: S.nullable(S.number()) });
export const AIB_REVOKE_LINK_BODY: BodySchema = S.object({ jti: str(200), reason: str(1000) });
/** A7 AI Booking Assistant (Nov 4 2026): dismiss a recovery case — the reason is required and audited */
export const AIB_RECOVERY_DISMISS_BODY: BodySchema = S.object({ reason: S.text(300) }, ['reason']);
/** A7 (Nov 4 2026): ask a manager about a recovery case — what to approve, recorded in the salon's approvals */
export const AIB_RECOVERY_APPROVAL_BODY: BodySchema = S.object({ reason: S.text(500) }, ['reason']);
