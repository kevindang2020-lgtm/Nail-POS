// ai-branch-policy.ts — Four-Module Completion Guide (Oct 30 2026) §12 / AI-02: per-branch AI OPERATIONAL settings.
// Pure: no I/O. One tenant-level AI subscription and ONE shared quota stay the billing model; a branch can only narrow it.
//
// Inheritance (first match wins):
//   1. Global policy      Super Admin switch (platform_ai_package_settings)        off → off for every branch
//   2. Tenant entitlement the salon's subscription (tenant_ai_subscriptions)      not entitled → off; a branch cannot enable it
//   3. Branch override    tenant_ai_branch_settings.override_enabled             false → off for that branch; true / NULL → inherit
//   4. User permission    RBAC ai.use (checked by the gate after the branch)
// The access gate (ai-access-gate.ts) enforces the same order; this file names the outcome for the screen.
//
// settings_json is validated per package against BRANCH_SETTING_FIELDS (unknown keys and wrong types are refused). These
// are stored, versioned, audited and shown; the gate enforces only override_enabled. Feature modules may read the settings.

export type BranchEffective = 'on' | 'off_platform' | 'off_not_entitled' | 'off_branch';
export type BranchEffectiveSource = 'platform' | 'tenant' | 'branch' | 'inherit';

export function effectiveBranchAccess(i: { globallyEnabled: boolean; tenantEntitled: boolean; override: boolean | null }): { effective: BranchEffective; source: BranchEffectiveSource } {
  if (!i.globallyEnabled) return { effective: 'off_platform', source: 'platform' };
  if (!i.tenantEntitled) return { effective: 'off_not_entitled', source: 'tenant' };
  if (i.override === false) return { effective: 'off_branch', source: 'branch' };
  return { effective: 'on', source: i.override === true ? 'branch' : 'inherit' };
}

export type BranchSettingField = { key: string; type: 'boolean' };
const APPROVAL: BranchSettingField = { key: 'requireManagerApproval', type: 'boolean' };
/** the operational settings a branch may store per package (booleans only — no free text, no money, no limits) */
export const BRANCH_SETTING_FIELDS: Record<string, BranchSettingField[]> = {
  ai_booking_assistant: [{ key: 'autoConfirmBookings', type: 'boolean' }, APPROVAL],
  ai_phone_call_assistant: [{ key: 'afterHoursOnly', type: 'boolean' }, { key: 'transferToFrontDesk', type: 'boolean' }],
  ai_queue_technician_assignment: [{ key: 'autoAssignWalkIns', type: 'boolean' }],
  ai_marketing_assistant: [APPROVAL],
  ai_checkout_upsell_assistant: [{ key: 'showAtCheckout', type: 'boolean' }],
  ai_reception_copilot: [{ key: 'showAtCheckIn', type: 'boolean' }],
  ai_review_reputation_assistant: [APPROVAL],
};
export const branchSettingFields = (code: string): BranchSettingField[] => BRANCH_SETTING_FIELDS[code] ?? [APPROVAL];

export type SettingsCheck = { ok: true; value: Record<string, boolean> } | { ok: false; reason: string };
export function validateBranchSettings(code: string, raw: unknown): SettingsCheck {
  if (raw == null) return { ok: true, value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'settings must be an object' };
  const fields = new Map(branchSettingFields(code).map((f) => [f.key, f]));
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = fields.get(k);
    if (!f) return { ok: false, reason: `unknown setting "${k.slice(0, 40)}" for this package` };
    if (typeof v !== 'boolean') return { ok: false, reason: `setting "${k}" must be true or false` };
    out[k] = v;
  }
  return { ok: true, value: out };
}
