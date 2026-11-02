// ai-queue-assignment-entitlement.ts — reuses the platform entitlement (tenant_ai_subscriptions) for the
// ai_queue_assignment package. Fail-closed: any error or missing/expired subscription → not entitled, so the AI
// layer stays dark while the underlying manual queue keeps working. Mirrors the voice module's entitlement port.
import { sql, type Kysely } from 'kysely';

export interface QueueAssignmentEntitlementPort {
  isEnabled(tenantId: string): Promise<boolean>;
}

// In-memory for unit tests / offline.
export class InMemoryQueueAssignmentEntitlement implements QueueAssignmentEntitlementPort {
  constructor(private readonly fn: (tenantId: string) => boolean = () => true) {}
  async isEnabled(tenantId: string): Promise<boolean> { return this.fn(tenantId); }
}

const PACKAGE = 'ai_queue_technician_assignment';

export class KyselyQueueAssignmentEntitlement implements QueueAssignmentEntitlementPort {
  constructor(private readonly db: Kysely<any>) {}
  async isEnabled(tenantId: string): Promise<boolean> {
    try {
      const r: any = await sql`
        select 1 from tenant_ai_subscriptions
        where tenant_id = ${tenantId} and package_code = ${PACKAGE}
          and status in ('active','trialing')
          and (trial_ends_at is null or trial_ends_at > now() or status = 'active')
        limit 1`.execute(this.db);
      return !!r.rows?.length;
    } catch {
      return false; // fail-closed
    }
  }
}
