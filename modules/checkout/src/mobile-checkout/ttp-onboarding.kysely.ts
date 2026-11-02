import { Kysely, sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { TTP_APPLE_ENTITLEMENT, TTP_COMMERCEHUB } from '../checkout/checkout-lifecycles';
import type { DB } from '@aipowersalon/database';
import { validateOnboardingInput, type TtpOnboardingInput, type TtpOnboardingRecord, type TtpOnboardingStore, type AppleEntitlementStatus, type CommerceHubStatus } from './ttp-onboarding';

/*
 * Postgres store for per-tenant Tap to Pay onboarding status (migration 384). Keyed by tenant_id (a PK upsert).
 * Raw sql keeps the new table out of the generated Kysely types — same approach as the auth OTP store. Stores
 * STATUS only; CommerceHub credentials live in config/secrets, never here.
 */
export class KyselyTtpOnboardingStore implements TtpOnboardingStore {
  constructor(private readonly db: Kysely<DB>) {}

  async get(tenantId: string): Promise<TtpOnboardingRecord | null> {
    const res: any = await sql`
      select apple_entitlement_status, commercehub_status, notes, updated_at
      from tenant_tap_to_pay_onboarding where tenant_id = ${tenantId} limit 1
    `.execute(this.db);
    const r = res?.rows?.[0];
    if (!r) return null;
    return {
      appleEntitlementStatus: r.apple_entitlement_status as AppleEntitlementStatus,
      commerceHubStatus: r.commercehub_status as CommerceHubStatus,
      notes: r.notes ?? null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    };
  }

  async set(tenantId: string, input: TtpOnboardingInput): Promise<TtpOnboardingRecord> {
    validateOnboardingInput(input);
    await sql`
      insert into tenant_tap_to_pay_onboarding (tenant_id, apple_entitlement_status, commercehub_status, notes, updated_by, updated_at, created_at)
      values (${tenantId}, ${input.appleEntitlementStatus}, ${input.commerceHubStatus}, ${input.notes ?? null}, ${input.updatedBy ?? null}, now(), now())
      on conflict (tenant_id) do update set
        apple_entitlement_status = excluded.apple_entitlement_status,
        commercehub_status = excluded.commercehub_status,
        notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now()
      where ${canMoveToSql(TTP_APPLE_ENTITLEMENT, input.appleEntitlementStatus, 'tenant_tap_to_pay_onboarding')} and ${canMoveToSql(TTP_COMMERCEHUB, input.commerceHubStatus, 'tenant_tap_to_pay_onboarding')}
    `.execute(this.db);
    return (await this.get(tenantId))!;
  }
}
