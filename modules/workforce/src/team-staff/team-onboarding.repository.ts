// team-onboarding.repository.ts — TM-06 (Four-Module Completion Guide §10.1, 30 Oct 2026): Add Team Member for EVERY role.
// One server path for the salon's non-provider staff — receptionist, assistant, manager and the salon's configured custom
// roles — and an honest hand-over for service providers (nail technician, stylist) to the existing technician hire flow
// (POST /pos/technicians: its global-identity dedupe, membership, Clock PIN, commission and Tech App fields are
// technician-only and stay there).
//
// Rules (all server-side, decided by PERMISSIONS — never by the actor's role name):
//   • needs roles.manage (front desk cannot onboard staff — 403, audited)
//   • never OWNER or SUPER_ADMIN from here (ROLE_NOT_GRANTABLE)
//   • the actor's level comes from what they hold — ownership.transfer = owner level, roles.manage = manager level — and
//     the new role must be strictly BELOW it: a manager can add a receptionist / assistant, never another manager or an owner
//   • the grant ceiling: every permission the role carries must be one the actor holds (the staff-roles rule)
//   • branches: the session branch, or any of the salon's branches with branch_access.manage — never another salon's
//   • ONE canonical identity: an e-mail or phone already used by a login or a technician record of this salon is refused
//     (409 DUPLICATE_IDENTITY, with the existing member id) — no second user for the same person
//   • idempotent: the client's Idempotency key; a retry with the same body returns the SAME member (replayed), a
//     different body with the same key is refused (409 IDEMPOTENCY_KEY_REUSED)
//   • one transaction: users (status invited) + staff_role_assignments (template) + user_branch_access + team_staff_profiles
//     + user_invitations (token hash only) + the idempotency row + the audit row (fail-closed); the invitation is
//     delivered after commit through the platform's delivery seam (not_connected → the link to hand over, never "sent")
//   • a receptionist created here carries no technician record, no Clock PIN, no commission, no service mapping.
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { findRoleTemplate, templatePermissions, permissionsFor, type Role } from '@aipowersalon/permissions';
import { mintInvitationToken, invitationExpiry, InvitationDelivery, KyselyInvitationDeliverySink, acceptUrl } from '@aipowersalon/identity';
import { portalUrl } from '@aipowersalon/config';
import { UUID, err, canAny, phoneDigits, logGap, branchOf, type TeamCtx } from '../team-screens/screen-kit';
import { writeAuditRow } from '../team-screens/audit-rows';

/** what a job role IS here: its account base, its default template, and whether it is a service provider */
export const JOB_ROLES: Record<string, { base: string; template: string | null; provider: boolean; label: string }> = {
  receptionist: { base: 'RECEPTION', template: null, provider: false, label: 'Receptionist' },
  assistant: { base: 'FRONT_DESK', template: 'SUPPORT_STAFF', provider: false, label: 'Assistant' },
  manager: { base: 'MANAGER', template: 'BRANCH_MANAGER', provider: false, label: 'Manager' },
  nail_technician: { base: 'TECHNICIAN', template: null, provider: true, label: 'Nail Technician' },
  stylist: { base: 'TECHNICIAN', template: null, provider: true, label: 'Stylist' },
};
/** authority level of an account base (9 = never grantable here) */
const LEVEL: Record<string, number> = { SUPER_ADMIN: 9, OWNER: 9, MANAGER: 3, FRONT_DESK: 2, RECEPTION: 2, TECHNICIAN: 1 };
const PROVIDER_CREATE = ['pos.technicians.create'];
export interface DeliverPort { deliver(i: { invitationId: string; channel: 'email' | 'sms' | 'manual'; to: string; token: string; role: string; tenantId: string; expiresAt: string }): Promise<{ deliveryStatus: string; manualToken: string | null }> }
export interface OnboardBody { role?: unknown; fullName?: unknown; email?: unknown; phone?: unknown; branchIds?: unknown; idempotencyKey?: unknown; channel?: unknown }
interface Resolved { key: string; jobRole: string; label: string; base: string; template: string | null; provider: boolean; permissions: string[] }

const defaultDeliver = (db: Kysely<any>): DeliverPort => ({
  async deliver(i) {
    const r = await new InvitationDelivery(new KyselyInvitationDeliverySink(db)).deliver({ ...i, baseUrl: portalUrl() });
    return { deliveryStatus: r.deliveryStatus, manualToken: r.manualToken };
  },
});

