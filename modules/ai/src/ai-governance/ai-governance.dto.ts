/**
 * ai-governance.dto.ts — the human-controlled AI operating model (spec §3–§4). Control modes are stored and ENFORCED
 * on the backend. The enforcement helpers below are the single source of truth for "what may this mode do"; sensitive
 * actions (§4) are gated separately and can never be fully autonomous regardless of mode.
 */
export type ControlMode =
  | 'disabled' | 'observe_only' | 'recommendation_only' | 'draft_only'
  | 'confirm_before_action' | 'approval_required' | 'approved_automation';

export const CONTROL_MODES: ControlMode[] = [
  'disabled', 'observe_only', 'recommendation_only', 'draft_only', 'confirm_before_action', 'approval_required', 'approved_automation',
];
export const DEFAULT_MODE: ControlMode = 'recommendation_only';

export const MODE_LABEL: Record<ControlMode, string> = {
  disabled: 'Disabled', observe_only: 'Observe only', recommendation_only: 'Recommendation only', draft_only: 'Draft only',
  confirm_before_action: 'Confirm before action', approval_required: 'Approval required', approved_automation: 'Approved automation',
};

export const isControlMode = (v: any): v is ControlMode => CONTROL_MODES.includes(v);

/** § risk classes: sensitive actions (§4) are 'sensitive' and can NEVER auto-execute regardless of mode. */
export type ActionRisk = 'low' | 'standard' | 'sensitive';

const order = (m: ControlMode) => CONTROL_MODES.indexOf(m);

/** May the assistant run at all (analyze/observe)? Everything except 'disabled'. */
export const canRun = (m: ControlMode): boolean => m !== 'disabled';
/** May it surface a recommendation? recommendation_only and above. */
export const canRecommend = (m: ControlMode): boolean => canRun(m) && m !== 'observe_only';
/** May it prepare a draft (message/plan/response) for human approval? draft_only and above. */
export const canDraft = (m: ControlMode): boolean => order(m) >= order('draft_only');
/** Does the action require explicit human confirmation/approval before execution? */
export const requiresApproval = (m: ControlMode, risk: ActionRisk = 'standard'): boolean => {
  if (risk === 'sensitive') return true;              // §4 — always human-authorized
  if (m === 'approved_automation') return false;       // pre-authorized low/standard automation
  return order(m) >= order('confirm_before_action') || !canRecommend(m);
};
/** May the action execute automatically with NO human in the loop? Only approved_automation + non-sensitive. */
export const canAutoExecute = (m: ControlMode, risk: ActionRisk = 'standard'): boolean =>
  m === 'approved_automation' && risk !== 'sensitive';

export interface AssistantControl { assistantKey: string; mode: ControlMode; label: string; updatedByUserId: string | null; updatedAt: string | null }
export const withDefaults = (rows: { assistantKey: string; mode: ControlMode; updatedByUserId?: string | null; updatedAt?: string | null }[], keys: string[]): AssistantControl[] => {
  const byKey = new Map(rows.map((r) => [r.assistantKey, r]));
  return keys.map((k) => {
    const r = byKey.get(k);
    const mode = r?.mode ?? DEFAULT_MODE;
    return { assistantKey: k, mode, label: MODE_LABEL[mode], updatedByUserId: r?.updatedByUserId ?? null, updatedAt: r?.updatedAt ?? null };
  });
};
