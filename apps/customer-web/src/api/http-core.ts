// http-core.ts — framework-agnostic core for the frontend API client (step 2). Tested here.

export interface NormalizedError {
  status: number;
  code: string;
  message: string;
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
  const code = typeof j.code === "string" ? j.code : (status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHENTICATED" : "ERROR");
  const message = typeof j.message === "string" ? j.message
    : status === 403 ? "You do not have permission to do that."
    : status === 401 ? "Please sign in again."
    : status >= 500 ? "Something went wrong. Please try again."
    : "Request failed.";
  // Everything the server sent that is not status/code/message. Some errors are not failures to be displayed —
  // they are INSTRUCTIONS (verify this phone, then retry), and the instruction is in the payload.
  const { code: _c, message: _m, ...details } = j;
  return { status, code, message, details };
}

// is an empty result an "empty state" (not an error)? helps screens show empty states vs. error toasts.
export function isEmptyState(items: unknown[] | null | undefined): boolean {
  return !items || items.length === 0;
}
