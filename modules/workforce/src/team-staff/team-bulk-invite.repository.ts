// team-bulk-invite.repository.ts — extras 200-Technician Large Salon 08 (round 11, Nov 13 2026): bulk INVITE from Team
// Management's Quick Bulk Staff Actions, built as a MECHANISM that is OFF until Kevin turns it on (he decides message volume
// and consent). The per-person invite (Add Team Member / technician create-link) is untouched either way.
//
//   available   the salon's switch (tenant_settings 'staff'.bulk_invites_enabled, default false) AND the platform kill switch
//               (platform_settings 'staff.bulk_invites_disabled', Super Admin → Kill switches) not on. While not available the
//               preview still explains who would get what, and the run is refused with the reason — nothing is sent.
//   preview     the SAME plan the run uses (planFor): per selected member — will invite by email / SMS, or skipped and why
//               (no contact, already active, invited in the last 24 hours, no login account, role above yours, not found).
//               Writes nothing.
//   run         at most 200 people (hard ceiling); a run key makes a retry return the first run's answer (never a second
//               send); each person goes through the existing invite sender (user_invitations — a pending invitation gets a
//               fresh token, otherwise a new one — then InvitationDelivery); the outcome per person is recorded on the run
//               (migration 967) and the run is audited. No token and no full contact ever leaves in the answer.
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { mintInvitationToken, invitationExpiry } from '@aipowersalon/identity';
import { canMoveToSql } from '@aipowersalon/database';
import { STAFF_BULK_INVITE_RUN } from '../workforce-lifecycles';
import { UUID, err, canAny, logGap, branchOf, maskPhone, type TeamCtx } from '../team-screens/screen-kit';
import { writeAuditRow } from '../team-screens/audit-rows';
import { defaultDeliver, type DeliverPort } from './team-onboarding.repository';

/** the hard safety ceiling of one run — not a volume decision (Kevin decides that by turning the switch on) */
export const BULK_INVITE_MAX = 200;
export const BULK_INVITE_SETTING_CATEGORY = 'staff';
export const BULK_INVITE_KILL_SWITCH = 'staff.bulk_invites_disabled';
export const BULK_INVITE_RECENT_HOURS = 24;
export const BULK_INVITE_SKIP_REASONS = ['no_contact', 'already_active', 'recently_invited', 'no_login_account', 'role_above_yours', 'not_current', 'not_found'] as const;
export type BulkInviteSkipReason = (typeof BULK_INVITE_SKIP_REASONS)[number];
export type BulkInviteOffReason = 'salon_setting_off' | 'platform_paused';
/** authority of an account base (the onboarding rule: you only invite below your own level) */
const LEVEL: Record<string, number> = { SUPER_ADMIN: 9, OWNER: 9, MANAGER: 3, FRONT_DESK: 2, RECEPTION: 2, TECHNICIAN: 1 };

export interface BulkInviteAvailability { tenantEnabled: boolean; platformPaused: boolean; available: boolean; offReason: BulkInviteOffReason | null; maxPerRun: number; recentHours: number; updatedAt: string | null }
export interface BulkInvitePlanItem { memberId: string; name: string; action: 'invite' | 'skip'; channel: 'email' | 'sms' | null; contactHint: string | null; reason: BulkInviteSkipReason | null }
export interface BulkInvitePlanView { availability: BulkInviteAvailability; selected: number; willInvite: number; skipped: number; byReason: Partial<Record<BulkInviteSkipReason, number>>; items: BulkInvitePlanItem[] }
export interface BulkInviteOutcome { memberId: string; outcome: 'sent' | 'not_delivered' | 'skipped' | 'failed'; reason: string | null; channel: 'email' | 'sms' | null }
export interface BulkInviteRunView { runId: string; replayed: boolean; selected: number; sent: number; notDelivered: number; skipped: number; failed: number; outcomes: BulkInviteOutcome[]; createdAt: string | null }

interface Target { memberId: string; userId: string | null; name: string; email: string | null; phone: string | null; accountRole: string; userStatus: string | null; current: boolean; recent: boolean }
const maskEmail = (e: string) => { const [u, d] = e.split('@'); return d ? `${u.slice(0, 1)}•••@${d}` : '•••'; };

