// ai-tool-registry.ts — Constitution 10 §29–§35, §134–§135: what an AI may ask the system to DO, and the gate
// every such request passes through.
//
// The single most important rule here is §32: **a model asking for a tool does not grant permission.** The
// model's request is an input to an authorization decision, never the decision itself. And §135: tenantId,
// branchId and actorId are injected by this layer from the trusted request context — a model that emits
// `{"tenantId": "someone-else"}` is not choosing a tenant, it is being ignored.
//
// Every task in the Task Registry still declares `allowedTools: []`. This file makes it POSSIBLE to declare a
// tool; it does not grant one. Turning a tool on for a task is a separate, deliberate act, and §35 means a tool
// that performs an action (rather than reading) needs a human in the loop by policy, not by convention.
import type { RiskLevel } from './ai-task-registry';
import { validate, AiOutputSchemaInvalid, type Rule } from './ai-output-schemas';
import { hasPermission } from '@aipowersalon/permissions';

/** §33: AI never runs as the tenant owner. */
export const AI_AGENT_PRINCIPAL = 'AI_AGENT' as const;

export interface ToolDefinition {
  /** §30 `domain.verb`. */
  key: string;
  description: string;
  /** §30 input schema — validated before the tool is entered (§134). Server-derived fields are NOT declared here. */
  input: Rule;
  /** §30/§32: the permission the ACTOR must hold. The AI agent borrows the initiating user's authority, never more. */
  requiredPermission: string;
  /** §30: does this tool read, or does it change something? §35 keeps the two apart. */
  effect: 'read' | 'propose' | 'write';
  risk: RiskLevel;
  /** §30: human approval before execution. A `write` tool may not set this false. */
  requiresApproval: boolean;
  /** §30: a write tool must be idempotent — a retried AI job must not double-book. */
  idempotent: boolean;
  /** §30: every invocation is audited. There is no "quiet" tool; the flag exists so the rule is visible. */
  audit: true;
  rationale: string;
}

const O = (fields: Record<string, Rule>, optional: readonly string[] = []): Rule => ({ t: 'object', fields, optional });
const S = (max: number): Rule => ({ t: 'string', max });
const T = (d: ToolDefinition) => d;

/**
 * §31. Read and propose only. There is deliberately no tool that books, charges, refunds, messages a customer,
 * or changes a permission — §31 lists those as "Not", and §40 puts them outside AI entirely.
 */
