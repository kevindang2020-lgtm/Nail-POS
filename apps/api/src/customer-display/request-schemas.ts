// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the customer display's bodies (apps/customer-display api.ts — tip,
// method, rating, receipt, phone code, heartbeat, release, ad displays, pairing; the api-contracts types TipSubmission,
// DisplayReceiptSubmission, DisplayHeartbeat, CustomerDisplayAdDisplayReport, DisplayPairingRequest) and the POS's
// display management (pos-web: pair { code, name, stationId }, registers { name }, device { name, stationId,
// maintenance }). The display is a PUBLIC surface authenticated by a session / device token: the server decides tenant,
// branch and ticket from the token, never from the body. Money fields are integer cents; unknown fields are stripped.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const MONEY: BodySchema['x-forbidden'] = ['status', 'state', 'paymentStatus', 'capturedCents', 'refundedCents', 'tipCents', 'totalCents'];

const TECH_TIP: BodySchema = S.object({ technicianId: S.text(64), tipType: S.text(16), percent: S.nullable(S.number({ minimum: 0, maximum: 100 })), amountCents: S.nullable(S.integer({ minimum: 0, maximum: 1000000 })) }, ['technicianId', 'tipType']);
export const DISPLAY_TIP_BODY: BodySchema = S.object({ tipType: str(16), percent: S.nullable(S.number({ minimum: 0, maximum: 100 })), amountCents: S.nullable(S.integer({ minimum: 0 })),
  technicians: S.nullable(S.array(TECH_TIP, { maxItems: 30 })), expectedVersion: S.nullable(S.integer({ minimum: 0 })), confirm: S.nullable(S.boolean()) }, [], { 'x-forbidden': MONEY });
export const DISPLAY_METHOD_BODY: BodySchema = S.object({ method: str(16) }, [], { 'x-forbidden': MONEY });
export const DISPLAY_RATING_BODY: BodySchema = S.object({ rating: { type: ['number', 'string', 'null'], maxLength: 4 } });
export const DISPLAY_RECEIPT_BODY: BodySchema = S.object({ choice: str(16) });
export const DISPLAY_PHONE_CODE_BODY: BodySchema = S.object({ code: { type: ['string', 'number', 'null'], maxLength: 12 } });
export const DISPLAY_HEARTBEAT_BODY: BodySchema = S.object({
  mode: str(20), appVersion: str(64), profile: str(40),
  screen: S.nullable(S.object({ width: S.nullable(S.number()), height: S.nullable(S.number()), pixelRatio: S.nullable(S.number()) })),
  adPolicy: S.nullable(S.object({ version: S.nullable(S.integer({ minimum: 0 })), mode: str(20) })),   // G7: the applied advertising policy (ACK)
  // round 10 (Tablets 02): what the browser exposes — the OS and the battery; absent when the device cannot read them
  os: str(64), battery: S.nullable(S.object({ percent: S.nullable(S.number()), charging: S.nullable(S.boolean()) })),
});
export const DISPLAY_RELEASE_BODY: BodySchema = S.object({ sessionId: str(64) });
export const DISPLAY_AD_DISPLAYS_BODY: BodySchema = S.object({
  batchId: str(128),
  displays: S.nullable(S.array(S.object({ adId: str(64), shownAt: str(40), durationMs: S.nullable(S.number()) }), { maxItems: 500 })),
});
export const DISPLAY_PAIRING_START_BODY: BodySchema = S.object({ platform: str(16) });
export const DISPLAY_PAIRING_POLL_BODY: BodySchema = S.object({ pollSecret: str(256) });

// POS display management (staff)
export const POS_DISPLAY_PAIR_BODY: BodySchema = S.object({ code: { type: ['string', 'number', 'null'], maxLength: 16 }, name: str(120), stationId: str(64) });
export const POS_DISPLAY_STATION_BODY: BodySchema = S.object({ name: str(120) });
export const POS_DISPLAY_UPDATE_BODY: BodySchema = S.object({ name: str(120), stationId: str(64), maintenance: S.boolean() });