export class TeamBulkInviteRepository {
  private readonly deliverer: DeliverPort;
  constructor(private readonly db: Kysely<any>, deliverer?: DeliverPort, private readonly rt: RealtimeEmitter | null = null) { this.deliverer = deliverer ?? defaultDeliver(db); }
  private level(ctx: TeamCtx) { return canAny(ctx, 'ownership.transfer') ? 4 : canAny(ctx, 'roles.manage') ? 3 : 0; }
  private need(ctx: TeamCtx) { if (this.level(ctx) < 3) throw err(403, 'PERMISSION_DENIED', 'You do not have permission to invite team members.'); }

  /** the salon switch + the platform kill switch. Absent rows = off / not paused. */
  async availability(ctx: TeamCtx): Promise<BulkInviteAvailability> {
    const t = (await sql<{ enabled: boolean | null; updated_at: string | Date | null }>`select (settings_json ->> 'bulk_invites_enabled')::boolean as enabled, updated_at from tenant_settings
      where tenant_id = ${ctx.tenantId} and branch_id is null and category = ${BULK_INVITE_SETTING_CATEGORY} limit 1`.execute(this.db)).rows[0];
    const p = (await sql<{ value: unknown }>`select value from platform_settings where setting_key = ${BULK_INVITE_KILL_SWITCH} limit 1`.execute(this.db)).rows[0];
    const tenantEnabled = t?.enabled === true; const platformPaused = p ? (p.value === true || p.value === 'true') : false;
    return { tenantEnabled, platformPaused, available: tenantEnabled && !platformPaused, offReason: platformPaused ? 'platform_paused' : !tenantEnabled ? 'salon_setting_off' : null,
      maxPerRun: BULK_INVITE_MAX, recentHours: BULK_INVITE_RECENT_HOURS, updatedAt: t?.updated_at ? new Date(t.updated_at).toISOString() : null };
  }

