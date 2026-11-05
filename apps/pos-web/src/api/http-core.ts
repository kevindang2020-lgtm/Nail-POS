// http-core.ts — framework-agnostic core for the frontend API client (step 2). Tested here.

export interface NormalizedError { status: number; code: string; message: string; }

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
  return { status: status, code: code, message: message };
}

// is an empty result an "empty state" (not an error)? helps screens show empty states vs. error toasts.
export function isEmptyState(items: unknown[] | null | undefined): boolean {
  return !items || items.length === 0;
}
