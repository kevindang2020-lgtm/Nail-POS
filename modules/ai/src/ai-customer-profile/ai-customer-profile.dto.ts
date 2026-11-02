// ai-customer-profile.dto.ts — request context + tool response shapes for the AI Customer Profile Assistant.
// The context mirrors every other POS slice: tenant/branch/user/role/permissions are ALL server-derived (spec §5).
export type {
  VisitSummary, ServicePreference, TechnicianPreference, InactivityResult,
  CompletenessResult, RebookingResult, Confidence, DuplicateConfidence,
} from './ai-customer-profile-core';

export interface AiCustomerProfileContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}

/** Freshness envelope attached to every tool result (spec §9 "data freshness", §56 DATA_DELAYED). */
export interface Freshness { generatedAt: string; source: 'live' | 'cache'; }

export interface ProfileOverview {
  customerId: string;
  displayName: string;
  status: string;
  lastVisit: string | null;
  nextAppointment: string | null;
  completedVisits: number;
  mostBookedService: string | null;
  likelyTechnician: string | null;
  membershipStatus: string;
  loyaltySummary: string;
  completenessPercent: number;
  inactivityStatus: string;
  duplicateWarning: boolean;
  rebookingEligible: boolean;
  freshness: Freshness;
}

