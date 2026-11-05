// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

// FollowUpStatus is shared with the customer realm (a customer sees their own follow-up's status), so it lives at the
// package root (follow-up-status.ts) and is re-exported here for the tenant apps.
import type { FollowUpStatus } from '../follow-up-status';
export type { FollowUpStatus } from '../follow-up-status';

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
  autoExpirePendingHours: number;    // soft-delete still-pending tasks older than this (0 = off; default 24)
  defaultMessageTemplate: string | null;
}

/** GET /tech/follow-ups/templates — the picker's options (the template BODY stays server-side). Constitution 13 §15: one definition
 *  the API returns and the tech app renders. */
export interface FollowUpTemplateOption { key: string; label: string }
