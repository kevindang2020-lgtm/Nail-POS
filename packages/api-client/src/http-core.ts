// http-core.ts — framework-agnostic core of every frontend API client: URL building, the no-client-tenant guard, and
// error normalisation (Constitution 13 §108, §245). One copy for the six web apps; tested in http-core.test.ts.

import { clientActionFor, codeForStatus, isClientAction, isRegisteredCode, type ClientAction } from "@aipowersalon/api-contracts";

export interface NormalizedError {
  status: number;
  code: string;
  message: string;
  /** Constitution 5 §221: what the client should do — REAUTHENTICATE, REFRESH (stale edit), RETRY, CONTACT_MANAGER,
   *  UPGRADE_PLAN or NONE. The server's `error.action` when present, else derived from the code (or, for a legacy
   *  unregistered code, the HTTP status) with the same registry the server uses (@aipowersalon/api-contracts). */
  action: ClientAction;
  /**
   * The rest of the server's error body.
   *
   * `normalizeError` used to keep only status/code/message and DROP everything else — which meant a 428
   * `phone_verification_required` arrived at the UI with no `bookingSessionId` and no `maskedPhone`, i.e. with
   * nothing the customer needs to actually complete the verification. The error was structurally unusable.
   */
  details?: Record<string, unknown>;
}

// build a URL with a query string, dropping undefined/null and encoding values.
export function buildUrl(base: string, path: string, query?: Record<string, unknown>): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  let url = b + p;
  if (query) {
    const parts: string[] = [];
    for (const k of Object.keys(query)) {
      const v = query[k];
      if (v === undefined || v === null || v === "") continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    }
    if (parts.length) url += "?" + parts.join("&");
  }
  return url;
}

// defensive: the client must NEVER send tenant/branch — the server derives them from the session.
export function assertNoClientTenant(
  body: Record<string, unknown> | undefined,
  path?: string
): void {
  if (!body) return;

  // Super Admin endpoints (/super-admin/...) carry tenantId / branchId on purpose — the platform manages tenants across
  // the whole system (the developer's Sep 2026 fix; the base refused them and broke every Super Admin tenant-scoped write).
  if (path && (path.startsWith("/super-admin") || path.startsWith("super-admin"))) return;

  const isAuthPath = path && (path.startsWith("/auth") || path.startsWith("auth"));
  const banned = isAuthPath
    ? ["tenantId", "tenant_id"]
    : ["tenantId", "branchId", "tenant_id", "branch_id"];

  for (const k of banned) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      throw new Error(
        "Refusing to send '" +
          k +
          "' from the client; the server derives tenant context."
      );
    }
  }
}

export function normalizeError(status: number, json: unknown): NormalizedError {
  const j = (json || {}) as Record<string, unknown>;
  // Constitution 5 §28: read the standard envelope `error.{code,message}` FIRST, then the top-level twins older
  // servers (and today's) also send — so an app keeps working the day the duplicates are removed.
  const env = j.error && typeof j.error === "object" ? (j.error as Record<string, unknown>) : null;
  const code = typeof env?.code === "string" ? env.code : typeof j.code === "string" ? j.code : (status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHENTICATED" : "ERROR");
  const message = typeof env?.message === "string" ? env.message : typeof j.message === "string" ? j.message
    : status === 403 ? "You do not have permission to do that."
    : status === 401 ? "Please sign in again."
    : status >= 500 ? "Something went wrong. Please try again."
    : "Request failed.";
  // Everything the server sent that is not status/code/message. Some errors are not failures to be displayed —
  // they are INSTRUCTIONS (verify this phone, then retry), and the instruction is in the payload.
  const { code: _c, message: _m, ...details } = j;
  // An unregistered (legacy) code falls back on the STATUS: a 401 labelled "UNAUTHENTICATED" still means REAUTHENTICATE.
  const action: ClientAction = isClientAction(env?.action) ? env!.action as ClientAction : clientActionFor(isRegisteredCode(code) ? code : codeForStatus(status));
  return { status, code, message, action, details };
}

// is an empty result an "empty state" (not an error)? helps screens show empty states vs. error toasts.
export function isEmptyState(items: unknown[] | null | undefined): boolean {
  return !items || items.length === 0;
}

/** Constitution 5 §61–66: a key for ONE user intent (one refund, one void). Create it when the action starts, send it on
 *  every attempt of that action (a retry after a timeout reuses it), and make a new one only for the next action — a
 *  fresh key per HTTP call would let a double-tap or retry run twice. */
export function newIdempotencyKey(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return 'idem_' + c.randomUUID();
  return 'idem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** Keys for a screen's money actions. keyFor(intent, details) returns the SAME key while the action and its details are
 *  unchanged (a retry after a timeout or a double-tap → the server answers once), and a NEW key once the details change
 *  (the cashier corrected the amount: that is a different request, not a retry). done(intent) after success, so the next
 *  refund of the same payment is its own action. */
export function createIntentKeys(make: () => string = newIdempotencyKey) {
  const keys = new Map<string, { sig: string; key: string }>();
  const sigOf = (d: unknown) => JSON.stringify(d ?? null, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
  return {
    keyFor(intent: string, details?: unknown): string {
      const sig = sigOf(details); const cur = keys.get(intent);
      if (cur && cur.sig === sig) return cur.key;
      const key = make(); keys.set(intent, { sig, key }); return key;
    },
    done(intent: string): void { keys.delete(intent); },
  };
}
