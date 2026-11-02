// platform-approvals.ts — Constitution 7 §119 / §120 / §182: maker/checker for critical platform actions.
//
// An action registered here runs DIRECTLY when its policy is off (the default — a single operator is never locked out)
// and becomes a REQUEST when the policy platform_settings 'approvals.<action>.required' is true. A request is executed
// only when ANOTHER platform user holding the action's required permission approves it before it expires; the requester
// can never approve their own (service rule + database CHECK). Every step is audited. Payloads never carry secrets.
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Injectable, NotFoundException, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, RequirePermission, RequireStepUp } from '@aipowersalon/permissions/guards';
import { PlatformApprovalsControllerListQueries } from './platform-approvals.list-queries';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { APPROVAL_DECISION_BODY, APPROVAL_POLICY_BODY } from '../request-schemas';
import { canMoveToSql } from '@aipowersalon/database';
import { PLATFORM_APPROVAL } from '../platform-lifecycles';

export interface ApprovalActor { userId: string | null; permissions: readonly string[] }
export interface ApprovableAction { key: string; label: string; requiredPermission: string; execute: (payload: any, actor: ApprovalActor) => Promise<unknown> }
export const APPROVAL_TTL_HOURS = 24;
export const MIN_APPROVAL_REASON = 10;
export type RunOrRequest = { executed: true; result: unknown } | { executed: false; approvalId: string; expiresAt: string };

@Injectable()
export class PlatformApprovals {
  private readonly actions = new Map<string, ApprovableAction>();
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  register(a: ApprovableAction): void { this.actions.set(a.key, a); }
  registered(): ApprovableAction[] { return [...this.actions.values()]; }