  /** the salon turns bulk invites on / off (settings permission at the route). Audited with before / after. */
  async setEnabled(ctx: TeamCtx, body: { enabled?: unknown }): Promise<BulkInviteAvailability> {
    if (typeof body?.enabled !== 'boolean') throw err(400, 'VALIDATION_FAILED', 'Say whether bulk invites are on or off.', { field: 'enabled' });
    const before = await this.availability(ctx);
    await this.db.transaction().execute(async (trx) => {
      await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id, updated_at)
        values (${ctx.tenantId}, null, ${BULK_INVITE_SETTING_CATEGORY}, ${JSON.stringify({ bulk_invites_enabled: body.enabled })}::jsonb, ${UUID.test(String(ctx.userId)) ? ctx.userId : null}, now())
        on conflict (tenant_id, category) where branch_id is null do update set settings_json = tenant_settings.settings_json || excluded.settings_json, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.bulk_invite.setting_changed', resourceType: 'tenant_setting', resourceId: null,
        summary: `Bulk invites turned ${body.enabled ? 'on' : 'off'}`, before: { enabled: before.tenantEnabled }, after: { enabled: body.enabled } });
    });
    notifySettingsChanged(this.rt, ctx.tenantId, BULK_INVITE_SETTING_CATEGORY);   // after the switch committed
    return this.availability(ctx);
  }

  /** the ids a caller sent: well-formed uuids, de-duplicated; more than the ceiling is refused (never silently cut) */
  private ids(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : [];
    const ids = [...new Set(list.map((x) => String(x ?? '').trim().toLowerCase()).filter((x) => UUID.test(x)))];
    if (list.length > BULK_INVITE_MAX || ids.length > BULK_INVITE_MAX) throw err(400, 'VALIDATION_FAILED', `Invite at most ${BULK_INVITE_MAX} people at a time.`, { field: 'memberIds', max: BULK_INVITE_MAX });
    if (!ids.length) throw err(400, 'VALIDATION_FAILED', 'Choose who to invite.', { field: 'memberIds' });
    return ids;
  }

  /** the selected members as Team Management sees them (users of this salon in the branch scope, login-less technicians) */
  private async targets(ctx: TeamCtx, ids: string[]): Promise<Map<string, Target>> {
    const T = ctx.tenantId; const b = branchOf(ctx);
    const brU = b ? sql`(u.branch_id = ${b} or u.branch_id is null or te.branch_id = ${b} or exists (select 1 from user_branch_access ba where ba.tenant_id = ${T} and ba.user_id = u.id and ba.branch_id = ${b}))` : sql`true`;
    const brX = b ? sql`(tx.branch_id = ${b} or tx.branch_id is null)` : sql`true`;
    const recent = (uid: unknown, email: unknown, phone: unknown) => sql`exists (select 1 from user_invitations i where i.tenant_id = ${T}
        and (i.user_id = ${uid} or (${email}::text is not null and lower(i.email) = lower(${email}::text)) or (${phone}::text is not null and i.normalized_phone = ${phone}::text))
        and greatest(i.created_at, coalesce(i.last_sent_at, i.created_at)) > now() - (${BULK_INVITE_RECENT_HOURS} * interval '1 hour'))`;
    const users = (await sql<{ member_id: string; user_id: string; name: string; email: string | null; phone: string | null; account_role: string; user_status: string | null; current: boolean; recent: boolean }>`
      select u.id as member_id, u.id as user_id,
             coalesce(nullif(u.full_name, ''), nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), nullif(te.full_name, ''), 'Team member') as name,
             nullif(lower(coalesce(u.email, te.email)), '') as email, nullif(coalesce(u.normalized_phone, te.normalized_phone), '') as phone, upper(coalesce(u.role, '')) as account_role,
             u.status as user_status, (te.archived_at is null and coalesce(u.status, 'active') not in ('archived', 'deleted', 'disabled', 'suspended', 'inactive')) as current,
             ${recent(sql`u.id`, sql`coalesce(u.email, te.email)`, sql`coalesce(u.normalized_phone, te.normalized_phone)`)} as recent
        from users u left join lateral (select t2.full_name, t2.email, t2.normalized_phone, t2.branch_id, t2.archived_at from technicians t2 where t2.tenant_id = ${T} and t2.user_id = u.id
          order by (t2.archived_at is null) desc, t2.created_at desc, t2.id desc limit 1) te on true
       where u.tenant_id = ${T} and u.id = any(${ids}::uuid[]) and upper(coalesce(u.role, '')) not in ('CUSTOMER', 'SUPER_ADMIN') and ${brU}`.execute(this.db)).rows;
    const techs = (await sql<{ member_id: string; name: string; archived: boolean }>`select tx.id as member_id, coalesce(nullif(tx.full_name, ''), nullif(trim(coalesce(tx.first_name, '') || ' ' || coalesce(tx.last_name, '')), ''), 'Technician') as name,
        (tx.archived_at is not null) as archived from technicians tx
       where tx.tenant_id = ${T} and tx.id = any(${ids}::uuid[]) and ${brX} and (tx.user_id is null or not exists (select 1 from users u3 where u3.tenant_id = ${T} and u3.id = tx.user_id))`.execute(this.db)).rows;
    const out = new Map<string, Target>();
    for (const u of users) out.set(String(u.member_id), { memberId: String(u.member_id), userId: String(u.user_id), name: String(u.name), email: u.email, phone: u.phone, accountRole: String(u.account_role), userStatus: u.user_status, current: !!u.current, recent: !!u.recent });
    for (const t of techs) if (!out.has(String(t.member_id))) out.set(String(t.member_id), { memberId: String(t.member_id), userId: null, name: String(t.name), email: null, phone: null, accountRole: 'TECHNICIAN', userStatus: null, current: !t.archived, recent: false });
    return out;
  }

  /** ONE plan for the preview and the run */
  private async planFor(ctx: TeamCtx, ids: string[]): Promise<{ items: BulkInvitePlanItem[]; targets: Map<string, Target> }> {
    const targets = await this.targets(ctx, ids); const mine = this.level(ctx);
    const items = ids.map((id): BulkInvitePlanItem => {
      const t = targets.get(id);
      const skip = (reason: BulkInviteSkipReason, name = t?.name ?? '—'): BulkInvitePlanItem => ({ memberId: id, name, action: 'skip', channel: null, contactHint: null, reason });
      if (!t) return skip('not_found', '—');
      if (!t.current) return skip('not_current');
      if (!t.userId) return skip('no_login_account');   // creating an account is the per-person flow (it decides the role)
      if ((LEVEL[t.accountRole] ?? 9) >= mine) return skip('role_above_yours');
      if (String(t.userStatus ?? 'active').toLowerCase() === 'active') return skip('already_active');
      if (!t.email && !t.phone) return skip('no_contact');
      if (t.recent) return skip('recently_invited');
      const channel: 'email' | 'sms' = t.email ? 'email' : 'sms';   // the per-person rule: email when there is one, else SMS
      return { memberId: id, name: t.name, action: 'invite', channel, contactHint: channel === 'email' ? maskEmail(t.email!) : maskPhone(t.phone), reason: null };
    });
    return { items, targets };
  }

  /** read-only: who would get what, by which channel, who is skipped and why. Writes nothing, sends nothing. */
  async preview(ctx: TeamCtx, body: { memberIds?: unknown }): Promise<BulkInvitePlanView> {
    this.need(ctx);
    const ids = this.ids(body?.memberIds);
    const [availability, plan] = await Promise.all([this.availability(ctx), this.planFor(ctx, ids)]);
    return this.view(availability, plan.items);
  }
  private view(availability: BulkInviteAvailability, items: BulkInvitePlanItem[]): BulkInvitePlanView {
    const byReason: Partial<Record<BulkInviteSkipReason, number>> = {};
    for (const i of items) if (i.reason) byReason[i.reason] = (byReason[i.reason] ?? 0) + 1;
    const willInvite = items.filter((i) => i.action === 'invite').length;
    return { availability, selected: items.length, willInvite, skipped: items.length - willInvite, byReason, items };
  }

  /** the run: refused while off; idempotent per run key; at most BULK_INVITE_MAX; each person through the existing sender */
  async run(ctx: TeamCtx, body: { memberIds?: unknown; runKey?: unknown }, requestId: string): Promise<BulkInviteRunView> {
    this.need(ctx);
    const T = ctx.tenantId;
    const runKey = typeof body?.runKey === 'string' ? body.runKey.trim() : '';
    if (runKey.length < 8 || runKey.length > 200) throw err(400, 'VALIDATION_FAILED', 'A run key (8–200 characters) is required.', { field: 'runKey' });
    const ids = this.ids(body?.memberIds);
    const hash = createHash('sha256').update([...ids].sort().join(',')).digest('hex');
    const prior = await this.storedRun(T, runKey);
    if (prior) return this.replay(prior, hash);
    const availability = await this.availability(ctx);
    if (!availability.available) {
      await writeAuditRow(this.db, ctx, { module: 'workforce', action: 'team.bulk_invite.refused', resourceType: 'team', resourceId: null, status: 'denied', severity: 'info',
        summary: `Bulk invite refused (${availability.offReason})`, metadata: { offReason: availability.offReason, selected: ids.length }, requestId }).catch(logGap('team_bulk_invite_refusal_not_recorded'));
      throw err(409, 'CONFLICT', availability.offReason === 'platform_paused' ? 'Bulk invites are paused for every salon right now.' : 'Bulk invites are turned off for this salon.', { offReason: availability.offReason });
    }
    const claimed = (await sql<{ id: string }>`insert into staff_bulk_invite_runs (tenant_id, branch_id, run_key, request_hash, requested_by_user_id, selected_count)
      values (${T}, ${branchOf(ctx)}, ${runKey}, ${hash}, ${UUID.test(String(ctx.userId)) ? ctx.userId : null}, ${ids.length})
      on conflict (tenant_id, run_key) do nothing returning id`.execute(this.db)).rows[0];
    if (!claimed) { const again = await this.storedRun(T, runKey); if (again) return this.replay(again, hash); throw err(409, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed.'); }
    const plan = await this.planFor(ctx, ids);
    const outcomes: BulkInviteOutcome[] = [];
    for (const item of plan.items) {
      if (item.action === 'skip') { outcomes.push({ memberId: item.memberId, outcome: 'skipped', reason: item.reason, channel: null }); continue; }
      const t = plan.targets.get(item.memberId)!;
      try { outcomes.push(await this.inviteOne(ctx, t, item.channel!)); }
      catch (e) { logGap('team_bulk_invite_person_failed')(e); outcomes.push({ memberId: item.memberId, outcome: 'failed', reason: 'send_error', channel: item.channel }); }
    }
    const count = (o: BulkInviteOutcome['outcome']) => outcomes.filter((x) => x.outcome === o).length;
    await this.db.transaction().execute(async (trx) => {
      await sql`update staff_bulk_invite_runs set status = 'done', sent_count = ${count('sent')}, not_delivered_count = ${count('not_delivered')}, skipped_count = ${count('skipped')}, failed_count = ${count('failed')},
        outcomes = ${JSON.stringify(outcomes)}::jsonb where ${canMoveToSql(STAFF_BULK_INVITE_RUN, 'done')} and tenant_id = ${T} and id = ${claimed.id} and status = 'running'`.execute(trx);
      // the audit keeps counts and reasons, never contacts or tokens
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.bulk_invite.run', resourceType: 'staff_bulk_invite_run', resourceId: String(claimed.id),
        summary: `Bulk invite: ${count('sent')} sent, ${count('not_delivered')} not delivered, ${count('skipped')} skipped, ${count('failed')} failed`,
        metadata: { selected: ids.length, sent: count('sent'), notDelivered: count('not_delivered'), skipped: count('skipped'), failed: count('failed'), runKeyHash: createHash('sha256').update(runKey).digest('hex').slice(0, 16) }, requestId });
    });
    const row = await this.storedRun(T, runKey);
    return this.toView(row!, false);
  }

  /** one person through the existing invite sender: a pending invitation gets a fresh token (send count + 1), else a new one */
  private async inviteOne(ctx: TeamCtx, t: Target, channel: 'email' | 'sms'): Promise<BulkInviteOutcome> {
    const T = ctx.tenantId; const minted = mintInvitationToken(); const expiresAt = invitationExpiry(); const actor = UUID.test(String(ctx.userId)) ? ctx.userId : null;
    const invitationId = await this.db.transaction().execute(async (trx) => {
      const pending = (await sql<{ id: string }>`select id from user_invitations where tenant_id = ${T} and status = 'pending'
        and (user_id = ${t.userId} or (${t.email}::text is not null and lower(email) = ${t.email}::text) or (${t.phone}::text is not null and normalized_phone = ${t.phone}::text))
        order by (user_id = ${t.userId}) desc nulls last, created_at desc limit 1 for update`.execute(trx)).rows[0];
      if (pending) {
        await sql`update user_invitations set token_hash = ${minted.tokenHash}, token_prefix = ${minted.tokenPrefix}, expires_at = ${expiresAt}, delivery_channel = ${channel},
          send_count = send_count + 1, last_sent_at = now(), updated_at = now() where tenant_id = ${T} and id = ${pending.id} and status = 'pending'`.execute(trx);
        return String(pending.id);
      }
      return String((await sql<{ id: string }>`insert into user_invitations (tenant_id, branch_id, email, normalized_phone, role, invited_by_user_id, user_id, token_hash, token_prefix, delivery_channel, expires_at, last_sent_at)
        values (${T}, ${branchOf(ctx)}, ${t.email}, ${t.phone}, ${t.accountRole}, ${actor}, ${t.userId}, ${minted.tokenHash}, ${minted.tokenPrefix}, ${channel}, ${expiresAt}, now()) returning id`.execute(trx)).rows[0].id);
    });
    // delivered after commit (the per-person rule): a notifier that is down never undoes the invitation; the outcome says what happened
    const d = await this.deliverer.deliver({ invitationId, channel, to: (channel === 'email' ? t.email : t.phone) as string, token: minted.token, role: t.accountRole, tenantId: T, expiresAt: expiresAt.toISOString() });
    const delivered = d.deliveryStatus === 'delivered' || d.deliveryStatus === 'sent';
    return { memberId: t.memberId, outcome: delivered ? 'sent' : 'not_delivered', reason: delivered ? null : String(d.deliveryStatus || 'not_delivered'), channel };
  }

  private async storedRun(tenantId: string, runKey: string) {
    return (await sql<{ id: string; request_hash: string; status: string; selected_count: number; sent_count: number; not_delivered_count: number; skipped_count: number; failed_count: number; outcomes: BulkInviteOutcome[] | null; created_at: string | Date }>`
      select id, request_hash, status, selected_count, sent_count, not_delivered_count, skipped_count, failed_count, outcomes, created_at from staff_bulk_invite_runs where tenant_id = ${tenantId} and run_key = ${runKey}`.execute(this.db)).rows[0] ?? null;
  }
  private replay(row: NonNullable<Awaited<ReturnType<TeamBulkInviteRepository['storedRun']>>>, hash: string): BulkInviteRunView {
    if (row.request_hash !== hash) throw err(422, 'IDEMPOTENCY_KEY_REUSED', 'This run key was already used for other people.');
    if (row.status !== 'done') throw err(409, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed.');
    return this.toView(row, true);
  }
  private toView(row: NonNullable<Awaited<ReturnType<TeamBulkInviteRepository['storedRun']>>>, replayed: boolean): BulkInviteRunView {
    return { runId: String(row.id), replayed, selected: Number(row.selected_count), sent: Number(row.sent_count), notDelivered: Number(row.not_delivered_count), skipped: Number(row.skipped_count),
      failed: Number(row.failed_count), outcomes: Array.isArray(row.outcomes) ? row.outcomes : [], createdAt: row.created_at ? new Date(row.created_at).toISOString() : null };
  }
}
