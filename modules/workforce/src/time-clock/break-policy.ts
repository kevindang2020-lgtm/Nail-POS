// break-policy.ts — PURE break classification (Fair Turn Engine mandate §31–40, migration 603).
//
// The queue never decides pay. A TIME-CLOCK break's compensable treatment comes from the salon's BREAK POLICY, never
// from queue code (§35). The documented default is the U.S. federal shape: short rest breaks (roughly 5–20 minutes) are
// compensable; a bona fide meal period of 30+ minutes with the employee relieved of duty may be non-compensable. A state
// can be more protective — the owner configures it (jurisdiction is recorded, not interpreted). A meal that was cut short
// (§36 BREAK_INTERRUPTED) is never recorded as a full uninterrupted meal.

export interface BreakPolicy {
  /** a label the owner chose (US-FEDERAL, US-NJ, CUSTOM, …) — recorded with the classification, never interpreted */
  jurisdiction: string;
  /** rest break minutes that are paid; longer rest breaks: the excess is unpaid */
  restBreakPaidUpToMinutes: number;
  /** a meal shorter than this is not a bona fide meal period → paid */
  mealBreakMinMinutes: number;
  /** a meal interrupted by work is compensable (§36) */
  interruptedMealCompensable: boolean;
  /** what each time-clock break kind is: 'rest' | 'meal' */
  kindDefaults: { break: 'rest' | 'meal'; lunch: 'rest' | 'meal' };
}
export const DEFAULT_BREAK_POLICY: Readonly<BreakPolicy> = Object.freeze({
  jurisdiction: 'US-FEDERAL', restBreakPaidUpToMinutes: 20, mealBreakMinMinutes: 30, interruptedMealCompensable: true, kindDefaults: { break: 'rest', lunch: 'meal' },
} as BreakPolicy);
export type BreakClassification = 'paid_rest' | 'unpaid_rest_excess' | 'unpaid_meal' | 'paid_meal_short' | 'paid_meal_interrupted';

export function validateBreakPolicy(p: unknown): string[] {
  const out: string[] = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['The break policy must be an object.'];
  const o = p as Record<string, unknown>;
  const allowed = new Set(Object.keys(DEFAULT_BREAK_POLICY));
  for (const k of Object.keys(o)) if (!allowed.has(k)) out.push(`Unknown break policy setting "${k}".`);
  if (o.jurisdiction !== undefined && !(typeof o.jurisdiction === 'string' && /^[A-Z0-9-]{2,32}$/.test(o.jurisdiction))) out.push('jurisdiction is a short code such as US-FEDERAL or US-NJ.');
  for (const [k, max] of [['restBreakPaidUpToMinutes', 120], ['mealBreakMinMinutes', 240]] as const) if (o[k] !== undefined && !(Number.isInteger(o[k]) && (o[k] as number) >= 0 && (o[k] as number) <= max)) out.push(`${k} must be a whole number from 0 to ${max}.`);
  if (o.interruptedMealCompensable !== undefined && typeof o.interruptedMealCompensable !== 'boolean') out.push('interruptedMealCompensable must be true or false.');
  if (o.kindDefaults !== undefined) {
    const kd = o.kindDefaults as Record<string, unknown>;
    if (!kd || typeof kd !== 'object' || Array.isArray(kd) || Object.entries(kd).some(([k, v]) => !['break', 'lunch'].includes(k) || !['rest', 'meal'].includes(String(v)))) out.push("kindDefaults maps break / lunch to 'rest' or 'meal'.");
  }
  return out;
}
export function mergeBreakPolicy(layers: { salon: unknown; branch: unknown }): BreakPolicy {
  const out: any = { ...DEFAULT_BREAK_POLICY, kindDefaults: { ...DEFAULT_BREAK_POLICY.kindDefaults } };
  for (const l of [layers.salon, layers.branch]) {
    const o = typeof l === 'string' ? (() => { try { return JSON.parse(l); } catch { return null; } })() : l;
    if (!o || typeof o !== 'object') continue;
    if (validateBreakPolicy(o).length) continue;
    for (const [k, v] of Object.entries(o)) out[k] = k === 'kindDefaults' ? { ...out.kindDefaults, ...(v as object) } : v;
  }
  return out as BreakPolicy;
}

/** §35–36, §40: paid / unpaid minutes of one break under the policy. */
export function classifyBreak(policy: BreakPolicy, b: { kind: string | null | undefined; minutes: number; interrupted: boolean }): { classification: BreakClassification; paidMinutes: number; unpaidMinutes: number } {
  const minutes = Math.max(0, Math.round(b.minutes));
  const type = (policy.kindDefaults as Record<string, 'rest' | 'meal'>)[String(b.kind ?? 'break')] ?? (b.kind === 'lunch' ? 'meal' : 'rest');
  if (type === 'rest') {
    const paid = Math.min(minutes, policy.restBreakPaidUpToMinutes);
    return { classification: minutes > paid ? 'unpaid_rest_excess' : 'paid_rest', paidMinutes: paid, unpaidMinutes: minutes - paid };
  }
  if (b.interrupted && policy.interruptedMealCompensable) return { classification: 'paid_meal_interrupted', paidMinutes: minutes, unpaidMinutes: 0 };
  if (minutes < policy.mealBreakMinMinutes) return { classification: 'paid_meal_short', paidMinutes: minutes, unpaidMinutes: 0 };
  return { classification: 'unpaid_meal', paidMinutes: 0, unpaidMinutes: minutes };
}

/** §40: one technician's day — clocked − unpaid break = eligible worked time; paid / unpaid kept separately. */
export function dailyHours(punches: { startMs: number; endMs: number | null }[], breaks: { paidMinutes: number; unpaidMinutes: number }[], nowMs: number): { clockedMinutes: number; paidBreakMinutes: number; unpaidBreakMinutes: number; eligibleWorkedMinutes: number } {
  const clocked = Math.round(punches.reduce((s, p) => s + Math.max(0, ((p.endMs ?? nowMs) - p.startMs) / 60000), 0));
  const paid = breaks.reduce((s, b) => s + b.paidMinutes, 0); const unpaid = breaks.reduce((s, b) => s + b.unpaidMinutes, 0);
  return { clockedMinutes: clocked, paidBreakMinutes: paid, unpaidBreakMinutes: unpaid, eligibleWorkedMinutes: Math.max(0, clocked - unpaid) };
}