  async required(action: string): Promise<boolean> {
    if (!this.db) return false;
    const r: any = await sql`select value from platform_settings where setting_key = ${`approvals.${action}.required`} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    const v = r.rows[0]?.value; return v === true || v === 'true';
  }

  private async audit(trx: any, actorId: string | null, action: string, entityId: string, meta: Record<string, unknown>) {
    await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
              values (${actorId}, 'SUPER_ADMIN', ${action}, 'platform_approval', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(trx);
  }

  /** Run the action now (policy off) or file it for a second person (policy on). */
  async runOrRequest(key: string, payload: any, reason: string, actor: ApprovalActor, targetRef: string | null = null): Promise<RunOrRequest> {
    const a = this.actions.get(key);
    if (!a) throw new BadRequestException({ code: 'unknown_action', message: `No approvable action '${key}'.` });
    if (!(await this.required(key))) return { executed: true, result: await a.execute(payload, actor) };
    if (!actor.userId) throw new ForbiddenException('A signed-in platform user is required.');
    if ((reason ?? '').trim().length < MIN_APPROVAL_REASON) throw new BadRequestException({ code: 'reason_required', message: `This change needs a second approver; give a reason of at least ${MIN_APPROVAL_REASON} characters.` });
    return this.db.transaction().execute(async (trx: any) => {
      const r: any = await sql`insert into platform_approvals (action_type, target_ref, payload, reason, requested_by, required_permission, expires_at)
                               values (${key}, ${targetRef}, ${JSON.stringify(payload ?? {})}::jsonb, ${reason.trim()}, ${actor.userId}, ${a.requiredPermission}, now() + (${APPROVAL_TTL_HOURS} * interval '1 hour'))
                               returning id, expires_at`.execute(trx);
      await this.audit(trx, actor.userId, 'approval_requested', String(r.rows[0].id), { action: key, targetRef, reason: reason.trim() });
      return { executed: false as const, approvalId: String(r.rows[0].id), expiresAt: new Date(r.rows[0].expires_at).toISOString() };
    });
  }

  async list(status = 'pending') {
    if (!this.db) return { rows: [] };
    await sql`update platform_approvals set status = 'expired' where ${canMoveToSql(PLATFORM_APPROVAL, 'expired')} and status = 'pending' and expires_at <= now()`.execute(this.db);
    const r = await sql<any>`select a.*, u.email as requested_by_email from platform_approvals a left join users u on u.id = a.requested_by
                              where ${status === 'all' ? sql`true` : sql`a.status = ${status}`} order by a.created_at desc limit 100`.execute(this.db);
    return { rows: r.rows.map((x: any) => ({ id: String(x.id), action: x.action_type, label: this.actions.get(x.action_type)?.label ?? x.action_type, targetRef: x.target_ref,
      payload: x.payload, reason: x.reason, requestedBy: String(x.requested_by), requestedByEmail: x.requested_by_email ?? null, requiredPermission: x.required_permission,
      status: x.status, approvedBy: x.approved_by, decisionNote: x.decision_note, expiresAt: new Date(x.expires_at).toISOString(), createdAt: new Date(x.created_at).toISOString() })) };
  }

  /** The checker: another platform user holding the required permission; executes immediately; audited. */
  async approve(id: string, actor: ApprovalActor, note?: string) {
    if (!this.db) throw new BadRequestException('Approvals need the database.');
    const row: any = await this.db.transaction().execute(async (trx: any) => {
      const x: any = (await sql`select * from platform_approvals where id = ${id} for update`.execute(trx)).rows[0];
      if (!x) throw new NotFoundException('Approval request not found.');
      if (x.status !== 'pending') throw new BadRequestException({ code: 'not_pending', message: `This request is ${x.status}.` });
      if (new Date(x.expires_at).getTime() <= Date.now()) { await sql`update platform_approvals set status = 'expired' where id = ${id} and ${canMoveToSql(PLATFORM_APPROVAL, 'expired')}`.execute(trx); throw new BadRequestException({ code: 'expired', message: 'This request has expired.' }); }
      if (String(x.requested_by) === actor.userId) throw new ForbiddenException({ code: 'separation', message: 'You cannot approve your own request.' });
      if (!actor.permissions.includes(String(x.required_permission))) throw new ForbiddenException({ code: 'forbidden', message: `Approving this needs ${x.required_permission}.` });
      await sql`update platform_approvals set status = 'approved', approved_by = ${actor.userId}, decision_note = ${note ?? null}, decided_at = now() where id = ${id} and ${canMoveToSql(PLATFORM_APPROVAL, 'approved')}`.execute(trx);
      await this.audit(trx, actor.userId, 'approval_approved', id, { action: x.action_type, note: note ?? null });
      return x;
    });
    const a = this.actions.get(String(row.action_type));
    try {
      const result = a ? await a.execute(row.payload, { userId: String(row.requested_by), permissions: actor.permissions }) : { error: 'action no longer registered' };
      await sql`update platform_approvals set status = ${a ? 'executed' : 'failed'}, executed_at = now(), result = ${JSON.stringify(result ?? null)}::jsonb where id = ${id} and ${canMoveToSql(PLATFORM_APPROVAL, a ? 'executed' : 'failed')}`.execute(this.db);
      return { ok: !!a, status: a ? 'executed' : 'failed', result };
    } catch (e) {
      await sql`update platform_approvals set status = 'failed', executed_at = now(), result = ${JSON.stringify({ error: (e as Error).message })}::jsonb where id = ${id} and ${canMoveToSql(PLATFORM_APPROVAL, 'failed')}`.execute(this.db);
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }

  /** Each registered action and whether it currently needs a second approver. */
  async policies() {
    return Promise.all(this.registered().map(async (a) => ({ action: a.key, label: a.label, requiredPermission: a.requiredPermission, required: await this.required(a.key) })));
  }

  /** Turn maker/checker on or off for one action — platform_roles.manage + step-up (route) + reason; setting + history + audit. */
  async setPolicy(action: string, required: boolean, reason: string, actor: ApprovalActor) {
    if (!this.db) throw new BadRequestException('Approvals need the database.');
    if (!this.actions.has(action)) throw new BadRequestException({ code: 'unknown_action', message: `No approvable action '${action}'.` });
    if (!actor.permissions.includes('super_admin.platform_roles.manage')) throw new ForbiddenException({ code: 'forbidden', message: 'Changing approval policy requires super_admin.platform_roles.manage.' });
    if ((reason ?? '').trim().length < MIN_APPROVAL_REASON) throw new BadRequestException({ code: 'reason_required', message: `A reason of at least ${MIN_APPROVAL_REASON} characters is required.` });
    const key = `approvals.${action}.required`;
    await this.db.transaction().execute(async (trx: any) => {
      const prev: any = (await sql`select value, version from platform_settings where setting_key = ${key} for update`.execute(trx)).rows[0];
      await sql`insert into platform_settings (setting_key, setting_group, value, value_type, version) values (${key}, 'approvals', ${JSON.stringify(required)}::jsonb, 'boolean', 1)
                on conflict (setting_key) do update set value = excluded.value, version = platform_settings.version + 1, updated_at = now()`.execute(trx);
      await sql`insert into platform_setting_changes (setting_key, setting_group, previous_value, new_value, version, actor, actor_role, reason, source)
                values (${key}, 'approvals', ${prev ? JSON.stringify(prev.value) : null}::jsonb, ${JSON.stringify(required)}::jsonb, ${Number(prev?.version ?? 0) + 1}, ${actor.userId}, 'SUPER_ADMIN', ${reason.trim()}, 'ui')`.execute(trx);
      await this.audit(trx, actor.userId, 'approval_policy_changed', action, { action, required, reason: reason.trim() });
    });
    return this.policies();
  }

  async reject(id: string, actor: ApprovalActor, note: string) {
    if (!this.db) throw new BadRequestException('Approvals need the database.');
    if ((note ?? '').trim().length < MIN_APPROVAL_REASON) throw new BadRequestException({ code: 'reason_required', message: `Say why (at least ${MIN_APPROVAL_REASON} characters).` });
    return this.db.transaction().execute(async (trx: any) => {
      const r: any = await sql`update platform_approvals set status = 'rejected', approved_by = null, decision_note = ${note.trim()}, decided_at = now()
                               where id = ${id} and ${canMoveToSql(PLATFORM_APPROVAL, 'rejected')} returning action_type`.execute(trx);
      if (!r.rows.length) throw new BadRequestException({ code: 'not_pending', message: 'Only a pending request can be rejected.' });
      await this.audit(trx, actor.userId, 'approval_rejected', id, { action: r.rows[0].action_type, note: note.trim() });
      return { ok: true, status: 'rejected' };
    });
  }
}

const actorOf = (req: any): ApprovalActor => ({ userId: req?.ctx?.userId ?? null, permissions: Array.isArray(req?.ctx?.permissions) ? req.ctx.permissions : [] });

@UseGuards(SuperAdminGuard)
@ListQueries(PlatformApprovalsControllerListQueries)
@Controller('super-admin/approvals')
export class PlatformApprovalsController {
  constructor(private readonly approvals: PlatformApprovals) {}
  @Get() @RequirePermission('super_admin.tenants.view')
  list(@Query('status') status?: string) { return this.approvals.list(status || 'pending'); }
  @RequireStepUp()
  @Post(':id/approve') approve(@Param('id') id: string, @Body(ValidatedBody(APPROVAL_DECISION_BODY, { strict: true })) b: { note?: string }, @Req() req: any) { return this.approvals.approve(id, actorOf(req), b?.note); }
  @Get('policies') @RequirePermission('super_admin.tenants.view')
  policies() { return this.approvals.policies(); }
  @RequireStepUp()
  @Post('policies/:action') @RequirePermission('super_admin.platform_roles.manage')
  setPolicy(@Param('action') action: string, @Body(ValidatedBody(APPROVAL_POLICY_BODY, { strict: true })) b: { required?: boolean; reason?: string }, @Req() req: any) { return this.approvals.setPolicy(action, b?.required === true, String(b?.reason ?? ''), actorOf(req)); }
  @Post(':id/reject') reject(@Param('id') id: string, @Body(ValidatedBody(APPROVAL_DECISION_BODY, { strict: true })) b: { note?: string }, @Req() req: any) { return this.approvals.reject(id, actorOf(req), String(b?.note ?? '')); }
}
