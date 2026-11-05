// customer-phone-settings.kysely.ts — driver for PhoneSettingsStore, and the Super Admin oversight queries.
// CROSS-TENANT BY DESIGN: the oversight summary is a Super Admin platform aggregate.

import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { PhoneSettings } from './customer-phone-update.service';
import type { PhoneSettingsStore } from './customer-phone-settings.service';
import type { CustomerPhoneOversight, CustomerPhoneOversightTenantRow } from '@aipowersalon/api-contracts';

export class KyselyPhoneSettingsStore implements PhoneSettingsStore {
  constructor(private readonly db: AppDatabase | null) {}

  async get(tenantId: string, branchId: string | null): Promise<PhoneSettings | null> {
    if (!this.db) return null;
    // Branch row first, tenant default second -- a branch with its own policy uses it, one without inherits.
    const r: any = await sql`
      SELECT * FROM tenant_customer_phone_settings
      WHERE tenant_id = ${tenantId}
        AND (branch_id = ${branchId || null}::uuid OR branch_id IS NULL)   -- "" (no branch) must not error into "no settings"
      ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      allowReceptionistUpdates: !!row.allow_receptionist_updates,
      requireSmsVerification: !!row.require_sms_verification,
      allowPendingUnverified: !!row.allow_pending_unverified,
      allowSharedFamilyPhones: !!row.allow_shared_family_phones,
      customerAppSelfService: !!row.customer_app_self_service,
      notifyOldNumber: !!row.notify_old_number,
      allowManualConfirmation: !!row.allow_manual_confirmation,
      requireManagerApproval: !!row.require_manager_approval,
      requireReauthentication: row.require_reauthentication == null ? true : !!row.require_reauthentication,
    };
  }

  async getOwn(tenantId: string, branchId: string): Promise<PhoneSettings | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT 1 FROM tenant_customer_phone_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId}::uuid LIMIT 1`
      .execute(this.db as any).catch(() => ({ rows: [] }));
    return r.rows?.length ? this.get(tenantId, branchId) : null;
  }

