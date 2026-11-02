// membership-actions-core.ts — pure logic for the sensitive tenant-oversight actions: duplicate-charge detection and
// validation for platform corrections and program disabling. No I/O. Detection is an investigation signal only — it
// never triggers an automatic refund. Corrections are compensating entries; originals are never mutated.

export type Check<T> = { ok: boolean; errors: string[]; value: T };

export interface ChargeRow { id: string; membershipId: string; amountCents: number; status: string; createdAt: string; tenant?: string; program?: string; memberNumber?: string | null }
export interface DuplicateCase { membershipId: string; amountCents: number; count: number; paymentIds: string[]; firstAt: string; lastAt: string; tenant?: string; program?: string; memberNumber?: string | null; confidence: 'low' | 'medium' | 'high' }

// Flag groups of >=2 SUCCEEDED charges on the same membership for the same amount within `windowHours`. Tighter time
// gaps score higher confidence. Returns one case per suspicious group; callers investigate before any refund.
export function detectDuplicates(payments: ChargeRow[], windowHours = 48): DuplicateCase[] {
  const succeeded = payments.filter((p) => p.status === 'succeeded');
  const groups = new Map<string, ChargeRow[]>();
  for (const p of succeeded) {
    const key = `${p.membershipId}:${p.amountCents}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const cases: DuplicateCase[] = [];
  const windowMs = windowHours * 3600 * 1000;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    // Only flag when at least two fall within the window of each other.
    let flagged = false; let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) {
      const gap = +new Date(sorted[i].createdAt) - +new Date(sorted[i - 1].createdAt);
      if (gap <= windowMs) { flagged = true; minGap = Math.min(minGap, gap); }
    }
    if (!flagged) continue;
    const confidence = minGap <= 3600 * 1000 ? 'high' : minGap <= 12 * 3600 * 1000 ? 'medium' : 'low';
    const first = sorted[0], last = sorted[sorted.length - 1];
    cases.push({ membershipId: first.membershipId, amountCents: first.amountCents, count: sorted.length, paymentIds: sorted.map((r) => r.id), firstAt: first.createdAt, lastAt: last.createdAt, tenant: first.tenant, program: first.program, memberNumber: first.memberNumber ?? null, confidence });
  }
  return cases;
}

const present = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s.length >= 1 ? s : null; };
const reasonOk = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s.length >= 3 ? s : null; };
const posInt = (v: unknown): number | null => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
const nonNegInt = (v: unknown): number | null => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };

export function validateCorrection(input: any): Check<{ membershipId: string; direction: 'credit' | 'debit'; quantity: number; amountCents: number; reason: string }> {
  const errors: string[] = [];
  const membershipId = present(input?.membershipId); if (!membershipId) errors.push('membershipId is required');
  const direction = input?.direction === 'credit' || input?.direction === 'debit' ? input.direction : (errors.push("direction must be 'credit' or 'debit'"), 'credit');
  const quantity = posInt(input?.quantity); if (quantity == null) errors.push('quantity must be a positive integer');
  const amountCents = nonNegInt(input?.amountCents ?? 0); if (amountCents == null) errors.push('amountCents must be a non-negative integer');
  const reason = reasonOk(input?.reason); if (!reason) errors.push('a reason (min 3 chars) is required for a platform correction');
  return { ok: errors.length === 0, errors, value: { membershipId: membershipId ?? '', direction, quantity: quantity ?? 0, amountCents: amountCents ?? 0, reason: reason ?? '' } };
}

export function validateDisable(input: any): Check<{ reason: string }> {
  const errors: string[] = [];
  const reason = reasonOk(input?.reason); if (!reason) errors.push('a reason (min 3 chars) is required to disable a program');
  return { ok: errors.length === 0, errors, value: { reason: reason ?? '' } };
}

/**
 * Constitution 7 §74–§78 — the memberships screen's "enter support mode" follows the SAME rules as every other Support
 * Mode entry (it used to allow a 3-character reason and up to 240 minutes): a reason of 10+ characters and 15–60 minutes.
 */
export function validateSupportSession(input: any, maxMinutes = 60): Check<{ tenantId: string; reason: string; durationMinutes: number; accessLevel: 'read_only' | 'assist' }> {
  const errors: string[] = [];
  const tenantId = present(input?.tenantId); if (!tenantId) errors.push('tenantId is required');
  const r0 = String(input?.reason ?? '').trim();
  const reason = r0.length >= 10 ? r0 : null; if (!reason) errors.push('a reason of at least 10 characters is required to enter support mode');
  const dm = Math.round(Number(input?.durationMinutes));
  const durationMinutes = Number.isFinite(dm) && dm >= 15 && dm <= Math.min(maxMinutes, 60) ? dm : null;
  if (durationMinutes == null) errors.push(`durationMinutes must be between 15 and ${Math.min(maxMinutes, 60)}`);
  const accessLevel = input?.accessLevel === 'assist' ? 'assist' : 'read_only';
  return { ok: errors.length === 0, errors, value: { tenantId: tenantId ?? '', reason: reason ?? '', durationMinutes: durationMinutes ?? 0, accessLevel } };
}

export interface MembershipRow { membershipId: string; customerId: string; planId: string; status: string; tenant?: string; program?: string; customerName?: string | null }
export interface SuspiciousCase { type: string; customerId: string; customerName?: string | null; membershipIds: string[]; count: number; severity: 'low' | 'medium' | 'high'; tenant?: string }

// Flag a customer holding two or more ACTIVE memberships (a duplicate/abuse signal). Investigation only — never an
// automatic penalty. Grouped per customer within a tenant scope handled by the caller's query.
export function detectSuspicious(rows: MembershipRow[]): SuspiciousCase[] {
  const active = rows.filter((r) => r.status === 'active');
  const byCustomer = new Map<string, MembershipRow[]>();
  for (const r of active) (byCustomer.get(r.customerId) ?? byCustomer.set(r.customerId, []).get(r.customerId)!).push(r);
  const cases: SuspiciousCase[] = [];
  for (const [customerId, list] of byCustomer) {
    if (list.length < 2) continue;
    const severity = list.length >= 4 ? 'high' : list.length === 3 ? 'medium' : 'low';
    cases.push({ type: 'duplicate_active_membership', customerId, customerName: list[0].customerName ?? null, membershipIds: list.map((r) => r.membershipId), count: list.length, severity, tenant: list[0].tenant });
  }
  return cases;
}
