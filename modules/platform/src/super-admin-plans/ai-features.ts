// ai-features.ts — the seven AI features from Super Admin spec §13, with the effective-access rule used by BOTH the
// Super Admin management view and the tenant-facing settings overlay (single source of truth, no duplication):
//   effective(feature) = isAiEnabled(packageTier) AND (explicitOverride ?? true)
// i.e. the package tier gates ALL AI (None → everything off, overrides ignored); explicit rows refine within a tier.
// Plan entitlements for AI features (Constitution 13 §82: entitlements stay platform-controlled). Moved from the Super Admin
// control plane so the tenant settings surface can read them without depending on the control plane (that was a cycle).

/** A tenant's AI package is "on" unless it is empty or 'none'. The ONE definition (super-admin-tenants-core re-exports it). */
export function isAiEnabled(aiPackage: string): boolean {
  const a = (aiPackage || '').trim().toLowerCase();
  return a !== '' && a !== 'none';
}

export const AI_FEATURE_KEYS = [
  'ai_receptionist', 'ai_booking', 'ai_customer_insights', 'ai_reports', 'ai_reminders', 'ai_workflow_assistant', 'voice_assistant',
] as const;
export type AiFeatureKey = typeof AI_FEATURE_KEYS[number];

export function effectiveAiFeatures(packageTier: string, overrides: ReadonlyMap<string, boolean>): Record<AiFeatureKey, boolean> {
  const tierOn = isAiEnabled(packageTier);
  const out = {} as Record<AiFeatureKey, boolean>;
  for (const k of AI_FEATURE_KEYS) out[k] = tierOn && (overrides.get(k) ?? true);
  return out;
}
