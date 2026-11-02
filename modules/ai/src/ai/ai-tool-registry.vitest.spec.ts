// ai-tool-registry.vitest.spec — Constitution 10 §29–§35, §134–§135.
import { describe, it, expect, vi } from 'vitest';
import { AI_TOOLS, FORBIDDEN_TOOL_PATTERNS, SERVER_OWNED_KEYS, AI_AGENT_PRINCIPAL, authorizeToolCall, executeToolCall, ToolDenied, type ServerToolContext } from './ai-tool-registry';
import { AI_TASKS } from './ai-task-registry';
import { permissionsFor, ROLE_PERMISSIONS, requiredCapability, PERMISSIONS } from '@aipowersalon/permissions';

const ctx = (over: Partial<ServerToolContext> = {}): ServerToolContext => ({
  tenantId: 'tenant-A', branchId: 'branch-1', actorUserId: 'user-1',
  permissions: ['pos.booking.view', 'pos.customers.view', 'pos.booking.create', 'pos.reviews.respond', 'pos.schedule.view', 'pos.queue.view'],
  taskKey: 'receptionist.reply_draft', allowedTools: ['booking.search_availability', 'appointment.create_proposal'], ...over,
});
const search = { toolKey: 'booking.search_availability', args: { service_id: 'svc1', date_from: '2026-09-21', date_to: '2026-09-28' } };

describe('§29/§31 the registry is a closed list of read and propose tools', () => {
  it('no tool name matches a forbidden pattern — no SQL, no refunds, no permissions, no sending', () => {
    for (const key of Object.keys(AI_TOOLS)) for (const re of FORBIDDEN_TOOL_PATTERNS) expect(re.test(key), `${key} vs ${re}`).toBe(false);
    for (const forbidden of ['database.query', 'execute_sql', 'refund_any_payment', 'change_permissions', 'appointment.create', 'send_sms']) expect(AI_TOOLS[forbidden]).toBeUndefined();
  });
  it('§35 no tool has effect "write": the registry can only read or propose', () => {
    for (const t of Object.values(AI_TOOLS)) expect(t.effect, t.key).not.toBe('write');
  });
  it('every propose tool requires approval and is idempotent; everything is audited', () => {
    for (const t of Object.values(AI_TOOLS)) {
      if (t.effect === 'propose') { expect(t.requiresApproval, t.key).toBe(true); expect(t.idempotent, t.key).toBe(true); }
      expect(t.audit, t.key).toBe(true);
      expect(t.requiredPermission, t.key).toMatch(/^[a-z]+\./);
      expect(t.rationale.length, t.key).toBeGreaterThan(30);
    }
  });
  it('§32 no task has been granted a tool yet — this file makes tools POSSIBLE, it does not grant one', () => {
    for (const t of Object.values(AI_TASKS)) expect(t.allowedTools, t.key).toEqual([]);
  });
});

describe('§32 a model asking for a tool does not grant permission', () => {
  it('authorizes a legitimate call', () => {
    const call = authorizeToolCall(search, ctx());
    expect(call.tool.key).toBe('booking.search_availability');
    expect(call.pendingApproval).toBe(false);
    expect(call.audit).toMatchObject({ initiatedByUser: 'user-1', agent: AI_AGENT_PRINCIPAL, approvedByUser: null, executedByService: 'ai-platform' });
  });
  it('denies a tool that does not exist', () => {
    expect(() => authorizeToolCall({ toolKey: 'execute_sql', args: {} }, ctx())).toThrow(ToolDenied);
    try { authorizeToolCall({ toolKey: 'execute_sql', args: {} }, ctx()); } catch (e) { expect((e as ToolDenied).reason).toBe('unknown_tool'); }
  });
  it('denies a REAL tool the task was not granted', () => {
    try { authorizeToolCall({ toolKey: 'queue.read', args: {} }, ctx()); expect.unreachable(); }
    catch (e) { expect((e as ToolDenied).reason).toBe('not_allowed_for_task'); }
  });
  it('denies when the ACTOR lacks the permission, even though the task allows the tool', () => {
    try { authorizeToolCall(search, ctx({ permissions: [] })); expect.unreachable(); }
    catch (e) { expect((e as ToolDenied).reason).toBe('permission_denied'); expect((e as ToolDenied).status).toBe(403); }
  });
});

