// super-admin-tenants.kysely.repository.ts — production Postgres implementation of SuperAdminTenantsRepo. Platform-wide
// (NOT row-scoped; authorization is the super-admin guard). Reads join tenants + owner user + latest subscription +
// latest AI package + payment config + hardware payoff + primary branch + usage limits (per the documented blueprint).
// Writes create a tenant with its owner user, trial subscription, and primary branch; set status; reset the owner
// password (Argon2 hash stored, temp returned once); manage support sessions; and append audit rows.
import { USER_ACCOUNT } from '@aipowersalon/identity';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { secureTempPassword } from '@aipowersalon/security';
import { sql, type Kysely } from 'kysely';
import { safeInet } from '@aipowersalon/database';   // INET column: a raw proxy-chain ip would throw and the row would be lost
import type { DB } from '@aipowersalon/database';
import type {
  SuperAdminTenantsRepo, CreatedTenantSeed, SuspendMeta, TenantWarningInput, TenantWarningRow,
} from './super-admin-tenants.repository';
import type { TenantRecord, StoredTenantStatus, AuditEntry } from './super-admin-tenants-core';
import type { TenantAuditRecord } from './super-admin-tenants.dto';
import type { DirectoryEnrichmentRaw } from './directory-enrichment';
import { hashPassword } from '@aipowersalon/auth';
import { writeSupportAccessNotice } from '../support-mode/support-access-notice';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { TENANT } from '../lifecycles';

function planPrices(): Record<string, number> {
  try { return process.env.PLAN_PRICES_JSON ? JSON.parse(process.env.PLAN_PRICES_JSON) : {}; } catch { return {}; }
}
function relLabel(d: Date | null): string {
  if (!d) return 'Never';
  const ms = Date.now() - d.getTime(); const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const dys = Math.floor(h / 24); return dys < 30 ? `${dys} day${dys === 1 ? '' : 's'} ago` : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}
function dateLabel(d: Date): string { return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }); }
function daysAgo(d: Date): number { return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)); }
function slugify(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'salon'; }
// H9: was 8 Math.random() characters.
function tempPassword(): string { return secureTempPassword(); }

type Row = {
  lifecycle_state?: string | null;   // Constitution 7 §16
  suspension_reason_code?: string | null;   // Constitution 7 §18
  id: string; display_name: string; tenant_code: string; status: string; created_at: Date;
  owner_name: string | null; owner_email: string | null; owner_phone: string | null; last_login_at: Date | null; owner_activated: boolean;
  plan: string | null; sub_status: string | null; sub_period_end: Date | string | null; ai_package: string | null;
  fiserv_configured: boolean | null; payment_config_status: string | null; remaining_cents: string | number | null; branch_count: string | number; pos_device_count: string | number | null;
  city: string | null; state: string | null;
  cust_used: string | number | null; cust_cap: string | number | null; tech_used: string | number | null; tech_cap: string | number | null;
  ai_calls: string | number | null; sms: string | number | null;
};

const LIST_SQL = `
  SELECT t.id, t.display_name, t.tenant_code, t.status, t.lifecycle_state, t.suspension_reason_code, t.created_at,
         o.full_name AS owner_name, o.email AS owner_email, o.normalized_phone AS owner_phone, o.last_login_at,
         (o.password_hash IS NOT NULL) AS owner_activated,
         s.plan, s.status AS sub_status, s.current_period_end AS sub_period_end, a.package AS ai_package,
         pc.fiserv_configured, pc.status AS payment_config_status, hp.remaining_cents,
         (SELECT count(*) FROM branches b WHERE b.tenant_id = t.id) AS branch_count,
         (SELECT count(*) FROM pos_payment_terminals p WHERE p.tenant_id = t.id::text AND p.status = 'active') AS pos_device_count,
         pb.city, pb.state,
         uc.used_value AS cust_used, uc.limit_value AS cust_cap,
         ut.used_value AS tech_used, ut.limit_value AS tech_cap,
         uai.used_value AS ai_calls, usm.used_value AS sms
  FROM tenants t
  LEFT JOIN users o ON o.id = t.owner_user_id
  LEFT JOIN LATERAL (SELECT plan, status, current_period_end FROM tenant_subscriptions WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1) s ON true
  LEFT JOIN LATERAL (SELECT package FROM tenant_ai_packages WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1) a ON true
  LEFT JOIN tenant_payment_config pc ON pc.tenant_id = t.id
  LEFT JOIN tenant_hardware_payoff hp ON hp.tenant_id = t.id
  LEFT JOIN LATERAL (SELECT city, state FROM branches WHERE tenant_id = t.id ORDER BY created_at ASC LIMIT 1) pb ON true
  LEFT JOIN tenant_usage_limits uc  ON uc.tenant_id  = t.id AND uc.metric  = 'customers'
  LEFT JOIN tenant_usage_limits ut  ON ut.tenant_id  = t.id AND ut.metric  = 'technicians'
  LEFT JOIN tenant_usage_limits uai ON uai.tenant_id = t.id AND uai.metric = 'ai_calls'
  LEFT JOIN tenant_usage_limits usm ON usm.tenant_id = t.id AND usm.metric = 'sms'
`;

