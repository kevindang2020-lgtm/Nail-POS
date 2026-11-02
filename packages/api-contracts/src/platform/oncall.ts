// oncall.ts — BUILD_PLAN Phase 14 C (Constitution 11 §262–265, §80, §92–95, §114–117): the wire types of Super Admin →
// On-call & monitoring (GET/POST/PUT /super-admin/oncall/*) and of the SLO validation verdicts on System Operations.

export type OnCallChannel = 'email' | 'sms' | 'push';
export type OnCallRole = 'primary' | 'secondary' | 'incident_commander' | 'other';

export interface OnCallContact {
  id: string; position: number; role: OnCallRole; name: string; channel: OnCallChannel; destination: string;
  /** Alert owners this contact covers; empty = every owner. */
  owners: string[];
  quietStart: string | null; quietEnd: string | null; timezone: string; active: boolean; updatedAt: string;
}
export interface OnCallContacts { contacts: OnCallContact[]; owners: readonly string[]; channels: readonly OnCallChannel[] }

export interface OnCallContactInput {
  position: number; role: OnCallRole; name: string; channel: OnCallChannel; destination: string;
  owners?: string[] | null; quietStart?: string | null; quietEnd?: string | null; timezone?: string | null; active?: boolean | null;
  /** Audited. */
  reason: string;
}

export type OnCallStepOutcome = 'sent' | 'failed' | 'not_configured' | 'skipped_quiet_hours' | 'chain_exhausted';
export interface OnCallEscalationStep { step: number; contact: string | null; channel: OnCallChannel | null; outcome: OnCallStepOutcome; notifiedAt: string | null; escalatedAt: string | null }
export interface OnCallBoardAlert {
  id: string; title: string; severity: string; status: string; owner: string;
  createdAt: string | null; notifiedAt: string | null; resolvedAt: string | null;
  acknowledgedAt: string | null; acknowledgedVia: 'screen' | 'email_link' | 'alerts_screen' | null;
  steps: OnCallEscalationStep[];
}
export interface OnCallBoard { alerts: OnCallBoardAlert[] }

export interface SyntheticProbeRow { probe: string; outcome: 'pass' | 'fail' | 'skipped'; detail: string; durationMs: number; consecutiveFailures: number; ranAt: string }
export interface SyntheticMonitoring {
  /** The ONE salon the kiosk probe may read — null until a Super Admin designates one (then the probe is "not configured"). */
  testTenant: { id: string; name: string | null; reason: string | null; updatedAt: string } | null;
  probes: SyntheticProbeRow[];
}

export interface BackupMonitoring {
  summary: {
    lastSuccessfulBackupAt: string | null; lastBackupStatus: 'success' | 'failure' | null; lastBackupAt: string | null; backupAgeHours: number | null;
    pitrEnabled: boolean | null; lastDrillAt: string | null; lastDrillOk: boolean | null; lastDrillDetail: string | null;
  } | null;
  evaluation: { status: 'HEALTHY' | 'DEGRADED' | 'OUTAGE' | 'UNKNOWN' | 'MAINTENANCE'; reason: string; summary: Record<string, number | string | null> };
  maxAgeHours: number;
}

export type SloVerdict = 'proposed' | 'validated' | 'breached';
/** §80: an SLO's verdict from persisted production data (proposed until enough days of real traffic exist). */
export interface SloValidation {
  id: string; name: string; status: SloVerdict; target: number; windowDays: number; requiredDays: number; daysWithData: number;
  total: number; bad: number; sli: number | null; evaluatedAt: string | null; validatedAt: string | null; breachedAt: string | null;
}

/** POST /super-admin/oncall/alerts/:id/acknowledge — stops the chain; the alert stays open until it resolves. */
export interface OnCallAcknowledgement { acknowledged: boolean }
/** DELETE-by-POST /super-admin/oncall/contacts/:id/remove — audited. */
export interface OnCallContactRemoval { reason: string }
/** PUT /super-admin/oncall/synthetic — null clears the designation. Audited. */
export interface SyntheticTestSalonInput { testTenantId: string | null; reason: string }
/** GET/POST /public/alert-ack?t= — the signed, single-use, expiring acknowledgement token from the on-call email / SMS. */
export type AlertAckLinkToken = string;
