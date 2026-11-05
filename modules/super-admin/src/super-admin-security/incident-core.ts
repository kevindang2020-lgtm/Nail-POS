// Pure logic for security incidents. No DB/Nest deps. Controlled severity/category/status vocabularies, a validated
// status state machine (invalid transitions rejected), transition-record assembly (every move preserves actor, reason,
// previous & new state, timestamp, correlation), workflow-stage counting, and a stable incident reference.

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
// cross_tenant_access (Constitution 11's cross-tenant signal) and fraud (Constitution 12's detector) are written by the
// platform's own automatic detectors; they were missing here, so anything filtering by this list never showed the two
// most important kinds of incident. A test now holds every writer's category inside this list.
export const CATEGORIES = ['authentication', 'session', 'privilege', 'data', 'device', 'network', 'cross_tenant_access', 'fraud', 'other'] as const;

/** §196: the platform's severities on the SEV1–SEV4 scale used by the runbooks. */
export function sevLevel(severity: string): 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4' {
  const s = String(severity || '').toLowerCase();
  return s === 'critical' ? 'SEV1' : s === 'high' ? 'SEV2' : s === 'medium' ? 'SEV3' : 'SEV4';
}
export const STATUSES = ['detected', 'investigating', 'contained', 'remediating', 'monitoring', 'closed', 'reopened'] as const;
export type Status = (typeof STATUSES)[number];

export function normalizeSeverity(s: string): string { const v = String(s || '').trim().toLowerCase(); return (SEVERITIES as readonly string[]).includes(v) ? v : 'medium'; }
export function normalizeCategory(c: string): string { const v = String(c || '').trim().toLowerCase(); return (CATEGORIES as readonly string[]).includes(v) ? v : 'other'; }

// The workflow. Detected → Investigating → Contained → Remediating → (Monitoring | Closed); Monitoring → Closed;
// Closed → Reopened (authorized); Reopened → Investigating.
export const TRANSITIONS: Record<string, Status[]> = {
  detected: ['investigating', 'closed'],
  investigating: ['contained', 'closed'],
  contained: ['remediating', 'investigating'],
  remediating: ['monitoring', 'closed', 'investigating'],
  monitoring: ['closed', 'investigating'],
  closed: ['reopened'],
  reopened: ['investigating', 'closed'],
};
export function canTransition(from: string, to: string): boolean { return (TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase() as Status); }

export type TransitionResult = { ok: true; record: { fromStatus: string; toStatus: string; actor: string | null; reason: string | null; correlationId: string | null } } | { ok: false; reason: string };
export function buildTransition(input: { from: string; to: string; actor: string | null; reason: string | null; correlationId: string | null }): TransitionResult {
  const from = String(input.from || '').toLowerCase(), to = String(input.to || '').toLowerCase();
  if (!(STATUSES as readonly string[]).includes(to)) return { ok: false, reason: `unknown status "${input.to}"` };
  if (from === to) return { ok: false, reason: 'status unchanged' };
  if (!canTransition(from, to)) return { ok: false, reason: `invalid transition ${from} → ${to}` };
  // Reopen and close should be justified.
  if ((to === 'reopened' || to === 'closed') && !String(input.reason || '').trim()) return { ok: false, reason: `moving to "${to}" requires a reason` };
  return { ok: true, record: { fromStatus: from, toStatus: to, actor: input.actor ?? null, reason: input.reason ?? null, correlationId: input.correlationId ?? null } };
}

// Reference viewport workflow stages (Closed folds Monitoring; the log keeps them distinct).
export function assembleWorkflowCounts(byStatus: Record<string, number>) {
  const g = (k: string) => byStatus[k] || 0;
  return { detected: g('detected'), investigating: g('investigating'), contained: g('contained'), remediating: g('remediating'), closed: g('closed') + g('monitoring') };
}
export function openStatuses(): string[] { return ['detected', 'investigating', 'contained', 'remediating', 'monitoring', 'reopened']; }
export function isOpen(status: string): boolean { return openStatuses().includes(String(status || '').toLowerCase()); }

export function buildIncidentRef(nowMs: number, seq: number): string {
  const d = new Date(nowMs);
  return `INC-${d.getUTCFullYear()}-${String(seq).padStart(3, '0')}`;
}