export class KyselySuperAdminTenantsRepo implements SuperAdminTenantsRepo {
  constructor(private db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** Will the status change reach the tenant's screens through the projection? (outbox AND publisher on) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }

  private mapRow(r: Row): TenantRecord {
    const num = (v: any): number => (v == null ? 0 : Number(v));
    const created = new Date(r.created_at as any);
    const prices = planPrices();
    const plan = r.plan ?? 'Trial';
    const subStatus = (r.sub_status ?? 'none') as any;
    const custCap = num(r.cust_cap), custUsed = num(r.cust_used);
    const techCap = num(r.tech_cap), techUsed = num(r.tech_used);
    const utils = [custCap > 0 ? custUsed / custCap : 0, techCap > 0 ? techUsed / techCap : 0];
    const usagePercent = Math.min(100, Math.round(Math.max(0, ...utils) * 100));
    const remaining = r.remaining_cents == null ? -1 : Number(r.remaining_cents);
    return {
      id: r.id, displayName: r.display_name, tenantCode: r.tenant_code,
      ownerName: r.owner_name ?? '', ownerEmail: r.owner_email ?? '', ownerPhone: r.owner_phone ?? '',
      ownerActivated: !!r.owner_activated,
      primaryCity: r.city ?? '', primaryState: r.state ?? '',
      branchCount: num(r.branch_count),
      posDeviceCount: r.pos_device_count == null ? undefined : num(r.pos_device_count),
      storedStatus: (r.status as StoredTenantStatus),
      lifecycleState: r.lifecycle_state ?? undefined,
      suspensionReasonCode: r.suspension_reason_code ?? null,
      plan, subscriptionStatus: subStatus,
      subscriptionPeriodEnd: r.sub_period_end ? new Date(r.sub_period_end).toISOString() : undefined,
      aiPackage: r.ai_package ?? 'None',
      monthlyRevenueCents: subStatus === 'active' ? (prices[plan] ?? 0) : 0,
      usagePercent,
      fiservConfigured: !!r.fiserv_configured,
      paymentConfigStatus: ((r.payment_config_status as any) ?? 'none'),
      hardwarePayoffRemainingCents: remaining,
      lastLoginLabel: relLabel(r.last_login_at ? new Date(r.last_login_at as any) : null),
      createdLabel: dateLabel(created), createdDaysAgo: daysAgo(created),
      customers: [custUsed, custCap], technicians: [techUsed, techCap],
      aiCallsLabel: String(num(r.ai_calls)), smsLabel: String(num(r.sms)),
    };
  }

  async listTenantRecords(): Promise<TenantRecord[]> {
    const res = await sql<Row>`${sql.raw(LIST_SQL)} ORDER BY t.created_at DESC`.execute(this.db);
    return res.rows.map((r) => this.mapRow(r));
  }

  async getTenantRecord(id: string): Promise<TenantRecord | null> {
    const res = await sql<Row>`${sql.raw(LIST_SQL)} WHERE t.id = ${id} LIMIT 1`.execute(this.db);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async tenantCodeExists(code: string): Promise<boolean> {
    const r = await this.db.selectFrom('tenants').select('id').where('tenant_code', '=', code).executeTakeFirst();
    return !!r;
  }

  /**
   * Find the person who will own this salon, if they already exist.
   *
   * An owner is identified by the credentials they actually sign in with: their **email** or their **phone**. If
   * either matches an existing OWNER, that is the same person — and they must keep the same account, the same user
   * id and the same password across every salon they own.
   *
   * Deliberately scoped to `role = 'OWNER'`: matching a CUSTOMER or a TECHNICIAN who happens to share an email
   * would hand a salon to the wrong person, which is a far worse failure than creating one duplicate.
   */
  private async findOwnerUser(trx: any, email?: string | null, phone?: string | null): Promise<string | null> {
    const e = (email ?? '').trim().toLowerCase();
    const p = (phone ?? '').trim();
    if (!e && !p) return null;

    let q = trx.selectFrom('users').select('id').where('role', '=', 'OWNER');
    q = e && p
      ? q.where((eb: any) => eb.or([eb(eb.fn('lower', ['email']), '=', e), eb('normalized_phone', '=', p)]))
      : e
        ? q.where((eb: any) => eb(eb.fn('lower', ['email']), '=', e))
        : q.where('normalized_phone', '=', p);

    const row = await q.limit(1).executeTakeFirst();
    return row ? String((row as any).id) : null;
  }

  async createTenant(seed: CreatedTenantSeed): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const tenant = await trx.insertInto('tenants').values({
        legal_name: seed.legalName ?? seed.displayName, display_name: seed.displayName,
        tenant_slug: slugify(seed.tenantCode || seed.displayName), tenant_code: seed.tenantCode,
        status: 'pending', business_phone: seed.ownerPhone ?? null,
      } as any).returning('id').executeTakeFirstOrThrow();
      const tenantId = (tenant as any).id as string;

      // ── ONE canonical owner account, across every salon they own ──
      //
      // This used to ALWAYS insert a new `users` row. So adding an owner's second salon created a SECOND owner
      // account for the same person — a different user id, and a different password. They would sign in at one
      // salon, change their password, and find the other still wanted the old one. The spec forbids exactly this
      // ("do not create a duplicate owner for each salon"), and it is also just wrong.
      //
      // So: look for the person FIRST. An owner is identified by their email or their phone — the same identity
      // they already sign in with. Only create a user when this is genuinely someone new.
      const existingOwner = await this.findOwnerUser(trx, seed.ownerEmail, seed.ownerPhone ?? null);

      const ownerId = existingOwner ?? (await trx.insertInto('users').values({
        tenant_id: tenantId, full_name: seed.ownerName, email: seed.ownerEmail,
        normalized_phone: seed.ownerPhone ?? null, status: 'invited', role: 'OWNER',
      } as any).returning('id').executeTakeFirstOrThrow() as any).id as string;

      await trx.updateTable('tenants').set({ owner_user_id: ownerId } as any).where('id', '=', tenantId).execute();

      await trx.insertInto('tenant_subscriptions').values({ tenant_id: tenantId, plan: seed.plan, status: 'trialing' } as any).execute();
      if (seed.aiPackage && seed.aiPackage !== 'None') {
        await trx.insertInto('tenant_ai_packages').values({ tenant_id: tenantId, package: seed.aiPackage } as any).execute();
      }
      const branch = await trx.insertInto('branches').values({
        tenant_id: tenantId, name: seed.displayName, city: seed.primaryCity ?? null, state: seed.primaryState ?? null,
      } as any).returning('id').executeTakeFirstOrThrow();
      const branchId = (branch as any).id as string;

      // ── Put the new salon into the owner's PORTFOLIO ──
      //
      // `user_branch_access` is the canonical membership grant, and it is what the Owner App's salon switcher
      // reads. Without this row the salon exists, the owner "owns" it via tenants.owner_user_id — and it never
      // appears in their portfolio, so they cannot actually reach it. Creating a salon an owner cannot open is
      // not creating a salon.
      await trx.insertInto('user_branch_access').values({
        tenant_id: tenantId, branch_id: branchId, user_id: ownerId,
        access_level: 'owner', is_primary_owner: !existingOwner,   // the first salon makes them primary owner
        created_by_user_id: (seed as any).createdByUserId ?? null,
      } as any).execute();
      // Isolated payment setup for the new tenant — 'pending' until Super Admin provisions this tenant's own gateway
      // credentials. No tenant ever shares another tenant's gateway (Payment Gateway Isolation §4).
      await trx.insertInto('tenant_payment_config').values({
        tenant_id: tenantId, processor: 'fiserv', status: 'pending', environment: 'sandbox', fiserv_configured: false,
      } as any).execute();
      return tenantId;
    });
  }

  async getSuspensionReasonCode(id: string): Promise<string | null> {
    const r = await this.db.selectFrom('tenants').select(['suspension_reason_code'] as any).where('id', '=', id).executeTakeFirst();
    return (r as any)?.suspension_reason_code ?? null;
  }
  async compromisedIntegrationCount(id: string): Promise<number> {
    const r: any = await sql`select count(*)::int n from integration_connections where tenant_id = ${id} and connection_status = 'compromised'`.execute(this.db);
    return Number(r.rows[0]?.n ?? 0);
  }

  async closureFacts(id: string): Promise<{ closedAt: Date | null; activeLegalHolds: number }> {
    const t: any = (await sql`select closed_at from tenants where id = ${id}`.execute(this.db)).rows[0];
    const h: any = (await sql`select
        (select count(*)::int from customer_legal_holds where tenant_id = ${id} and status = 'active')
      + (select count(*)::int from audit_legal_holds where status = 'active' and (scope_type = 'global' or (scope_type = 'tenant' and scope_value = ${id}::text))) as n`.execute(this.db)).rows[0];
    return { closedAt: t?.closed_at ? new Date(t.closed_at) : null, activeLegalHolds: Number(h?.n ?? 0) };
  }

  async getLifecycle(id: string): Promise<string | null> {
    const r = await this.db.selectFrom('tenants').select(['lifecycle_state'] as any).where('id', '=', id).executeTakeFirst();
    return (r as any)?.lifecycle_state ?? null;
  }

  /** One transaction: move the lifecycle (the trigger sets status to match), keep the suspension code only while the
   *  state means suspended, and record the same platform events a status change records when the ACCESS status moves. */
  async setLifecycle(id: string, to: string, meta: { reasonCode?: string | null }): Promise<{ status: string }> {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('tenants').select(['status'] as any).where('id', '=', id).executeTakeFirst();
      const keepCode = to === 'SUSPENDED' || to === 'RESTRICTED';
      await trx.updateTable('tenants').set({ lifecycle_state: to, suspension_reason_code: keepCode ? (meta.reasonCode ?? null) : null, updated_at: new Date() } as any).where('id', '=', id).execute();
      const after = await trx.selectFrom('tenants').select(['status'] as any).where('id', '=', id).executeTakeFirst();
      const status = String((after as any)?.status);
      if (status !== String((before as any)?.status)) {
        const type = status === 'active' ? DOMAIN_EVENTS.TENANT_ACTIVATED : status === 'suspended' ? DOMAIN_EVENTS.TENANT_SUSPENDED : null;
        if (type && this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: type, aggregateType: 'tenant', aggregateId: id,
          actorType: 'user', payload: { tenantId: id, status, lifecycleState: to, ...(keepCode && meta.reasonCode ? { reasonCode: meta.reasonCode } : {}) } }));
      }
      return { status };
    });
  }

  async setStatus(id: string, status: StoredTenantStatus, meta?: SuspendMeta): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
    // §18: the suspension reason code lives on the row while suspended and is cleared by any other status
    // Phase 12 (#27): through TENANT (conditional) — a move another admin made meanwhile rolls this one (and its event) back
    const moved: any = await trx.updateTable('tenants').set({ status, suspension_reason_code: status === 'suspended' ? (meta?.reasonCode ?? null) : null, updated_at: new Date() } as any).where('id', '=', id).where(canMoveToSql(TENANT, status) as any).executeTakeFirst();
    if (!Number(moved?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(TENANT, null, status, 'concurrent');
      // platform.tenant_suspended / platform.tenant_activated — declared since Constitution 8, recorded by nothing until now.
      // Platform events carry no tenant (§168); the salon they concern is in the payload.
      const type = status === 'active' ? DOMAIN_EVENTS.TENANT_ACTIVATED : status === 'suspended' ? DOMAIN_EVENTS.TENANT_SUSPENDED : null;
      if (type && this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: type, aggregateType: 'tenant', aggregateId: id,
        actorType: 'user', payload: { tenantId: id, status, ...(status === 'suspended' && meta?.reasonCode ? { reasonCode: meta.reasonCode } : {}) } }));
    });
  }

  async resetOwnerPassword(id: string): Promise<{ temporaryPassword: string; ownerEmail: string } | null> {
    const t = await this.db.selectFrom('tenants').select('owner_user_id').where('id', '=', id).executeTakeFirst();
    const ownerId = (t as any)?.owner_user_id as string | null;
    if (!ownerId) return null;
    const owner = await this.db.selectFrom('users').select('email').where('id', '=', ownerId).executeTakeFirst();
    if (!owner) return null;
    const temporaryPassword = tempPassword();
    const hash = await hashPassword(temporaryPassword);
    await this.db.updateTable('users').set({ password_hash: hash, status: 'invited', updated_at: new Date() } as any).where('id', '=', ownerId).where(canMoveToSql(USER_ACCOUNT, 'invited') as any).execute();
    return { temporaryPassword, ownerEmail: (owner as any).email ?? '' };
  }



  async getAudit(id: string): Promise<TenantAuditRecord[]> {
    const rows = await sql<{ id: string; action_type: string; full_name: string | null; role: string | null; created_at: Date; ip_address: string | null }>`
      SELECT al.id, al.action_type, u.full_name, al.role, al.created_at, host(al.ip_address) AS ip_address
      FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
      WHERE al.entity_type = 'tenant' AND al.entity_id = ${id}
      ORDER BY al.created_at DESC LIMIT 200
    `.execute(this.db);
    return rows.rows.map((r) => ({
      id: r.id, actionType: r.action_type, actorName: r.full_name ?? 'Super Admin', actorRole: r.role ?? 'SUPER_ADMIN',
      createdAt: new Date(r.created_at as any).toISOString(), ip: r.ip_address ?? undefined,
      summary: (r.action_type || '').replace(/_/g, ' '),
    }));
  }

  async writeAudit(entry: AuditEntry & { actorUserId?: string; ip?: string }): Promise<void> {
    await sql`
      INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      VALUES (${entry.entityId}, ${entry.actorUserId ?? null}, 'SUPER_ADMIN', ${entry.actionType}, ${entry.entityType ?? 'tenant'}, ${entry.entityId}, ${safeInet(entry.ip)}, ${JSON.stringify((entry as any).metadata ?? {})}::jsonb)
    `.execute(this.db);
  }

  async createWarning(input: TenantWarningInput): Promise<{ id: string; deliveryStatus: string }> {
    // Notification dispatch is intentionally out of scope here: we persist the warning with an honest 'pending' status
    // when channels are requested (email/sms/dashboard) and let a downstream worker/notification service deliver it.
    const channels = [input.sendEmail ? 'email' : null, input.sendSms ? 'sms' : null, input.showInTenantDashboard ? 'dashboard' : null].filter(Boolean);
    const deliveryStatus = channels.length ? 'pending' : 'recorded';
    const row = await sql<{ id: string }>`
      INSERT INTO tenant_warnings (id, tenant_id, actor_user_id, warning_type, severity, subject, message, send_email, send_sms, show_in_tenant_dashboard, internal_note, delivery_status)
      VALUES (gen_random_uuid(), ${input.tenantId}, ${input.actorUserId ?? null}, ${input.warningType}, ${input.severity}, ${input.subject}, ${input.message}, ${input.sendEmail}, ${input.sendSms}, ${input.showInTenantDashboard}, ${input.internalNote ?? null}, ${deliveryStatus})
      RETURNING id
    `.execute(this.db);
    return { id: row.rows[0]?.id ?? '', deliveryStatus };
  }

  async listWarnings(tenantId: string, limit = 20): Promise<TenantWarningRow[]> {
    const rows: any[] = await sql`
      SELECT id, warning_type, severity, subject, message, send_email, send_sms, show_in_tenant_dashboard, delivery_status, created_at
      FROM tenant_warnings WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit}
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return rows.map((r) => ({
      id: String(r.id), warningType: String(r.warning_type ?? 'custom'), severity: String(r.severity ?? 'medium'),
      subject: String(r.subject ?? ''), message: String(r.message ?? ''),
      sendEmail: !!r.send_email, sendSms: !!r.send_sms, showInTenantDashboard: !!r.show_in_tenant_dashboard,
      deliveryStatus: String(r.delivery_status ?? 'pending'),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async createSupportSession(tenantId: string, opts: { reason: string; byUserId?: string; ip?: string; ttlMinutes: number }): Promise<{ token: string; expiresAt: string }> {
    // Constitution 7 §84: the session and the owner's notice are one transaction — no session without its notice
    const row = await this.db.transaction().execute(async (trx) => {
      // Constitution 7 — ONE Support Mode store: support_access_sessions (scope READ_ONLY), like every other entry.
      // (the older super_admin_support_sessions store was merged into it and dropped by migration 541)
      const r = await sql<{ id: string; expires_at: Date }>`
        INSERT INTO support_access_sessions (tenant_id, admin_user_id, reason, scope, started_at, expires_at)
        VALUES (${tenantId}, ${opts.byUserId ?? null}, ${opts.reason}, 'READ_ONLY', now(), now() + (${opts.ttlMinutes} * interval '1 minute'))
        RETURNING id, expires_at
      `.execute(trx);
      await writeSupportAccessNotice(trx, { tenantId, sessionId: String(r.rows[0]?.id), reason: opts.reason, scope: 'READ_ONLY', expiresAt: r.rows[0]?.expires_at as any });
      return r;
    });
    return { token: row.rows[0]?.id ?? '', expiresAt: row.rows[0]?.expires_at ? new Date(row.rows[0].expires_at as any).toISOString() : new Date(Date.now() + opts.ttlMinutes * 60000).toISOString() };
  }

  // Directory-overview enrichment (Phase 2b). Three independent read-only reads against confirmed columns; each
  // falls back to null on error so a missing source surfaces honestly as "NotConnected" rather than crashing the
  // page. Cross-tenant by design under the Super Admin guard. Not yet exercised on live multi-tenant Postgres —
  // covered by ops/smoke once run on a seeded stack.
  async directoryEnrichmentRaw(): Promise<DirectoryEnrichmentRaw> {
    const activePosDevices: number | null = await sql<{ n: string | number }>`
      SELECT count(*)::int AS n FROM pos_payment_terminals WHERE status = 'active'
    `.execute(this.db).then((r: any) => Number(r.rows[0]?.n ?? 0)).catch(() => null);

    const applications: Array<{ status: string }> | null = await sql<{ status: string }>`
      SELECT status FROM tenant_applications
    `.execute(this.db).then((r: any) => r.rows.map((x: any) => ({ status: String(x.status ?? '') }))).catch(() => null);

    const renewals: DirectoryEnrichmentRaw['renewals'] = await sql<{ tenant_id: string; display_name: string | null; plan: string | null; current_period_end: Date | null }>`
      SELECT s.tenant_id, t.display_name, s.plan, s.current_period_end
      FROM tenant_subscriptions s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.current_period_end IS NOT NULL
      ORDER BY s.current_period_end ASC LIMIT 200
    `.execute(this.db).then((r: any) => r.rows.map((x: any) => ({
      tenantId: String(x.tenant_id), tenantName: x.display_name ?? null, plan: x.plan ?? null,
      currentPeriodEnd: x.current_period_end ? new Date(x.current_period_end).toISOString() : null,
    }))).catch(() => null);

    return { activePosDevices, applications, renewals };
  }
}
