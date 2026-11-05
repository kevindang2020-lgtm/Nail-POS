// ai-money-protection-entitlement.ts — Plans/Feature-Limits gate (spec §76/§83/§85). A tenant may use the module
// only if subscribed to the `ai_fraud_money_protection` AI package. Reuses the existing tenant_ai_subscriptions
// table — no parallel entitlement system.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export const MONEY_PROTECTION_PACKAGE = 'ai_fraud_money_protection';
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'trial', 'past_due']); // past_due still has access pending billing

export interface EntitlementPort {
  hasMoneyProtection(tenantId: string): Promise<boolean>;
}

// In-memory: entitled unless a deny-set says otherwise (default-allow keeps existing tests simple).
export class InMemoryEntitlement implements EntitlementPort {
  constructor(private readonly entitled: (tenantId: string) => boolean = () => true) {}
  async hasMoneyProtection(tenantId: string) { return this.entitled(tenantId); }
}

export class KyselyEntitlement implements EntitlementPort {
  constructor(private readonly db: Kysely<DB>) {}
  async hasMoneyProtection(tenantId: string): Promise<boolean> {
    try {
      const r: any = await sql`
        select status from tenant_ai_subscriptions
        where tenant_id = ${tenantId} and package_code = ${MONEY_PROTECTION_PACKAGE} limit 1`.execute(this.db);
      const status = String(r.rows?.[0]?.status ?? '').toLowerCase();
      return ENTITLED_STATUSES.has(status);
    } catch {
      return false; // fail closed on entitlement errors (never expose a paid feature by accident)
    }
  }
}
