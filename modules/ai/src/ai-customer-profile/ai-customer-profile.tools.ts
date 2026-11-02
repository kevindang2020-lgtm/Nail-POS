// ai-customer-profile.tools.ts — the ONLY customer-intelligence surface the AI model may call (spec §29/§30).
// Guarantees encoded here:
//   • The model supplies NO table/column/SQL/predicate/join/tenantId/branchId. It may supply at most a `customerId`
//     (validated as a plain id) plus bounded, enumerated params. Tenant/branch/permissions come from the trusted
//     server context that the caller (controller/copilot) injects — never from model output.
//   • Every tool is read-only and delegates to AiCustomerProfileService (which delegates to existing domain services).
//   • Result/scan breadth is bounded by the underlying services; no unrestricted history is exposed.
import type { AiCustomerProfileService } from './ai-customer-profile.service';
import type { AiCustomerProfileContext } from './ai-customer-profile.dto';

export interface ToolInput { customerId?: string; groupId?: string; primaryCustomerId?: string; limit?: number; before?: string; }

export interface ToolDef {
  name: string;
  description: string;
  /** allowed model-supplied params (besides the server-injected context). */
  params: 'customerId' | 'none' | 'merge';
  readOnly: true;
  run(svc: AiCustomerProfileService, ctx: AiCustomerProfileContext, input: ToolInput): Promise<unknown>;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function requireCustomerId(input: ToolInput): string {
  const id = String(input?.customerId ?? '').trim();
  if (!id || !ID_RE.test(id)) throw new Error('CUSTOMER_NOT_FOUND');
  return id;
}
function requireId(v: unknown, err: string): string {
  const id = String(v ?? '').trim();
  if (!id || !ID_RE.test(id)) throw new Error(err);
  return id;
}

export const AI_CUSTOMER_PROFILE_TOOLS: ReadonlyArray<ToolDef> = Object.freeze([
  { name: 'get_customer_profile_context', description: 'Assembled overview card for one customer.', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.overview(c, requireCustomerId(i)) },
  { name: 'get_customer_visit_summary', description: 'Honest completed-visit summary (§10).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.visitSummary(c, requireCustomerId(i)) },
  { name: 'get_customer_service_preferences', description: 'Likely service preferences with evidence (§11).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.servicePreferences(c, requireCustomerId(i)) },
  { name: 'get_customer_technician_preferences', description: 'Likely technician preference, requested-vs-assigned (§12).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.technicianPreference(c, requireCustomerId(i)) },
  { name: 'get_customer_branch_preferences', description: 'Preferred branch (saved signal; visit-inference pending read-model field) (§13).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.branchPreference(c, requireCustomerId(i)) },
  { name: 'detect_customer_inactivity', description: 'Inactivity classification honoring future appointments (§14).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.inactivity(c, requireCustomerId(i)) },
  { name: 'get_customer_profile_completeness', description: 'Data-quality completeness only (§18).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.completeness(c, requireCustomerId(i)) },
  { name: 'find_duplicate_customer_candidates', description: 'Existing dedup groups + confidence label (§16). Never merges.', params: 'none', readOnly: true,
    run: (s, c) => s.duplicates(c) },
  { name: 'evaluate_customer_churn_risk', description: 'Cautious, explainable churn-risk range with evidence (§15/§33).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.churnRisk(c, requireCustomerId(i)) },
  { name: 'recommend_customer_services', description: 'Service recommendations from real history, active-catalog gated (§19).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.serviceRecommendations(c, requireCustomerId(i)) },
  { name: 'recommend_customer_rebooking', description: 'Advisory rebooking opportunity; booking handed off to AI Booking (§21).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.rebooking(c, requireCustomerId(i)) },
  // request_customer_merge is READ-ONLY: it returns a merge PREVIEW only. Execution is never model-invocable (§7);
  // it requires a separate confirmed, permission-gated controller call.
  { name: 'request_customer_merge', description: 'Prepare a duplicate-merge preview (surviving record + what moves). Never executes (§16/§47).', params: 'merge', readOnly: true,
    run: (s, c, i) => s.mergePreview(c, requireId(i.groupId, 'DUPLICATE_REVIEW_REQUIRED'), requireId(i.primaryCustomerId, 'CUSTOMER_NOT_FOUND')) },
  { name: 'get_customer_timeline', description: 'Unified, bounded, cursor-paginated customer history (§23).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.timeline(c, requireCustomerId(i), { limit: i.limit, before: i.before }) },
  { name: 'get_customer_call_summary', description: 'Verified AI Phone call summary; no transcript/recording (§24).', params: 'customerId', readOnly: true,
    run: (s, c, i) => s.callSummary(c, requireCustomerId(i)) },
]);

export const AI_CUSTOMER_PROFILE_TOOL_NAMES = AI_CUSTOMER_PROFILE_TOOLS.map(t => t.name);

/** Dispatch a tool by name with a TRUSTED context. Unknown/mutating names are rejected. */
export async function runAiCustomerProfileTool(
  svc: AiCustomerProfileService, ctx: AiCustomerProfileContext, name: string, input: ToolInput = {},
): Promise<unknown> {
  const tool = AI_CUSTOMER_PROFILE_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error('UNKNOWN_TOOL'); // model cannot invoke anything outside this frozen registry
  return tool.run(svc, ctx, input);
}
