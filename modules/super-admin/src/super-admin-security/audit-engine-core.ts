// audit-engine-core.ts — pure logic for the Security Audit Engine (no DB/Nest deps).
// The heart of Kevin's flow: findings are DEDUPLICATED by a stable fingerprint, recur without spamming
// (occurrence bump), auto-RESOLVE when a run no longer produces them (re-verify), and REOPEN if they come back.

export const AUDIT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export interface CheckFinding { area: string; title: string; detail: string; severity: AuditSeverity }
export interface StoredFinding { id: string; fingerprint: string; status: 'open' | 'reopened' | 'resolved'; severity: AuditSeverity }

/** Stable dedupe key. Deliberately EXCLUDES detail (counts/timestamps change run to run) and severity
 *  (an escalated finding is still the same finding). */
export function fingerprintOf(f: { area: string; title: string }): string {
  return `${String(f.area).trim().toLowerCase()}|${String(f.title).trim().toLowerCase()}`;
}

export interface ReconcilePlan {
  toInsert: CheckFinding[];                                   // never seen → open (+ incident when critical/high)
  toBump: { id: string; finding: CheckFinding }[];            // still occurring → occurrences++, last_seen
  toReopen: { id: string; finding: CheckFinding }[];          // was resolved, came back → reopened
  toResolve: { id: string }[];                                // open/reopened but absent this run → resolved (re-verified)
}

export function reconcile(existing: StoredFinding[], current: CheckFinding[]): ReconcilePlan {
  const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
  const seen = new Set<string>();
  const plan: ReconcilePlan = { toInsert: [], toBump: [], toReopen: [], toResolve: [] };
  for (const c of current) {
    const fp = fingerprintOf(c);
    if (seen.has(fp)) continue;                                // one row per fingerprint even if two checks emit it
    seen.add(fp);
    const e = byFp.get(fp);
    if (!e) plan.toInsert.push(c);
    else if (e.status === 'resolved') plan.toReopen.push({ id: e.id, finding: c });
    else plan.toBump.push({ id: e.id, finding: c });
  }
  for (const e of existing) {
    if ((e.status === 'open' || e.status === 'reopened') && !seen.has(e.fingerprint)) plan.toResolve.push({ id: e.id });
  }
  return plan;
}

/** Incidents are for humans: only NEW critical/high findings escalate into the Super Admin incident workflow.
 *  Recurrences bump the existing finding (its incident is already open); lower severities stay in the findings list. */
export function needsIncident(f: CheckFinding): boolean {
  return f.severity === 'critical' || f.severity === 'high';
}

// ---------- environment hygiene (pure; unit-tested with fake envs) ----------
export function envHygieneFindings(env: Record<string, string | undefined>): CheckFinding[] {
  const out: CheckFinding[] = [];
  const prod = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const sess = String(env.AUTH_SESSION_SECRET || '');
  if (prod && (!sess || sess.length < 32 || /local-dev-secret/i.test(sess))) {
    out.push({ area: 'config', title: 'AUTH_SESSION_SECRET weak or default in production', severity: 'critical', detail: 'Session signing secret is missing, shorter than 32 chars, or the local-dev default. Rotate to a long random value.' });
  }
  if (prod && String(env.MFA_ENC_KEY || '') === '0123456789abcdef0123456789abcdef') {
    out.push({ area: 'config', title: 'MFA_ENC_KEY is the development default in production', severity: 'critical', detail: 'MFA secrets are encrypted with the publicly known dev key. Rotate immediately.' });
  }
  if (prod && ['1', 'true', 'yes', 'on'].includes(String(env.PAYMENTS_SANDBOX || '').toLowerCase())) {
    out.push({ area: 'payments', title: 'PAYMENTS_SANDBOX enabled in production', severity: 'high', detail: 'Production is pointed at the payments sandbox — real charges are not being captured.' });
  }
  if (prod && !String(env.APP_DATA_ENCRYPTION_KEY || '')) {
    out.push({ area: 'config', title: 'APP_DATA_ENCRYPTION_KEY missing in production', severity: 'high', detail: 'Field-level encryption (EIN, secrets-at-rest) has no key configured.' });
  }
  return out;
}

/** Webhook + CORS + messaging configuration hygiene (pure; spec §6/§9). Production-only, like envHygieneFindings. */
export function webhookCorsFindings(env: Record<string, string | undefined>): CheckFinding[] {
  const out: CheckFinding[] = [];
  const prod = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (!prod) return out;
  const placeholder = (v: string | undefined) => !v || /replace-me|changeme|example|xxx/i.test(v);

  // §9: never trust a webhook merely because it reached the URL — the secrets that make validation possible must exist.
  if (env.TWILIO_ACCOUNT_SID && placeholder(env.TWILIO_AUTH_TOKEN)) {
    out.push({ area: 'webhooks', title: 'Twilio configured without a real auth token (inbound signature validation cannot work)', severity: 'high', detail: 'TWILIO_ACCOUNT_SID is set but TWILIO_AUTH_TOKEN is missing or a placeholder — X-Twilio-Signature verification on /messaging inbound + status callbacks will reject or run unvalidated.' });
  }
  if (placeholder(env.AI_BILLING_WEBHOOK_SECRET) && String(env.AI_BILLING_WEBHOOK_SCHEME || '')) {
    out.push({ area: 'webhooks', title: 'AI billing webhook scheme enabled without a real secret', severity: 'high', detail: 'AI_BILLING_WEBHOOK_SCHEME is set but AI_BILLING_WEBHOOK_SECRET is missing or a placeholder — the endpoint stays 403/disabled or unauthenticated depending on path.' });
  }

  // §2/§6: the CORS allowlist is the browser-side boundary — a wildcard or empty list in production is a hole.
  const cors = String(env.WEB_CORS_ORIGINS || '').trim();
  if (!cors) {
    out.push({ area: 'config', title: 'WEB_CORS_ORIGINS not set in production', severity: 'medium', detail: 'CORS falls back to the hard-coded default origins; deployments on other hosts will break or get widened by hand. Set the allowlist explicitly.' });
  } else if (cors.split(',').some((o) => o.trim() === '*')) {
    out.push({ area: 'config', title: 'CORS allowlist contains a wildcard in production', severity: 'high', detail: 'WEB_CORS_ORIGINS includes "*" — any origin may call the API from a browser.' });
  } else if (cors.split(',').some((o) => o.trim().startsWith('http://') && !/localhost|127\.0\.0\.1/.test(o))) {
    out.push({ area: 'config', title: 'CORS allowlist contains a non-TLS origin in production', severity: 'medium', detail: 'A plain-http origin (not localhost) is allowlisted — session cookies would flow over cleartext from that origin.' });
  }
  return out;
}
