// pos-search-core.ts — pure, tested. Tenant POS search policy: which groups a user may search,
// query validation, per-group limits, and result routing. Tenant/branch SCOPING itself is enforced
// in the repo via scoped() (see tenant-scope.kysely.ts); this core decides access + shaping.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';

export type PosSearchGroup = "customers" | "appointments" | "services" | "technicians" | "tickets" | "receipts" | "queue";
export type PosSearchResultType = "customer" | "appointment" | "service" | "technician" | "ticket" | "receipt" | "queue_item";

export const ALL_GROUPS: PosSearchGroup[] = ["customers", "appointments", "services", "technicians", "tickets", "receipts", "queue"];

// BUILD_PLAN Phase 9 (Constitution 2 §148): every group is the CATALOG key its own screen needs. Before, two of them
// ('appointments.view', 'tickets.view') and the technician's 'pos.access' existed in no catalog, and OWNER / MANAGER were
// let through by role NAME — so a narrowed template or a DENY on customers.view still searched customers.
export const GROUP_PERMISSION: Record<PosSearchGroup, string> = {
  customers: "customers.view", appointments: "booking.view", services: "services.view",
  technicians: "technicians.view", tickets: "checkout.view", receipts: "reports.view", queue: "queue.view",
};
export const POS_SEARCH_PERMISSION = "global_search.use";

const principal = (role: string, perms: string[]) => ({ tenantId: "", branchId: "", userId: "", role: role as any, permissions: perms || [] });
export function hasPosSearchAccess(role: string, perms: string[]): boolean {
  return isStaffPrincipal(role) && hasPermission(principal(role, perms), POS_SEARCH_PERMISSION);
}

export function permittedGroups(role: string, perms: string[]): PosSearchGroup[] {
  if (!hasPosSearchAccess(role, perms)) return [];
  return ALL_GROUPS.filter((g) => hasPermission(principal(role, perms), GROUP_PERMISSION[g]));
}

export function validateQuery(q: string | undefined): { ok: boolean; q: string; error?: string } {
  const trimmed = (q || "").trim();
  if (trimmed.length < 2) return { ok: false, q: trimmed, error: "min_length" };
  return { ok: true, q: trimmed };
}

export function clampLimit(requested?: number): number {
  if (!requested || requested < 1) return 5;
  return Math.min(requested, 10);
}

export function ticketRoute(ticketId: string, status?: string): string {
  switch (status) {
    case "ready_checkout": return `/pos/checkout?ticketId=${ticketId}`;
    case "serving": return `/pos/serving?ticketId=${ticketId}`;
    case "service_done": return `/pos/service-done?ticketId=${ticketId}`;
    case "queued": return `/pos/queue?ticketId=${ticketId}`;
    default: return `/pos/checkout?ticketId=${ticketId}`;
  }
}
export function getResultRoute(type: PosSearchResultType, id: string, opts?: { status?: string; route?: string }): string {
  switch (type) {
    case "customer": return `/pos/customers/${id}`;
    case "appointment": return `/pos/tech-appointments?appointmentId=${id}`;
    case "service": return `/pos/services?serviceId=${id}`;
    case "technician": return `/pos/technicians?technicianId=${id}`;
    case "ticket": return opts?.route ?? ticketRoute(id, opts?.status);
    case "receipt": return `/pos/reports?receiptId=${id}`;
    case "queue_item": return opts?.route ?? `/pos/queue?queueItemId=${id}`;
    default: return "/pos/overview";
  }
}

export const EMPTY_STATE = "No results found in this salon.";

export interface PosSearchResult { id: string; type: PosSearchResultType; title: string; subtitle?: string; badge?: string; route?: string; metadata?: Record<string, unknown>; }
export type GroupedResults = Record<PosSearchGroup, PosSearchResult[]>;
export function emptyGrouped(): GroupedResults { return { customers: [], appointments: [], services: [], technicians: [], tickets: [], receipts: [], queue: [] }; }
export function totalCount(g: GroupedResults): number { return ALL_GROUPS.reduce((n, k) => n + g[k].length, 0); }
