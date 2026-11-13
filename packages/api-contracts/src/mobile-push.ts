// mobile-push.ts — Constitution 6 §58–63 (BUILD_PLAN Phase 13, D): the ONE push wire contract shared by the API's push
// service (modules/communications push/) and the mobile apps' push client (@aipowersalon/mobile-sdk push/).
//
//  • A push carries a TYPED CATEGORY (§60). The category decides which apps may receive it (per-app targeting: a
//    technician's queue push never lands on the same person's customer app) and the in-app ROUTE a tap opens (§62).
//  • The route is a safe routing OBJECT — a name from a closed list plus whitelisted id params — never a URL and never a
//    credential. A tap only names a destination: the app re-checks the session and the screen loads through the API,
//    which authorizes (§62, §64: "deep links identify destination; they do not grant authorization").
//  • The payload is minimized (§61): no customer name, phone, email, amount or card digits. The server drops the PII
//    data keys below at its one choke point; producers write neutral copy (proved by push-producers.vitest.spec.ts).

/** The push `app` wire ids (device_push_tokens.app; APNS_TOPIC_<APP>). manager-pay registers as 'manager'. */
export const PUSH_APPS = ['customer', 'tech', 'owner', 'manager'] as const;
export type PushAppId = (typeof PUSH_APPS)[number];
export function isPushApp(v: unknown): v is PushAppId { return typeof v === 'string' && (PUSH_APPS as readonly string[]).includes(v); }

/** In-app destinations a push or a deep link may name. Closed list: anything else is ignored by the client. */
export const PUSH_ROUTES = [
  'appointments', 'appointment', 'queue', 'queue-ticket', 'schedule', 'payroll', 'alerts', 'approvals', 'community-post',
  'security', 'deals', 'loyalty', 'showcase', 'checkout',
  'receipts',   // developer merge (Oct 6 2026): a receipt saved to the customer's app
] as const;
export type PushRouteName = (typeof PUSH_ROUTES)[number];
/** Route params a payload may carry — ids only (validated by ROUTE_ID_RE on the client). */
export const PUSH_ROUTE_PARAMS = ['appointmentId', 'queueItemId', 'techQueueTicketId', 'periodId', 'alertId', 'proposalId', 'postId'] as const;
export type PushRouteParam = (typeof PUSH_ROUTE_PARAMS)[number];
export const ROUTE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export interface PushRoute { name: PushRouteName; params: Partial<Record<PushRouteParam, string>> }

export interface PushCategoryDef { apps: readonly PushAppId[]; route: PushRouteName; channel: 'default' | 'alerts' | 'security' }
/** §60 — customer, technician and owner/manager categories (+ the producers that exist today: check-in ready, community,
 *  payroll). `channel` is the Android notification channel the client creates (§138). */
export const PUSH_CATEGORIES = {
  // customer, tech, owner, manager
  APPOINTMENT_CONFIRMATION: { apps: ['customer', 'tech', 'owner', 'manager'], route: 'appointment', channel: 'default' },
  APPOINTMENT_REMINDER: { apps: ['customer'], route: 'appointment', channel: 'default' },
  BOOKING_CHANGE: { apps: ['customer', 'tech', 'owner', 'manager'], route: 'appointment', channel: 'default' },
  CHECK_IN_READY: { apps: ['customer', 'tech', 'owner', 'manager'], route: 'queue', channel: 'alerts' },
  DEAL: { apps: ['customer'], route: 'deals', channel: 'default' },
  LOYALTY: { apps: ['customer'], route: 'loyalty', channel: 'default' },
  COMMUNITY: { apps: ['customer'], route: 'showcase', channel: 'default' },
  RECEIPT: { apps: ['customer', 'owner', 'manager'], route: 'receipts', channel: 'alerts' },   // developer merge (Oct 6 2026)
  // technician
  QUEUE_ASSIGNMENT: { apps: ['tech'], route: 'queue', channel: 'alerts' },
  SCHEDULE_CHANGE: { apps: ['tech'], route: 'schedule', channel: 'default' },
  NEW_CUSTOMER: { apps: ['tech'], route: 'queue', channel: 'alerts' },
  SERVICE_ALERT: { apps: ['tech'], route: 'queue', channel: 'alerts' },
  PAYROLL: { apps: ['tech'], route: 'payroll', channel: 'default' },
  // owner / manager (a MANAGER signs in to the manager-pay app; an OWNER to the owner app)
  BUSINESS_ALERT: { apps: ['owner', 'manager'], route: 'alerts', channel: 'alerts' },
  PAYMENT_ALERT: { apps: ['owner', 'manager'], route: 'alerts', channel: 'alerts' },
  QUEUE_CONGESTION: { apps: ['owner', 'manager'], route: 'alerts', channel: 'alerts' },
  AI_INSIGHT: { apps: ['owner', 'manager'], route: 'alerts', channel: 'default' },
  APPROVAL_REQUIRED: { apps: ['owner', 'manager'], route: 'approvals', channel: 'alerts' },
  // every app
  SECURITY: { apps: ['customer', 'tech', 'owner', 'manager'], route: 'security', channel: 'security' },
} as const satisfies Record<string, PushCategoryDef>;
export type PushCategory = keyof typeof PUSH_CATEGORIES;
export const PUSH_CATEGORY_NAMES = Object.keys(PUSH_CATEGORIES) as PushCategory[];
export function isPushCategory(v: unknown): v is PushCategory { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PUSH_CATEGORIES, v); }
/** May a push of this category be delivered to a token registered by this app? A legacy token with no app (registered
 *  before the app id was sent) is still delivered to — every current client sends its id. */