export const AI_TOOLS: Readonly<Record<string, ToolDefinition>> = Object.freeze({
  'booking.search_availability': T({
    key: 'booking.search_availability', description: 'Find open appointment slots for a service in a date range.',
    input: O({ service_id: S(64), date_from: S(10), date_to: S(10), technician_id: S(64) }, ['technician_id']),
    requiredPermission: 'pos.booking.view', effect: 'read', risk: 'LOW', requiresApproval: false, idempotent: true, audit: true,
    rationale: 'Reads the schedule the actor can already see. Finding a slot is not taking one.',
  }),
  'customer.lookup_limited': T({
    key: 'customer.lookup_limited', description: 'Look up a customer by id and return a MINIMAL profile: display name, visit cadence, preferred technician.',
    input: O({ customer_id: S(64) }),
    requiredPermission: 'pos.customers.view', effect: 'read', risk: 'MEDIUM', requiresApproval: false, idempotent: true, audit: true,
    rationale: '§58 data minimization is in the tool\'s NAME: it returns a limited projection, never the customer record. '
      + 'Phone, email and payment history are not fields this tool can return.',
  }),
  'appointment.create_proposal': T({
    key: 'appointment.create_proposal', description: 'Record a PROPOSED appointment for a human to confirm. Creates no booking.',
    input: O({ customer_id: S(64), service_id: S(64), starts_at: S(32), technician_id: S(64) }, ['technician_id']),
    requiredPermission: 'pos.booking.create', effect: 'propose', risk: 'MEDIUM', requiresApproval: true, idempotent: true, audit: true,
    rationale: '§35: recommending is not doing. This writes a proposal row; a human turns it into a booking. '
      + 'There is no appointment.create tool, and adding one would put an LLM in charge of the calendar.',
  }),
  // Neither of these takes a branch argument, and that is the point. §135 makes branchId server-derived, so a
  // model must no more choose a branch than a tenant. Both were first written with `branch_id` in their input
  // schema; the invariant test caught it. The consequence is deliberate: the AI reads the branch the ACTOR is
  // working in, and a multi-branch tenant's assistant cannot reach across branches by asking nicely.
  'schedule.read': T({
    key: 'schedule.read', description: 'Read the technician schedule for the actor\'s branch on a date.',
    input: O({ date: S(10) }),
    requiredPermission: 'pos.booking.view', effect: 'read', risk: 'LOW', requiresApproval: false, idempotent: true, audit: true,
    rationale: 'Read-only view of data the actor already has, scoped to the branch the server says they are in.',
  }),
  'queue.read': T({
    key: 'queue.read', description: 'Read the current check-in queue for the actor\'s branch.',
    input: O({}),
    requiredPermission: 'pos.queue.view', effect: 'read', risk: 'LOW', requiresApproval: false, idempotent: true, audit: true,
    rationale: 'Read-only, branch from server context. The assignment decision stays with the deterministic engine (§45).',
  }),
  'review.create_response_draft': T({
    key: 'review.create_response_draft', description: 'Save a draft reply to a review for a human to review and send.',
    input: O({ review_id: S(64), draft_text: S(700) }),
    requiredPermission: 'pos.ai_review_reputation.manage', effect: 'propose', risk: 'MEDIUM', requiresApproval: true, idempotent: true, audit: true,
    rationale: '§193: publishing under the salon name is a human act. This tool saves a draft and nothing else.',
  }),
});

/** §31: names that must never become tools, asserted by test so the list cannot quietly acquire one. */
export const FORBIDDEN_TOOL_PATTERNS: readonly RegExp[] = Object.freeze([
  /sql|database\.|db\./i, /execute|eval|exec/i, /refund/i, /payment|charge|capture/i,
  /permission|role|grant|suspend/i, /delete|drop|truncate/i, /send_(sms|email|message)/i,
]);

// ---------------------------------------------------------------------------------------------------------------
// §32/§134/§135 the gateway
// ---------------------------------------------------------------------------------------------------------------
/** §135: injected by the server from the authenticated request. A model cannot supply or override any of these. */
export interface ServerToolContext {
  tenantId: string;
  branchId: string | null;
  /** The human whose authority the AI is borrowing. */
  actorUserId: string | null;
  permissions: readonly string[];
  /** The task that is allowed to call tools at all. */
  taskKey: string;
  /** Tools this task declares (AI_TASKS[taskKey].allowedTools). */
  allowedTools: readonly string[];
}

export type ToolDenialReason = 'unknown_tool' | 'not_allowed_for_task' | 'permission_denied' | 'approval_required' | 'invalid_arguments' | 'context_override_attempt';

export class ToolDenied extends Error {
  readonly status: number;
  constructor(readonly reason: ToolDenialReason, readonly toolKey: string, detail?: string) {
    super(`Tool "${toolKey}" denied: ${reason}${detail ? ` — ${detail}` : ''}`);
    this.name = 'ToolDenied';
    this.status = reason === 'permission_denied' ? 403 : reason === 'approval_required' ? 202 : 400;
  }
}

/** §135: keys a model may never set. If the model emits one, that is a signal worth recording, not a merge conflict. */
export const SERVER_OWNED_KEYS = Object.freeze(['tenantId', 'tenant_id', 'branchId', 'branch_id', 'actorId', 'actor_id', 'actorUserId', 'userId', 'user_id', 'permissions', 'role']);

