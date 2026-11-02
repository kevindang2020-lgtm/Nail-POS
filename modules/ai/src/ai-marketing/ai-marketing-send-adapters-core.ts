// ai-marketing-send-adapters-core.ts — PURE helpers used by the live send adapters. Kept separate so they can
// be unit-tested without a database or provider.

// Map the communications-limits evaluator result to the send-decision's allow/block. Only a HARD 'block'
// stops a send here; 'warn'/'require_approval' are approval-time concerns and do not block dispatch.
export function toLimitDecision(evalResult: { action: string }): { action: 'allow' | 'block' } {
  return { action: evalResult && evalResult.action === 'block' ? 'block' : 'allow' };
}

// Minutes-of-day helpers for quiet-hours. `start`/`end`/`now` are 0..1439. Supports overnight windows
// (e.g. 21:00→08:00). A null/blank window means "no quiet hours" → never active.
export function isWithinQuietWindow(nowMinutes: number, startMinutes: number | null, endMinutes: number | null): boolean {
  if (startMinutes == null || endMinutes == null) return false;
  if (startMinutes === endMinutes) return false; // zero-length window
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  // overnight wrap
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// Parse "HH:MM" (or "HH:MM:SS") into minutes-of-day, or null if unparseable.
export function hhmmToMinutes(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

// A scheduled campaign is due when its scheduledAt has arrived.
export function dueForSend(status: string, scheduledAtIso: string | null, nowIso: string): boolean {
  // An 'in_progress' campaign is a run that was interrupted (worker restart) or started through Activate — the executor
  // resumes it idempotently (the ledger skips every recipient already handled).
  if (status === 'in_progress') return true;
  if (status !== 'scheduled') return false;
  if (!scheduledAtIso) return false;
  const t = Date.parse(scheduledAtIso);
  const n = Date.parse(nowIso);
  if (Number.isNaN(t) || Number.isNaN(n)) return false;
  return t <= n;
}
