// booking-verification-settings.kysely.ts — the driver behind VerificationSettingsStore.
//
// All the SQL lives here and none of it lives in the service, which is the project's own port/driver convention.
// The decisions the service makes — may this be enabled, is the platform forcing it — are then testable without
// a database, which is exactly where the value is: they are the parts that break a tenant's bookings if wrong.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { VerificationSettingsStore } from './booking-verification-settings.service';

export class KyselyVerificationSettingsStore implements VerificationSettingsStore {
  constructor(private readonly db: AppDatabase | null) {}

  async settingsRow(tenantId: string, branchId: string | null): Promise<any | null> {
    if (!this.db) return null;
    const res: any = await sql`
      SELECT * FROM booking_verification_settings
      WHERE tenant_id = ${tenantId}
        AND ((${branchId}::uuid IS NULL AND branch_id IS NULL) OR branch_id = ${branchId}::uuid)
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows?.[0] ?? null;
  }

  async upsert(row: Record<string, any>): Promise<void> {
    if (!this.db) return;

    // ── Why this is TWO statements and not one ──────────────────────────────────────────────────────────
    // The uniqueness on this table is enforced by two PARTIAL indexes (migration 368):
    //
    //     uq_bvset_tenant_default ON (tenant_id)             WHERE branch_id IS NULL
    //     uq_bvset_tenant_branch  ON (tenant_id, branch_id)  WHERE branch_id IS NOT NULL
    //
    // Two, because NULL is not comparable in a UNIQUE constraint — without the second, a tenant could accumulate
    // several conflicting tenant-level rows and the resolver would pick one arbitrarily.
    //
    // But `ON CONFLICT (tenant_id, branch_id)` does NOT match a partial index. Postgres requires the index
    // PREDICATE in the conflict target, and refuses with "there is no unique or exclusion constraint matching the
    // ON CONFLICT specification" otherwise.
    //
    // My first version wrote exactly that, and it typechecked, and every unit test passed — because they all mock
    // the store. It would have thrown on the first real save. Only a real Postgres finds this, which is why it
    // now has one.
    const isDefault = row.branch_id == null;

    if (isDefault) {
      await sql`
        INSERT INTO booking_verification_settings
          (tenant_id, branch_id, enabled, channel_online, channel_customer_app, channel_ai_receptionist,
           channel_kiosk, channel_front_desk, channel_walk_in, verify_every_booking, reverify_after_seconds,
           reverify_on_group_booking, reverify_on_deposit, reverify_on_high_value, hold_seconds,
           version, updated_by_user_id, high_value_threshold_cents)
        VALUES
          (${row.tenant_id}, NULL, ${row.enabled}, ${row.channel_online}, ${row.channel_customer_app},
           ${row.channel_ai_receptionist}, ${row.channel_kiosk}, ${row.channel_front_desk}, ${row.channel_walk_in},
           ${row.verify_every_booking}, ${row.reverify_after_seconds}, ${row.reverify_on_group_booking},
           ${row.reverify_on_deposit}, ${row.reverify_on_high_value}, ${row.hold_seconds},
           ${row.version}, ${row.updated_by_user_id}, ${row.high_value_threshold_cents ?? null})
        ON CONFLICT (tenant_id) WHERE branch_id IS NULL DO UPDATE SET
          enabled = EXCLUDED.enabled,
          channel_online = EXCLUDED.channel_online,
          channel_customer_app = EXCLUDED.channel_customer_app,
          channel_ai_receptionist = EXCLUDED.channel_ai_receptionist,
          channel_kiosk = EXCLUDED.channel_kiosk,
          channel_front_desk = EXCLUDED.channel_front_desk,
          channel_walk_in = EXCLUDED.channel_walk_in,
          verify_every_booking = EXCLUDED.verify_every_booking,
          reverify_after_seconds = EXCLUDED.reverify_after_seconds,
          reverify_on_group_booking = EXCLUDED.reverify_on_group_booking,
          reverify_on_deposit = EXCLUDED.reverify_on_deposit,
          reverify_on_high_value = EXCLUDED.reverify_on_high_value,
          hold_seconds = EXCLUDED.hold_seconds,
          high_value_threshold_cents = EXCLUDED.high_value_threshold_cents,
          version = EXCLUDED.version,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()`.execute(this.db);
      return;
    }

    await sql`
      INSERT INTO booking_verification_settings
        (tenant_id, branch_id, enabled, channel_online, channel_customer_app, channel_ai_receptionist,
         channel_kiosk, channel_front_desk, channel_walk_in, verify_every_booking, reverify_after_seconds,
         reverify_on_group_booking, reverify_on_deposit, reverify_on_high_value, hold_seconds,
         version, updated_by_user_id, high_value_threshold_cents)
      VALUES
        (${row.tenant_id}, ${row.branch_id}, ${row.enabled}, ${row.channel_online}, ${row.channel_customer_app},
         ${row.channel_ai_receptionist}, ${row.channel_kiosk}, ${row.channel_front_desk}, ${row.channel_walk_in},
         ${row.verify_every_booking}, ${row.reverify_after_seconds}, ${row.reverify_on_group_booking},
         ${row.reverify_on_deposit}, ${row.reverify_on_high_value}, ${row.hold_seconds},
         ${row.version}, ${row.updated_by_user_id}, ${row.high_value_threshold_cents ?? null})
      ON CONFLICT (tenant_id, branch_id) WHERE branch_id IS NOT NULL DO UPDATE SET
        enabled = EXCLUDED.enabled,
        channel_online = EXCLUDED.channel_online,
        channel_customer_app = EXCLUDED.channel_customer_app,
        channel_ai_receptionist = EXCLUDED.channel_ai_receptionist,
        channel_kiosk = EXCLUDED.channel_kiosk,
        channel_front_desk = EXCLUDED.channel_front_desk,
        channel_walk_in = EXCLUDED.channel_walk_in,
        verify_every_booking = EXCLUDED.verify_every_booking,
        reverify_after_seconds = EXCLUDED.reverify_after_seconds,
        reverify_on_group_booking = EXCLUDED.reverify_on_group_booking,
        reverify_on_deposit = EXCLUDED.reverify_on_deposit,
        reverify_on_high_value = EXCLUDED.reverify_on_high_value,
        hold_seconds = EXCLUDED.hold_seconds,
        high_value_threshold_cents = EXCLUDED.high_value_threshold_cents,
        version = EXCLUDED.version,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()`.execute(this.db);
  }

  async providerValidated(tenantId: string, branchId: string): Promise<boolean> {
    if (!this.db) return false;
    // Branch row first, tenant default second -- the same order the credential resolver uses, so the toggle can
    // never say "validated" about a configuration the sender would not actually use.
    const res: any = await sql`
      SELECT last_validated_at FROM tenant_messaging_credentials
      WHERE tenant_id = ${tenantId} AND provider = 'twilio'
        AND (branch_id = ${branchId || null} OR branch_id IS NULL)
      ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return !!res.rows?.[0]?.last_validated_at;
  }

  async platformPolicy(tenantId: string) {
    const off = { requiredForTenant: false, blockedForTenant: false, emergencyDisabled: false };
    if (!this.db) return off;
    const res: any = await sql`
      SELECT tenant_id, emergency_disabled, required_for_tenant, blocked_for_tenant, module_enabled
      FROM booking_verification_platform_policy
      WHERE tenant_id = ${tenantId} OR tenant_id IS NULL`.execute(this.db).catch(() => ({ rows: [] }));
    const rows: any[] = res.rows ?? [];
    const global = rows.find((r) => r.tenant_id == null);
    const mine = rows.find((r) => r.tenant_id != null);
    return {
      requiredForTenant: !!mine?.required_for_tenant,
      blockedForTenant: !!mine?.blocked_for_tenant,
      // The GLOBAL emergency switch is Super Admin's. A per-tenant row can never turn it back on -- a kill switch
      // a tenant can override is not a kill switch.
      emergencyDisabled: !!global?.emergency_disabled,
      // Phase 4: the module switched off platform-wide (global row) or for this tenant — enabling it would do nothing.
      moduleEnabled: global?.module_enabled !== false && mine?.module_enabled !== false,
    };
  }
}
