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

// defensive: the client must NEVER send tenant/branch — the server derives them from the session.
// export function assertNoClientTenant(body: Record<string, unknown> | undefined): void {
//   if (!body) return;
//   const banned = ["tenantId", "branchId", "tenant_id", "branch_id"];
//   for (const k of banned) {
//     if (Object.prototype.hasOwnProperty.call(body, k)) {
//       throw new Error("Refusing to send '" + k + "' from the client; the server derives tenant context.");
//     }
//   }
// }
export function assertNoClientTenant(
  body: Record<string, unknown> | undefined,
  path?: string
): void {
  if (!body) return;

  // Super Admin endpoints (/super-admin/...) explicitly carry tenantId / branchId parameters to manage tenants across the platform.
  if (path && (path.startsWith("/super-admin") || path.startsWith("super-admin"))) {
    return;
  }

  // Auth endpoints (/auth/...) allow branchId for branch selection during sign-in
  if (path && (path.startsWith("/auth") || path.startsWith("auth"))) {
    const banned = ["tenantId", "tenant_id"];
    for (const k of banned) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        throw new Error(
          "Refusing to send '" +
            k +
            "' from the client; the server derives tenant context."
        );
      }
    }
    return;
  }

  const banned = ["tenantId", "branchId", "tenant_id", "branch_id"];

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
