// pos-workflow-core.ts — the ONE shared ticket/appointment lifecycle every POS screen transitions.
// This is the connective tissue: each screen owns a status, each action moves the SAME record forward,
// and each transition declares the realtime event + which screens refetch + the permission required.
// Pure + tested so the whole booking→checkout flow is verifiable without the repo.

export type WorkflowStatus =
  | "booked" | "checked_in" | "queued" | "assigned" | "serving"
  | "service_done" | "ready_checkout" | "paid" | "cancelled";

export type WorkflowAction =
  | "book" | "check_in" | "walk_in" | "enqueue" | "assign_tech" | "start_service"
  | "mark_service_done" | "send_to_checkout" | "mark_paid" | "reopen_service" | "cancel";

export interface ActionSpec {
  from: (WorkflowStatus | "none")[];
  to: WorkflowStatus;
  event: string;            // realtime event (see realtime-core EVENTS)
  screens: string[];        // screens to refetch when this fires
  permission: string | null;
  ownerScreen: string;      // the screen that surfaces the resulting status
}

// the single source of truth for the salon workflow (doc §4 chain).
export const WORKFLOW: Record<WorkflowAction, ActionSpec> = {
  book:              { from: ["none"], to: "booked", event: "appointment_created", screens: ["booking", "tech-appointments", "dashboard"], permission: "appointments.create", ownerScreen: "tech-appointments" },
  check_in:          { from: ["booked"], to: "checked_in", event: "customer_checked_in", screens: ["check-in", "queue", "tech-queue", "dashboard"], permission: "checkin.create", ownerScreen: "check-in" },
  walk_in:           { from: ["none"], to: "checked_in", event: "customer_checked_in", screens: ["check-in", "queue", "tech-queue", "dashboard"], permission: "checkin.create", ownerScreen: "check-in" },
  enqueue:           { from: ["checked_in"], to: "queued", event: "queue_updated", screens: ["queue", "tech-queue", "dashboard"], permission: null, ownerScreen: "queue" },
  assign_tech:       { from: ["queued"], to: "assigned", event: "ticket_assigned", screens: ["queue", "tech-queue", "serving"], permission: null, ownerScreen: "tech-queue" },
  start_service:     { from: ["assigned"], to: "serving", event: "service_started", screens: ["serving", "tech-queue", "dashboard"], permission: null, ownerScreen: "serving" },
  mark_service_done: { from: ["serving"], to: "service_done", event: "service_done", screens: ["serving", "service-done", "checkout"], permission: null, ownerScreen: "service-done" },
  send_to_checkout:  { from: ["service_done"], to: "ready_checkout", event: "ticket_ready_checkout", screens: ["service-done", "checkout", "dashboard"], permission: null, ownerScreen: "checkout" },
  mark_paid:         { from: ["ready_checkout"], to: "paid", event: "ticket_paid", screens: ["checkout", "reports", "technicians", "customers", "dashboard"], permission: "checkout.take_payment", ownerScreen: "reports" },
  reopen_service:    { from: ["service_done", "ready_checkout"], to: "serving", event: "service_started", screens: ["serving", "service-done", "checkout"], permission: "checkout.reopen_service", ownerScreen: "serving" },
  cancel:            { from: ["booked", "checked_in", "queued", "assigned"], to: "cancelled", event: "appointment_cancelled", screens: ["booking", "tech-appointments", "queue", "dashboard"], permission: "appointments.cancel", ownerScreen: "tech-appointments" },
};

export function isTerminal(s: WorkflowStatus): boolean { return s === "paid" || s === "cancelled"; }

// the legal next status for an action from a given status (null = illegal transition).
export function nextStatus(current: WorkflowStatus | "none", action: WorkflowAction): WorkflowStatus | null {
  const spec = WORKFLOW[action];
  return spec.from.indexOf(current) >= 0 ? spec.to : null;
}
export function canTransition(current: WorkflowStatus | "none", action: WorkflowAction): boolean {
  return nextStatus(current, action) !== null;
}

export function eventFor(action: WorkflowAction): string { return WORKFLOW[action].event; }
export function screensFor(action: WorkflowAction): string[] { return WORKFLOW[action].screens; }
export function permissionFor(action: WorkflowAction): string | null { return WORKFLOW[action].permission; }

// which screen surfaces a ticket currently in this status (so each board shows the right items).
export function screenForStatus(s: WorkflowStatus): string {
  const map: Record<WorkflowStatus, string> = {
    booked: "tech-appointments", checked_in: "check-in", queued: "queue", assigned: "tech-queue",
    serving: "serving", service_done: "service-done", ready_checkout: "checkout", paid: "reports", cancelled: "tech-appointments",
  };
  return map[s];
}

// apply a transition with a permission check; returns the new status or an error reason.
export function applyAction(current: WorkflowStatus | "none", action: WorkflowAction, perms: string[]): { ok: true; status: WorkflowStatus; event: string; refetch: string[] } | { ok: false; error: "illegal_transition" | "permission_denied" } {
  const need = permissionFor(action);
  if (need && perms.indexOf(need) < 0) return { ok: false, error: "permission_denied" };
  const ns = nextStatus(current, action);
  if (ns === null) return { ok: false, error: "illegal_transition" };
  return { ok: true, status: ns, event: eventFor(action), refetch: screensFor(action) };
}
