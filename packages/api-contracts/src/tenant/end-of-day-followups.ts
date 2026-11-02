// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type FollowUpStatus =
  | 'pending' | 'pending_manager_approval' | 'rejected' | 'sent' | 'skipped' | 'dismissed' | 'failed' | 'customer_not_available' | 'customer_replied' | 'rebooked' | 'expired';

export interface FollowUpTaskView {
  id: string;
  businessDate: string;
  status: FollowUpStatus;
  customerName: string;
  customerPhone: string | null;
  customerHasApp: boolean;
  serviceName: string;
  serviceId: string | null;
  ticketId: string;
  ticketServiceLineId: string;
  appointmentId: string | null;
  technicianId: string;
  technicianName: string;
  completedAt: string | null;
  templateKey: string | null;
  suggestedMessage: string;
  sentMessage: string | null;
  sentAt: string | null;
  skipReason: string | null;
  /** when the unsent task expired (kept for history — migration 745); null while live */
  expiredAt?: string | null;
  /** the manager's note on a rejection (shown to the technician) */
  managerNote?: string | null;
}

export interface TechStats { pending: number; sent: number; skipped: number; dismissed: number; rebooked: number; total: number; }

export interface GenerateResult { businessDate: string; created: number; skipped: number; alreadyRan: boolean; }

export interface FollowUpSettings {
  enabled: boolean;
  generationTime: string;            // 'HH:mm', branch-local
  timezone: string;                  // resolved (store_hours override or settings override or default)
  allowTechEditMessage: boolean;
  allowCustomerReplies: boolean;
  requireManagerApproval: boolean;
  reminderToTech: boolean;
  createMode: 'end_of_day' | 'after_checkout';
  autoExpirePendingHours: number;    // expire unsent tasks older than this — status 'expired', history kept (0 = off; default 24)
  /** customer contact protection (EOD guide §8): no second follow-up to the same customer within N hours (0 = off; default 24) */
  contactCooldownHours: number;
  defaultMessageTemplate: string | null;
}

/** GET /tech/follow-ups/templates — the picker's options (the template BODY stays server-side). Constitution 13 §15: one definition
 *  the API returns and the tech app renders. */
export interface FollowUpTemplateOption { key: string; label: string }
