// ai-money-protection-investigations.dto.ts — investigation case types (spec §36–§39).
import type { Severity } from './ai-money-protection.dto';
import { MONEY_PROTECTION_INVESTIGATION } from '../ai-lifecycles';

export type InvestigationStatus =
  | 'OPEN' | 'INVESTIGATING' | 'WAITING_FOR_INFORMATION' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

// Resolution values (spec §38). SENSITIVE ones require elevated permission and an authorized human — they are
// never auto-assigned by any rule or AI.
export type ResolutionType =
  | 'EXPECTED_ACTIVITY' | 'CUSTOMER_REQUEST' | 'APPROVED_MANAGER_ACTION' | 'PROCESSOR_ERROR' | 'DEVICE_ERROR'
  | 'SOFTWARE_BUG' | 'DUPLICATE_WEBHOOK' | 'DUPLICATE_CHARGE_CONFIRMED' | 'POLICY_VIOLATION'
  | 'EMPLOYEE_MISUSE_CONFIRMED' | 'ACCOUNT_COMPROMISE' | 'INVENTORY_ERROR' | 'CASH_RECONCILIATION_ERROR'
  | 'FALSE_POSITIVE' | 'INSUFFICIENT_EVIDENCE' | 'OTHER';

export const SENSITIVE_RESOLUTIONS: ReadonlySet<ResolutionType> = new Set<ResolutionType>([
  'EMPLOYEE_MISUSE_CONFIRMED', 'ACCOUNT_COMPROMISE',
]);

export const ALL_RESOLUTIONS: ReadonlySet<string> = new Set<ResolutionType>([
  'EXPECTED_ACTIVITY', 'CUSTOMER_REQUEST', 'APPROVED_MANAGER_ACTION', 'PROCESSOR_ERROR', 'DEVICE_ERROR',
  'SOFTWARE_BUG', 'DUPLICATE_WEBHOOK', 'DUPLICATE_CHARGE_CONFIRMED', 'POLICY_VIOLATION',
  'EMPLOYEE_MISUSE_CONFIRMED', 'ACCOUNT_COMPROMISE', 'INVENTORY_ERROR', 'CASH_RECONCILIATION_ERROR',
  'FALSE_POSITIVE', 'INSUFFICIENT_EVIDENCE', 'OTHER',
]);

export interface InvestigationNote {
  id: string;
  investigationId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface InvestigationRelated {
  alertIds?: string[];
  userIds?: string[];
  ticketIds?: string[];
  transactionIds?: string[];
}

export interface Investigation {
  id: string;
  tenantId: string;
  branchId: string | null;
  title: string;
  category: string;
  severity: Severity;
  status: InvestigationStatus;
  assignedUserId: string | null;
  valueUnderReviewCents: number;
  recoveryAmountCents: number;
  resolution: ResolutionType | null;
  related: InvestigationRelated;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface CreateInvestigationInput {
  title: string;
  category?: string;
  severity?: Severity;
  branchId?: string | null;
  alertIds?: string[];
}

// Allowed status transitions (spec §37). RESOLVED/CLOSED are terminal-ish (resolution recorded separately).
// BUILD_PLAN Phase 12 (#27): the ONE table is the machine (ai-lifecycles.ts). The status ROUTE uses it minus OPEN → RESOLVED:
// an open investigation is resolved only through the resolve route (with its resolution, recovery amount and segregation
// of duties), as before.
export const STATUS_TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = Object.fromEntries(
  MONEY_PROTECTION_INVESTIGATION.states.map((st) => [st, (MONEY_PROTECTION_INVESTIGATION.transitions[st] ?? []).filter((to) => !(st === 'OPEN' && to === 'RESOLVED'))]),
) as Record<InvestigationStatus, InvestigationStatus[]>;