export interface ToolInvocation { toolKey: string; args: Record<string, unknown> }
export interface AuthorizedToolCall {
  tool: ToolDefinition;
  /** Validated model arguments, with server context merged in LAST so it always wins. */
  args: Record<string, unknown>;
  context: ServerToolContext;
  /** §33 audit envelope. */
  audit: { initiatedByUser: string | null; agent: typeof AI_AGENT_PRINCIPAL; approvedByUser: string | null; executedByService: string; toolKey: string; taskKey: string };
  /** True when the tool needs a human to approve before it runs (§30/§35). */
  pendingApproval: boolean;
  /** §135: server-owned keys the model tried to set. Empty in the normal case. */
  rejectedOverrides: string[];
}

/**
 * §32's chain, in order: known tool → allowed for this task → actor permission → argument validation →
 * server context injection → approval. Each step can only narrow. Nothing the model said is trusted at any step.
 */
export function authorizeToolCall(inv: ToolInvocation, ctx: ServerToolContext, opts: { approvedByUser?: string | null } = {}): AuthorizedToolCall {
  const tool = (AI_TOOLS as Record<string, ToolDefinition>)[inv.toolKey];
  if (!tool) throw new ToolDenied('unknown_tool', inv.toolKey, 'not in the AI Tool Registry (§29)');
  // §32: the TASK decides which tools exist for this call. A model naming a real tool it was not given is denied.
  if (!ctx.allowedTools.includes(tool.key)) throw new ToolDenied('not_allowed_for_task', tool.key, `task ${ctx.taskKey} does not declare it`);
  // §32: the ACTOR's permission, not the model's request.
  // BUILD_PLAN Phase 9 (bug 7): decided exactly like the route guards — hasPermission, so a session holding the CATALOG
  // key (booking.view) satisfies a tool declared with its legacy route key (pos.booking.view). The exact `.includes`
  // this replaced matched nothing a real session carries. The AI_AGENT never holds a platform key.
  if (!hasPermission({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? '', userId: ctx.actorUserId ?? '', role: AI_AGENT_PRINCIPAL as any, permissions: [...ctx.permissions] }, tool.requiredPermission)) throw new ToolDenied('permission_denied', tool.key, `actor lacks ${tool.requiredPermission}`);

  // §135: strip server-owned keys BEFORE validation, and record the attempt. A model that tried to set tenantId
  // is not merged with — it is overruled, and the attempt is visible to whoever reads the audit row.
  const rejectedOverrides: string[] = [];
  const modelArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inv.args ?? {})) {
    if (SERVER_OWNED_KEYS.includes(k)) { rejectedOverrides.push(k); continue; }
    modelArgs[k] = v;
  }

  // §134: validate what is left against the tool's declared schema.
  let validated: Record<string, unknown>;
  try { validated = validate<Record<string, unknown>>(`tool:${tool.key}`, modelArgs, tool.input); }
  catch (e) { throw new ToolDenied('invalid_arguments', tool.key, e instanceof AiOutputSchemaInvalid ? e.problems.slice(0, 3).join('; ') : String(e)); }

  // §135: server context goes in LAST so it cannot be overwritten by anything above.
  const args = { ...validated, tenantId: ctx.tenantId, branchId: ctx.branchId, actorUserId: ctx.actorUserId };

  const pendingApproval = tool.requiresApproval && !opts.approvedByUser;
  return {
    tool, args, context: ctx,
    audit: { initiatedByUser: ctx.actorUserId, agent: AI_AGENT_PRINCIPAL, approvedByUser: opts.approvedByUser ?? null, executedByService: 'ai-platform', toolKey: tool.key, taskKey: ctx.taskKey },
    pendingApproval, rejectedOverrides,
  };
}

/** §32: the executor refuses to run a call that still needs approval — the check is not advisory. */
export async function executeToolCall<T>(call: AuthorizedToolCall, run: (args: Record<string, unknown>) => Promise<T>): Promise<T> {
  if (call.pendingApproval) throw new ToolDenied('approval_required', call.tool.key, 'a human must approve before this tool runs (§35)');
  return run(call.args);
}
