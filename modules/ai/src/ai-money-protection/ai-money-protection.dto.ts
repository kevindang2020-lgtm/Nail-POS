// ai-money-protection.dto.ts — types + non-accusatory language for the Money Protection module.
// Language rule (spec §1, §25): alerts describe POSSIBLE anomalies requiring review — never accuse a person.
// "CONFIRMED_MISUSE" is a RESOLUTION an authorized human records with evidence; it is never auto-assigned.

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Confidence = 'low' | 'medium' | 'high';

export type AlertStatus =
  | 'NEW' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'WAITING_FOR_INFORMATION' | 'ESCALATED'
  | 'RESOLVED_EXPECTED_ACTIVITY' | 'RESOLVED_SYSTEM_ERROR' | 'RESOLVED_POLICY_VIOLATION'
  | 'RESOLVED_CONFIRMED_MISUSE' | 'DISMISSED_FALSE_POSITIVE' | 'CLOSED';

// Server-derived context (never trust client tenant/branch).
export interface MoneyProtectionContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}

// Structured evidence attached to every alert (spec §9). No card data — masked/tokenized references only.
export interface AlertEvidence {
  summary: string;                       // non-accusatory, plain-language
  triggeredRules: string[];
  currentValues?: Record<string, unknown>;
  baselineValues?: Record<string, unknown>;
  differences?: Record<string, unknown>;
  recommendedReview: string[];
  alternativeExplanations?: string[];
  dataFreshness?: string;
}

export interface RelatedEntities {
  transactionIds?: string[];
  ticketIds?: string[];
  appointmentIds?: string[];
  customerIds?: string[];
  userIds?: string[];
  deviceIds?: string[];
  merchantAccountId?: string | null;
  processorReferences?: string[];
}

// A candidate produced by a deterministic rule, before persistence.
export interface AlertCandidate {
  ruleId: string;
  alertType: string;
  severity: Severity;
  confidence: Confidence;
  riskScore: number;
  amountCents: number;                   // value UNDER REVIEW
  entityFingerprint: string;             // dedup key within (tenant, rule, window)
  evaluationWindow: string;
  branchId: string | null;
  evidence: AlertEvidence;
  related: RelatedEntities;
}

export interface MoneyProtectionAlert extends AlertCandidate {
  id: string;
  tenantId: string;
  status: AlertStatus;
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  assignedUserId: string | null;
  investigationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Command Center read model (spec §56). Honest: value under review is NOT confirmed loss.
export interface MoneyProtectionState {
  newAlerts: number;
  highSeverityAlerts: number;
  criticalAlerts: number;
  openInvestigations: number;
  alertsAwaitingReview: number;
  byType: { type: string; count: number }[];
  valueUnderReviewCents: number;         // sum of open alert amounts — NOT loss
  resolvedFalsePositives: number;
  dataFreshness: string;
  generatedAt: string;
}

// Non-accusatory phrasing helpers — used instead of "fraud"/"theft"/"stole".
export const NONACCUSATORY = {
  possibleAnomaly: 'Possible anomaly — requires review.',
  policyMismatch: 'Policy mismatch — requires review.',
  potentialDuplicate: 'Potential duplicate — requires review.',
  possibleMisuse: 'Possible misuse — requires review.',
  insufficientInformation: 'Insufficient information — requires review.',
  processorSyncIssue: 'Processor synchronization issue — requires review.',
} as const;