export function categoryTargetsApp(category: PushCategory, app: string | null | undefined): boolean {
  if (!app) return true;
  return (PUSH_CATEGORIES[category].apps as readonly string[]).includes(app);
}

/** §61: data keys that must never travel in a push payload. The server drops them; the client never reads them. */
export const PUSH_FORBIDDEN_DATA_KEYS = ['customerName', 'customer_name', 'name', 'fullName', 'full_name', 'firstName', 'lastName', 'displayName',
  'phone', 'email', 'amount', 'amountCents', 'card', 'last4', 'token', 'accessToken', 'refreshToken'] as const;

/** extras Customer Notifications 01 (round 10): the payload's schema version. The server stamps it on every typed push
 *  ('v'); a client reads a payload with no 'v' as version 1 (every push sent before the stamp), and REFUSES to route one
 *  whose version is newer than it understands (a later shape is never guessed at — the notification still shows, the tap
 *  just opens the app's home). Bump only for a breaking change of the data keys. */
export const PUSH_PAYLOAD_SCHEMA_VERSION = 1;
/** The payload's version: a missing / malformed 'v' is 1 (legacy); otherwise the positive integer sent. */
export function pushPayloadVersion(data: Record<string, unknown> | null | undefined): number {
  const v = data?.v; const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** extras Customer Notifications 01 (round 10): ONE read / acknowledge contract for every app's notification inbox. "Read" is
 *  this person seeing it; "acknowledged" is this person acting on it (e.g. tapping through); neither changes the source
 *  record. Ids only; an SDK marks many at once and the server answers how many were newly marked (idempotent). */
export interface NotificationReadState { notificationId: string; readAt: string | null; acknowledgedAt: string | null }
export interface NotificationMarkRequest { notificationIds: string[]; action: 'read' | 'acknowledge' }
export interface NotificationMarkResponse { marked: number; states: NotificationReadState[] }
export const NOTIFICATION_MARK_MAX = 200;
/** Validates a mark request the same way on every side: 1–200 well-formed ids (deduplicated; any malformed id refuses it) and a known action. */
export function parseNotificationMarkRequest(v: unknown): NotificationMarkRequest | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { notificationIds?: unknown; action?: unknown };
  if (o.action !== 'read' && o.action !== 'acknowledge') return null;
  if (!Array.isArray(o.notificationIds)) return null;
  const good = o.notificationIds.filter((x): x is string => typeof x === 'string' && ROUTE_ID_RE.test(x));
  if (good.length !== o.notificationIds.length) return null;   // one malformed id refuses the whole request
  const ids = [...new Set(good)];
  if (!ids.length || ids.length > NOTIFICATION_MARK_MAX) return null;
  return { notificationIds: ids, action: o.action };
}

/** The data the server adds to every typed push: the schema version, the category and the route (name + whitelisted id params). */
export function pushRouteData(category: PushCategory, data: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { v: String(PUSH_PAYLOAD_SCHEMA_VERSION), category, route: PUSH_CATEGORIES[category].route };
  for (const k of PUSH_ROUTE_PARAMS) { const v = data[k]; if (typeof v === 'string' && ROUTE_ID_RE.test(v)) out[k] = v; }
  return out;
}

/** Client side: read a received payload into a typed route, or null (unknown category / route / bad id). Never trusts
 *  anything beyond the closed lists; an id that does not look like an id is dropped. */
export function routeFromPushData(data: Record<string, unknown> | null | undefined): PushRoute | null {
  if (!data) return null;
  if (pushPayloadVersion(data) > PUSH_PAYLOAD_SCHEMA_VERSION) return null;   // a newer shape than this client knows: never guess
  const cat = data.category;
  const name = typeof data.route === 'string' ? data.route : isPushCategory(cat) ? PUSH_CATEGORIES[cat].route : null;
  if (!name || !(PUSH_ROUTES as readonly string[]).includes(name)) return null;
  const params: PushRoute['params'] = {};
  for (const k of PUSH_ROUTE_PARAMS) { const v = data[k]; if (typeof v === 'string' && ROUTE_ID_RE.test(v)) params[k] = v; }
  return { name: name as PushRouteName, params };
}
