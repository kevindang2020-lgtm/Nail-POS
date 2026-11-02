// queue-pii-mask.ts — Super Admin queue oversight shows customers MASKED by default (Oct 12 2026 merge; other-chat
// workforce audit #63: "queue screen shows unmasked customer names cross-tenant with export; reads not audited").
//
// A platform operator monitoring queue health across thousands of salons needs counts, waits, states and stuck items —
// not who is sitting in which chair. Names are therefore masked ("Grace Kim" → "G•••• K.") on every read and every
// export. The ONE way to see a salon's real names is SUPPORT MODE for that salon (live-queue-actions.service
// supportModeTenant): a LIVE Phase 14 support_access_sessions row this admin holds for the tenant (expiry honoured) — and
// even then only that tenant's rows unmask. (Oct 28 2026: a remote-support request opened from the queue screen no longer
// unmasks — it had no step-up and no salon approval. SUPPORT_MODE_WINDOW_HOURS is kept for the exported contract only.) Rows that carry no tenantId (stuck list, timelines) always stay masked. Every read
// and export is audited with whether it unmasked. Pure: no I/O.
const NAME_KEYS = new Set(['customer', 'customerName']);

export function maskName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const head = first.charAt(0).toUpperCase() + '•'.repeat(Math.max(2, Math.min(4, first.length - 1)));
  const last = parts.length > 1 ? ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : '';
  return head + last;
}

/** Deep copy with every customer-name field masked, except rows that carry `tenantId === unmaskTenantId`. */
export function maskQueuePii<T>(value: T, unmaskTenantId: string | null = null): T {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object' || v instanceof Date || Buffer.isBuffer(v)) return v;
    const keep = unmaskTenantId != null && v.tenantId === unmaskTenantId;
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = NAME_KEYS.has(k) && typeof x === 'string' && !keep ? maskName(x) : walk(x);
    return out;
  };
  return walk(value);
}

/** How long a controlled-support request opened from the queue screen unmasks its salon (the Phase 14 session row has its own expiry). */
export const SUPPORT_MODE_WINDOW_HOURS = 4;