// BUILD_PLAN Phase 9, Constitution 2 audit bug 7: the gate compared `ctx.permissions.includes('pos.booking.view')`
// EXACTLY — but a real session carries the CATALOG keys (booking.view …) the guard maps pos.* keys onto. The day a task
// was granted a tool, every staff member — the owner included — would have been refused.
describe('Phase 9 bug 7 — the tool gate decides like the guards (hasPermission), against real sessions', () => {
  const real = (role: keyof typeof ROLE_PERMISSIONS) => ctx({ permissions: permissionsFor(role as any), allowedTools: Object.keys(AI_TOOLS) });
  it('a front-desk session holding booking.view may search availability', () => {
    expect(authorizeToolCall(search, real('FRONT_DESK')).tool.key).toBe('booking.search_availability');
  });
  it('an owner session may use every tool', () => {
    const args: Record<string, Record<string, unknown>> = {
      'booking.search_availability': search.args, 'customer.lookup_limited': { customer_id: 'c1' },
      'appointment.create_proposal': { customer_id: 'c1', service_id: 's1', starts_at: '2026-10-09T10:00:00Z' },
      'schedule.read': { date: '2026-10-09' }, 'queue.read': {}, 'review.create_response_draft': { review_id: 'r1', draft_text: 'Thank you!' },
    };
    for (const key of Object.keys(AI_TOOLS)) expect(authorizeToolCall({ toolKey: key, args: args[key] ?? {} }, real('OWNER')).tool.key, key).toBe(key);
  });
  it('every tool\'s requiredPermission resolves to a catalog key (else the tool denies everyone)', () => {
    for (const t of Object.values(AI_TOOLS)) expect((PERMISSIONS as readonly string[]), t.key).toContain(requiredCapability(t.requiredPermission));
  });
  it('a technician session (no customers.export, no marketing) is still refused the review-draft tool', () => {
    try { authorizeToolCall({ toolKey: 'review.create_response_draft', args: { review_id: 'r1', draft_text: 'x' } }, real('TECHNICIAN')); expect.unreachable(); }
    catch (e) { expect((e as ToolDenied).reason).toBe('permission_denied'); }
  });
});

describe('§134/§135 server-derived context — the model cannot choose a tenant', () => {
  it('a model-supplied tenantId is REJECTED and recorded, and the real tenant is used', () => {
    const call = authorizeToolCall({ toolKey: 'booking.search_availability', args: { ...search.args, tenantId: 'tenant-B', actorUserId: 'owner-9' } }, ctx());
    expect(call.args.tenantId).toBe('tenant-A');            // server context wins
    expect(call.args.actorUserId).toBe('user-1');
    expect(call.rejectedOverrides.sort()).toEqual(['actorUserId', 'tenantId']);
  });
  it('NO tool schema declares a server-owned key — the layer that makes the other two reliable', () => {
    // Three things independently stop a model from choosing a tenant: server keys are stripped before
    // validation, validation drops undeclared keys, and server context is merged LAST. Mutation testing showed
    // the first and third can each be removed without failing a test — because the second still catches it.
    // The second only holds while no tool DECLARES a colliding field, which is what this test pins. If a tool
    // ever adds `tenantId` to its input schema, this fails and the other two layers become load-bearing again.
    for (const t of Object.values(AI_TOOLS)) {
      const fields = t.input.t === 'object' ? Object.keys(t.input.fields) : [];
      for (const f of fields) expect(SERVER_OWNED_KEYS, `${t.key}.${f}`).not.toContain(f);
    }
  });
  it('every server-owned key alias is stripped, not merged', () => {
    const args: Record<string, unknown> = { ...search.args };
    for (const k of SERVER_OWNED_KEYS) args[k] = 'attacker';
    const call = authorizeToolCall({ toolKey: 'booking.search_availability', args }, ctx());
    expect(call.rejectedOverrides.sort()).toEqual([...SERVER_OWNED_KEYS].sort());
    expect(call.args.tenantId).toBe('tenant-A'); expect(call.args.branchId).toBe('branch-1');
    expect(Object.values(call.args)).not.toContain('attacker');
  });
  it('§134 arguments are validated against the tool schema: wrong type, missing field, over-long all denied', () => {
    const bad = (args: Record<string, unknown>) => { try { authorizeToolCall({ toolKey: 'booking.search_availability', args }, ctx()); expect.unreachable(); } catch (e) { expect((e as ToolDenied).reason).toBe('invalid_arguments'); } };
    bad({ service_id: 'svc1', date_from: '2026-09-21' });                     // missing date_to
    bad({ service_id: 123, date_from: '2026-09-21', date_to: '2026-09-28' }); // wrong type
    bad({ service_id: 'x'.repeat(200), date_from: '2026-09-21', date_to: '2026-09-28' });
  });
  it('an undeclared argument is dropped, never passed to the tool', () => {
    const call = authorizeToolCall({ toolKey: 'booking.search_availability', args: { ...search.args, include_all_tenants: true } }, ctx());
    expect(call.args).not.toHaveProperty('include_all_tenants');
  });
});

describe('§35 human in the loop', () => {
  const propose = { toolKey: 'appointment.create_proposal', args: { customer_id: 'c1', service_id: 's1', starts_at: '2026-09-22T14:00:00Z' } };
  it('a propose tool is pendingApproval and the executor REFUSES to run it', async () => {
    const call = authorizeToolCall(propose, ctx());
    expect(call.pendingApproval).toBe(true);
    const run = vi.fn();
    await expect(executeToolCall(call, run)).rejects.toMatchObject({ reason: 'approval_required' });
    expect(run).not.toHaveBeenCalled();                     // the check is not advisory
  });
  it('with an approver it runs, and the audit records who approved', async () => {
    const call = authorizeToolCall(propose, ctx(), { approvedByUser: 'manager-7' });
    expect(call.pendingApproval).toBe(false);
    expect(call.audit.approvedByUser).toBe('manager-7');
    await expect(executeToolCall(call, async (a) => a.tenantId)).resolves.toBe('tenant-A');
  });
  it('a read tool runs without approval', async () => {
    await expect(executeToolCall(authorizeToolCall(search, ctx()), async () => 'ok')).resolves.toBe('ok');
  });
});
