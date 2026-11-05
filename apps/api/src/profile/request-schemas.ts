// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the signed-in staff member's own preferences (pos-web profile /
// security screens). The service keeps only booleans for the alert / notification switches and an allow-listed landing
// page; the schema declares exactly those fields. The avatar is a data: URL (the service decodes and size-checks it).
import { S, type BodySchema } from '@aipowersalon/permissions';

const bool: BodySchema = S.nullable(S.boolean());
export const LOGIN_ALERTS_BODY: BodySchema = S.object({
  enabled: bool, newDevice: bool, newLocation: bool, passwordChanged: bool, emailChanged: bool, phoneChanged: bool, twofaChanged: bool, recoveryCodesChanged: bool,
  sessionRevoked: bool, suspiciousBlocked: bool,
});
export const NOTIFICATION_PREFS_BODY: BodySchema = S.object({
  smsNotifications: bool, emailNotifications: bool, pushNotifications: bool, missedCallAlerts: bool, bookingAlerts: bool, lowStockAlerts: bool, payrollApprovals: bool, weeklyReportSummaries: bool,
});
export const UI_PREFS_BODY: BodySchema = S.object({ defaultLanding: S.nullable(S.text(80)) });
/** ≈ 10 MB of base64 image data at most (the service's own limit is smaller and answers it) */
export const AVATAR_BODY: BodySchema = S.object({ dataUrl: S.nullable(S.text(14_000_000)) });