  async branchBelongs(tenantId: string, branchId: string): Promise<boolean> {
    if (!this.db || !/^[0-9a-f-]{36}$/i.test(String(branchId))) return false;
    const r: any = await sql`SELECT 1 FROM branches WHERE id = ${branchId}::uuid AND tenant_id = ${tenantId} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (r.rows?.length ?? 0) > 0;
  }

  async deleteBranch(tenantId: string, branchId: string): Promise<boolean> {
    if (!this.db) return false;
    const r: any = await sql`DELETE FROM tenant_customer_phone_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId}::uuid RETURNING id`
      .execute(this.db as any).catch(() => ({ rows: [] }));
    return (r.rows?.length ?? 0) > 0;
  }

  async upsert(tenantId: string, branchId: string | null, s: PhoneSettings, actorUserId: string | null): Promise<void> {
    if (!this.db) return;
    // TWO statements, because uniqueness is enforced by two PARTIAL indexes (NULL is not comparable in a UNIQUE
    // constraint, so the tenant-level row needs its own). `ON CONFLICT` does NOT match a partial index unless the
    // conflict target carries the index PREDICATE -- Postgres refuses outright otherwise, and I shipped exactly
    // that bug earlier today.
    if (branchId == null) {
      await sql`
        INSERT INTO tenant_customer_phone_settings
          (tenant_id, branch_id, allow_receptionist_updates, require_sms_verification, allow_pending_unverified,
           allow_shared_family_phones, customer_app_self_service, notify_old_number, allow_manual_confirmation,
           require_manager_approval, require_reauthentication, version, updated_by_user_id)
        VALUES
          (${tenantId}, NULL, ${s.allowReceptionistUpdates}, ${s.requireSmsVerification}, ${s.allowPendingUnverified},
           ${s.allowSharedFamilyPhones}, ${s.customerAppSelfService}, ${s.notifyOldNumber}, ${s.allowManualConfirmation},
           ${s.requireManagerApproval}, ${s.requireReauthentication}, 1, ${actorUserId})
        ON CONFLICT (tenant_id) WHERE branch_id IS NULL DO UPDATE SET
          allow_receptionist_updates = EXCLUDED.allow_receptionist_updates,
          require_sms_verification = EXCLUDED.require_sms_verification,
          allow_pending_unverified = EXCLUDED.allow_pending_unverified,
          allow_shared_family_phones = EXCLUDED.allow_shared_family_phones,
          customer_app_self_service = EXCLUDED.customer_app_self_service,
          notify_old_number = EXCLUDED.notify_old_number,
          allow_manual_confirmation = EXCLUDED.allow_manual_confirmation,
          require_manager_approval = EXCLUDED.require_manager_approval,
          require_reauthentication = EXCLUDED.require_reauthentication,
          version = tenant_customer_phone_settings.version + 1,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()`.execute(this.db as any);
      return;
    }
    await sql`
      INSERT INTO tenant_customer_phone_settings
        (tenant_id, branch_id, allow_receptionist_updates, require_sms_verification, allow_pending_unverified,
         allow_shared_family_phones, customer_app_self_service, notify_old_number, allow_manual_confirmation,
         require_manager_approval, require_reauthentication, version, updated_by_user_id)
      VALUES
        (${tenantId}, ${branchId}, ${s.allowReceptionistUpdates}, ${s.requireSmsVerification}, ${s.allowPendingUnverified},
         ${s.allowSharedFamilyPhones}, ${s.customerAppSelfService}, ${s.notifyOldNumber}, ${s.allowManualConfirmation},
         ${s.requireManagerApproval}, ${s.requireReauthentication}, 1, ${actorUserId})
      ON CONFLICT (tenant_id, branch_id) WHERE branch_id IS NOT NULL DO UPDATE SET
        allow_receptionist_updates = EXCLUDED.allow_receptionist_updates,
        require_sms_verification = EXCLUDED.require_sms_verification,
        allow_pending_unverified = EXCLUDED.allow_pending_unverified,
        allow_shared_family_phones = EXCLUDED.allow_shared_family_phones,
        customer_app_self_service = EXCLUDED.customer_app_self_service,
        notify_old_number = EXCLUDED.notify_old_number,
        allow_manual_confirmation = EXCLUDED.allow_manual_confirmation,
        require_manager_approval = EXCLUDED.require_manager_approval,
        require_reauthentication = EXCLUDED.require_reauthentication,
        version = tenant_customer_phone_settings.version + 1,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()`.execute(this.db as any);
  }
}

// ── Super Admin oversight ────────────────────────────────────────────────────────────────────────────────
//
// Counts and states only. NEVER a phone number, a code, or a credential -- and not because the controller strips
// them, but because these queries never select them. A privacy guarantee that depends on remembering to strip a
// field is not a guarantee.
//
// Phase 3 (audit E13) corrected three numbers that were wrong: duplicate conflicts were counted from session STATES no
// change ever reaches (always 0); every number set without an SMS was counted as a manager's manual confirmation; and
// "tenants with updates enabled" ignored every salon that never saved settings (the default is ON).
export type PhoneOversight = CustomerPhoneOversight;   // the wire shape lives in @aipowersalon/api-contracts (one definition)

export class KyselyPhoneOversight {
  constructor(private readonly db: AppDatabase | null) {}

  async summary(sinceHours = 168, tenantId: string | null = null): Promise<PhoneOversight> {
    const empty: PhoneOversight = {
      sinceHours, tenantsWithUpdatesEnabled: 0, updatesRequested: 0, verified: 0, failed: 0, duplicateConflicts: 0,
      synchronizationFailures: 0, synchronizationDead: 0, manualConfirmations: 0, changesWithoutSms: 0,
      awaitingApproval: 0, openSessions: 0, expiredSessions: 0,
    };
    if (!this.db) return empty;
    const since = sql`now() - (${sinceHours} || ' hours')::interval`;
    const tenantFilter = tenantId ? sql`AND tenant_id = ${tenantId}::uuid` : sql``;

    const r: any = await sql`
      SELECT
        count(*)::int AS requested,
        count(*) FILTER (WHERE state IN ('phone_activated','customer_records_synchronized','synchronization_failed'))::int AS verified,
        count(*) FILTER (WHERE state IN ('verification_failed','verification_expired'))::int AS failed,
        count(*) FILTER (WHERE duplicate_outcome IS NOT NULL AND duplicate_outcome NOT IN ('no_conflict','same_customer'))::int AS dups,
        count(*) FILTER (WHERE state = 'synchronization_failed')::int AS sync_failed,
        count(*) FILTER (WHERE state = 'manager_review_required' AND completed_at IS NULL)::int AS awaiting,
        count(*) FILTER (WHERE completed_at IS NULL)::int AS open,
        count(*) FILTER (WHERE state = 'verification_expired' AND completed_at IS NOT NULL)::int AS expired
      FROM customer_phone_update_sessions
      WHERE created_at > ${since} ${tenantFilter}`
      .execute(this.db as any).catch(() => ({ rows: [] }));

    // Salons with receptionist updates ON: every active salon, minus those that turned them OFF (no row = default ON).
    const t: any = await sql`
      SELECT count(*)::int n FROM tenants tn
      WHERE upper(tn.lifecycle_state) = 'ACTIVE' ${tenantId ? sql`AND tn.id = ${tenantId}::uuid` : sql``}
        AND NOT EXISTS (SELECT 1 FROM tenant_customer_phone_settings s
                         WHERE s.tenant_id = tn.id AND s.branch_id IS NULL AND s.allow_receptionist_updates = false)`
      .execute(this.db as any).catch(() => ({ rows: [] }));

    // A number nobody proved by SMS: a MANAGER's manual confirmation (it completed a session) vs staff under the
    // salon's no-SMS policy (no session). Both are usable and labelled; the platform counts them rather than looking away.
    const m: any = await sql`
      SELECT
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM customer_phone_update_sessions s WHERE s.new_phone_id = p.id))::int AS manual,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM customer_phone_update_sessions s WHERE s.new_phone_id = p.id))::int AS no_sms
      FROM customer_phones p
      WHERE p.verification_provider = 'staff_override' AND p.created_at > ${since} ${tenantId ? sql`AND p.tenant_id = ${tenantId}::uuid` : sql``}`
      .execute(this.db as any).catch(() => ({ rows: [] }));

    const dead: any = await sql`
      SELECT count(*)::int n FROM jobs WHERE job_type = 'customer.phone.sync' AND status = 'dead' ${tenantFilter}`
      .execute(this.db as any).catch(() => ({ rows: [] }));

    const row = r.rows?.[0] ?? {};
    return {
      sinceHours,
      tenantsWithUpdatesEnabled: Number(t.rows?.[0]?.n ?? 0),
      updatesRequested: Number(row.requested ?? 0),
      verified: Number(row.verified ?? 0),
      failed: Number(row.failed ?? 0),
      duplicateConflicts: Number(row.dups ?? 0),
      synchronizationFailures: Number(row.sync_failed ?? 0),
      synchronizationDead: Number(dead.rows?.[0]?.n ?? 0),
      manualConfirmations: Number(m.rows?.[0]?.manual ?? 0),
      changesWithoutSms: Number(m.rows?.[0]?.no_sms ?? 0),
      awaitingApproval: Number(row.awaiting ?? 0),
      openSessions: Number(row.open ?? 0),
      expiredSessions: Number(row.expired ?? 0),
    };
  }

  /** Per-salon counts (Super Admin's table). Counts only — never a customer, a number or a code. */
  async byTenant(sinceHours = 168, limit = 50): Promise<CustomerPhoneOversightTenantRow[]> {
    if (!this.db) return [];
    const r: any = await sql`
      SELECT s.tenant_id, t.display_name,
        count(*)::int AS requested,
        count(*) FILTER (WHERE s.state IN ('phone_activated','customer_records_synchronized','synchronization_failed'))::int AS verified,
        count(*) FILTER (WHERE s.state IN ('verification_failed','verification_expired'))::int AS failed,
        count(*) FILTER (WHERE s.state = 'synchronization_failed')::int AS sync_failed,
        count(*) FILTER (WHERE s.state = 'manager_review_required' AND s.completed_at IS NULL)::int AS awaiting
      FROM customer_phone_update_sessions s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.created_at > now() - (${sinceHours} || ' hours')::interval
      GROUP BY s.tenant_id, t.display_name
      ORDER BY count(*) FILTER (WHERE s.state = 'synchronization_failed') DESC, count(*) DESC
      LIMIT ${Math.max(1, Math.min(200, limit))}`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (r.rows ?? []).map((x: any) => ({ tenantId: String(x.tenant_id), tenantName: String(x.display_name ?? ''), requested: x.requested, verified: x.verified, failed: x.failed, syncFailed: x.sync_failed, awaitingApproval: x.awaiting }));
  }
}