export class TeamOnboardingRepository {
  private readonly deliverer: DeliverPort;
  constructor(private readonly db: Kysely<any>, deliverer?: DeliverPort) { this.deliverer = deliverer ?? defaultDeliver(db); }
  private level(ctx: TeamCtx) { return canAny(ctx, 'ownership.transfer') ? 4 : canAny(ctx, 'roles.manage') ? 3 : 0; }

  private async resolve(ctx: TeamCtx, key: string): Promise<Resolved | null> {
    const k = String(key ?? '').trim();
    const j = JOB_ROLES[k.toLowerCase()];
    if (j) {
      const t = j.template ? findRoleTemplate(j.template) : undefined;
      const permissions = t ? templatePermissions(t) : [...permissionsFor(j.base as Role)];
      return { key: k.toLowerCase(), jobRole: k.toLowerCase(), label: j.label, base: j.base, template: t ? t.key : null, provider: j.provider, permissions };
    }
    const m = /^custom:([0-9a-f-]{36})$/i.exec(k);
    if (!m) return null;
    const r = (await sql<any>`select cr.id, cr.name, cr.base_role, cr.permissions from tenant_custom_roles cr where cr.tenant_id = ${ctx.tenantId} and cr.id = ${m[1]} and cr.archived_at is null`.execute(this.db)).rows[0];
    if (!r) return null;
    const allowed = new Set<string>(permissionsFor(String(r.base_role) as Role));
    const raw: string[] = Array.isArray(r.permissions) ? r.permissions.map(String) : typeof r.permissions === 'string' ? JSON.parse(r.permissions) : [];
    return { key: 'custom:' + String(r.id), jobRole: 'custom', label: String(r.name), base: String(r.base_role), template: 'custom:' + String(r.id), provider: LEVEL[String(r.base_role)] === 1, permissions: raw.filter((p) => allowed.has(p)) };
  }
  /** why this actor may not create this role (null = allowed) */
  private refusal(ctx: TeamCtx, r: Resolved): { status: number; code: string; message: string } | null {
    if (r.provider) return canAny(ctx, ...PROVIDER_CREATE) ? null : { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to hire service providers.' };
    const lv = LEVEL[r.base] ?? 9;
    if (lv >= 9) return { status: 422, code: 'ROLE_NOT_GRANTABLE', message: 'Owner and platform roles are never granted from Add Team Member.' };
    if (lv >= this.level(ctx)) return { status: 403, code: 'ROLE_ABOVE_YOURS', message: 'You can only add staff in a role below your own. Ask the owner.' };
    const beyond = r.permissions.filter((p) => !canAny(ctx, p));
    if (beyond.length) return { status: 403, code: 'ROLE_PERMISSIONS_BEYOND_YOURS', message: `That role carries permissions you do not hold yourself (${beyond.slice(0, 5).join(', ')}${beyond.length > 5 ? ', …' : ''}).` };
    return null;
  }

  /** the roles this actor may onboard (and why not), plus the salon's branches they may grant */
  async options(ctx: TeamCtx) {
    const T = ctx.tenantId;
    const custom = (await sql<any>`select cr.id from tenant_custom_roles cr where cr.tenant_id = ${T} and cr.archived_at is null order by lower(cr.name), cr.id limit 50`.execute(this.db)).rows;
    const all: Resolved[] = [];
    for (const k of [...Object.keys(JOB_ROLES), ...custom.map((c: any) => 'custom:' + String(c.id))]) { const r = await this.resolve(ctx, k); if (r) all.push(r); }
    const anyBranch = canAny(ctx, 'branch_access.manage');
    const branches = (await sql<any>`select b.id, b.name from branches b where b.tenant_id = ${T} and coalesce(b.status, 'active') = 'active' and (${anyBranch} or b.id = ${branchOf(ctx)}::uuid) order by lower(b.name), b.id limit 100`.execute(this.db)).rows;
    return { canOnboard: this.level(ctx) >= 3 || canAny(ctx, ...PROVIDER_CREATE), sessionBranchId: branchOf(ctx), anyBranch,
      branches: branches.map((b: any) => ({ id: String(b.id), name: String(b.name ?? '') })),
      roles: all.map((r) => { const no = this.refusal(ctx, r); return { key: r.key, label: r.label, base: r.base, provider: r.provider, custom: r.jobRole === 'custom', allowed: !no, reason: no?.code ?? null,
        flow: r.provider ? 'technician' : 'staff' }; }) };
  }

  async create(ctx: TeamCtx, b: OnboardBody, requestId: string) {
    const T = ctx.tenantId;
    const deny = async (status: number, code: string, message: string, meta: Record<string, unknown> = {}) => {
      if (status === 403) await writeAuditRow(this.db, ctx, { module: 'workforce', action: 'team.staff.onboard.denied', resourceType: 'user', resourceId: null, status: 'denied', severity: 'warning',
        summary: `Denied: add team member (${code})`, metadata: { code, ...meta }, requestId }).catch(logGap('team_onboard_denial_not_recorded'));
      throw err(status, code, message);
    };
    if (this.level(ctx) < 3) await deny(403, 'FORBIDDEN', 'You do not have permission to add team members.', { role: String(b.role ?? '').slice(0, 80) });
    const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
    if (key.length < 8 || key.length > 100) throw err(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A request key (8–100 characters) is required.');
    const fullName = typeof b.fullName === 'string' ? b.fullName.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
    const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim().toLowerCase() : null;
    const ph = typeof b.phone === 'string' && b.phone.trim() ? phoneDigits(b.phone.trim()) : null;
    const branchIds = Array.from(new Set((Array.isArray(b.branchIds) ? b.branchIds : []).map((x) => String(x))));
    const hash = createHash('sha256').update(JSON.stringify({ role: String(b.role ?? '').trim().toLowerCase(), fullName, email, phone: ph?.d ?? null, branchIds: [...branchIds].sort() })).digest('hex');

    // idempotent replay first: the same key + the same body → the same member, whatever happened since
    const prior = (await sql<any>`select r.request_hash, r.result_json from team_onboarding_requests r where r.tenant_id = ${T} and r.idempotency_key = ${key}`.execute(this.db)).rows[0];
    if (prior) {
      if (String(prior.request_hash) !== hash) throw err(409, 'IDEMPOTENCY_KEY_REUSED', 'That request key was already used for a different team member.');
      return { ...(prior.result_json ?? {}), replayed: true };
    }

    const r = await this.resolve(ctx, String(b.role ?? ''));
    if (!r) throw err(422, 'ROLE_UNKNOWN', 'Choose one of the salon\'s roles.');
    if (r.provider) throw err(422, 'USE_TECHNICIAN_FLOW', 'Service providers are added with the technician form (services, commission and Clock PIN live there).', { flow: 'technician' });
    const no = this.refusal(ctx, r); if (no) { if (no.status === 403) await deny(403, no.code, no.message, { role: r.key }); throw err(no.status, no.code, no.message); }
    if (fullName.length < 2) throw err(422, 'NAME_REQUIRED', 'Enter the team member\'s name.');
    if (!email && !ph) throw err(422, 'EMAIL_OR_PHONE_REQUIRED', 'Enter an e-mail address or a mobile number to send the invitation to.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(422, 'EMAIL_INVALID', 'That e-mail address is not valid.');
    if (ph && ph.d.length !== 10) throw err(422, 'PHONE_INVALID', 'That phone number is not valid. Use 10 digits, for example (856) 555-1234.');
    const phone = ph ? '+1' + ph.d : null;

    // branches: the session branch by default; others only with branch_access.manage; always this salon's
    const own = branchOf(ctx); const ids = branchIds.length ? branchIds : own ? [own] : [];
    if (ids.some((x) => !UUID.test(x))) throw err(422, 'BRANCH_INVALID', 'Choose the salon\'s branches.');
    if (!canAny(ctx, 'branch_access.manage') && ids.some((x) => x !== own)) await deny(403, 'BRANCH_NOT_YOURS', 'You can only add staff to your own branch.', { role: r.key });
    if (ids.length) {
      const ok = (await sql<any>`select count(*)::int as n from branches b where b.tenant_id = ${T} and b.id in (${sql.join(ids)})`.execute(this.db)).rows[0];
      if (Number(ok?.n) !== ids.length) throw err(404, 'BRANCH_NOT_FOUND', 'One of those branches is not part of this salon.');
    }

    // one canonical identity per salon: login or technician record with the same e-mail / phone
    const dup = (await sql<any>`select 'user' as kind, u.id, u.status from users u where u.tenant_id = ${T} and coalesce(u.status, 'active') <> 'deleted'
        and ((${email}::text is not null and lower(u.email) = ${email}) or (${ph?.d ?? null}::text is not null and right(regexp_replace(coalesce(u.normalized_phone, ''), '[^0-9]', '', 'g'), 10) = ${ph?.d ?? null}))
      union all select 'technician', t.id, t.status from technicians t where t.tenant_id = ${T} and t.archived_at is null
        and ((${email}::text is not null and lower(t.email) = ${email}) or (${ph?.d ?? null}::text is not null and right(regexp_replace(coalesce(t.normalized_phone, t.phone_display, ''), '[^0-9]', '', 'g'), 10) = ${ph?.d ?? null}))
      order by 1 desc limit 1`.execute(this.db)).rows[0];
    if (dup) throw err(409, 'DUPLICATE_IDENTITY', 'Someone in this salon already uses that e-mail or phone number. Open their profile instead of creating a second one.', { existingMemberId: String(dup.id), existingKind: String(dup.kind) });

    const channel: 'email' | 'sms' = b.channel === 'sms' && phone ? 'sms' : email ? 'email' : 'sms';
    const minted = mintInvitationToken(); const expiresAt = invitationExpiry();
    const actor = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
    const out = await this.db.transaction().execute(async (trx) => {
      const claim = (await sql<any>`insert into team_onboarding_requests (tenant_id, idempotency_key, request_hash, actor_user_id, job_role) values (${T}, ${key}, ${hash}, ${actor}, ${r.key})
        on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(trx)).rows[0];
      if (!claim) return null;   // a concurrent twin won the key — answered below from its stored result
      const u = (await sql<any>`insert into users (id, tenant_id, branch_id, full_name, email, normalized_phone, role, status)
        values (gen_random_uuid(), ${T}, ${ids[0] ?? null}, ${fullName}, ${email}, ${phone}, ${r.base}, 'invited') returning id`.execute(trx)).rows[0];
      const userId = String(u.id);
      if (r.template) await sql`insert into staff_role_assignments (tenant_id, user_id, template_key, assigned_by) values (${T}, ${userId}, ${r.template}, ${actor})`.execute(trx);
      for (const br of ids) await sql`insert into user_branch_access (tenant_id, branch_id, user_id, role, access_level, created_by_user_id) values (${T}, ${br}, ${userId}, ${r.base}, ${LEVEL[r.base] === 3 ? 'manager' : 'staff'}, ${actor})
        on conflict (tenant_id, user_id, branch_id) do nothing`.execute(trx);
      await sql`insert into team_staff_profiles (tenant_id, user_id, job_role, job_role_label, onboarded_by) values (${T}, ${userId}, ${r.jobRole}, ${r.label.slice(0, 80)}, ${actor})`.execute(trx);
      const inv = (await sql<any>`insert into user_invitations (tenant_id, branch_id, email, normalized_phone, role, invited_by_user_id, user_id, token_hash, token_prefix, delivery_channel, expires_at)
        values (${T}, ${ids[0] ?? null}, ${email}, ${phone}, ${r.base}, ${actor}, ${userId}, ${minted.tokenHash}, ${minted.tokenPrefix}, ${channel}, ${expiresAt}) returning id`.execute(trx)).rows[0];
      const result = { memberId: userId, userId, role: r.key, roleLabel: r.label, accountRole: r.base, template: r.template, status: 'invited', branchIds: ids, invitationId: String(inv.id), technicianRecord: false };
      await sql`update team_onboarding_requests t set user_id = ${userId}, result_json = ${JSON.stringify(result)}::jsonb where t.tenant_id = ${T} and t.id = ${claim.id}`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'team.staff.onboarded', resourceType: 'user', resourceId: userId, summary: `Team member added as ${r.label} (invited)`,
        after: { role: r.key, accountRole: r.base, template: r.template, branchIds: ids, status: 'invited' }, metadata: { idempotencyKeyHash: hash.slice(0, 16), channel, hasEmail: !!email, hasPhone: !!phone }, requestId });
      return { result, invitationId: String(inv.id) };
    });
    if (!out) {
      const again = (await sql<any>`select r.request_hash, r.result_json from team_onboarding_requests r where r.tenant_id = ${T} and r.idempotency_key = ${key}`.execute(this.db)).rows[0];
      if (!again || String(again.request_hash) !== hash) throw err(409, 'IDEMPOTENCY_KEY_REUSED', 'That request key was already used for a different team member.');
      return { ...(again.result_json ?? {}), replayed: true };
    }
    // delivered after commit: a notifier that is down never rolls back the hire; the result says what really happened
    let delivery: { deliveryStatus: string; manualToken: string | null } = { deliveryStatus: 'failed', manualToken: null };
    try {
      delivery = await this.deliverer.deliver({ invitationId: out.invitationId, channel, to: (channel === 'sms' ? phone : email ?? phone) as string, token: minted.token, role: r.base, tenantId: T, expiresAt: expiresAt.toISOString() });
    } catch (e) { logGap('team_onboard_invite_delivery_failed')(e); }
    return { ...out.result, replayed: false, invite: { channel, deliveryStatus: delivery.deliveryStatus, acceptUrl: delivery.manualToken ? acceptUrl(portalUrl(), delivery.manualToken) : null } };
  }
}
