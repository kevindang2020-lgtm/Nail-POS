// mobile-pay-device-revocation.consumer.ts — Owner & Manager Payment App mandate §140: when a staff member's employment
// ends (access review revoke, Super Admin disable, any path that records an authorization change for a user who is no
// longer active), every payment phone bound to that user loses its payment authority — with the session revocation the
// identity module already does. ONE subscription point: `authorization.changed` (identity recordAuthorizationChange),
// re-reading the user's CURRENT status in the same transaction, so no termination path is forgotten.
// REPLAY_SAFE: revoking an already-revoked device is a no-op (the store's conditional update).
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import type { Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { KyselyMobilePayDeviceStore } from '@aipowersalon/checkout';

const INACTIVE = new Set(['inactive', 'suspended', 'terminated', 'disabled', 'deactivated']);

export class MobilePayDeviceRevocationConsumer implements EventConsumer {
  readonly name = 'mobile_payment.revoke_devices_on_deactivation';
  readonly eventTypes = [DOMAIN_EVENTS.AUTHORIZATION_CHANGED] as const;
  readonly critical = true;                 // security: a terminated manager must lose payment authority promptly
  readonly timeoutMs = 10_000;
  readonly replay = 'REPLAY_SAFE' as const;

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const tenantId = e.tenantId; const userId = String(e.payload?.userId ?? '');
    if (!tenantId || !userId || e.aggregateType !== 'user') return;
    const u = await trx.selectFrom('users').select(['tenant_id', 'status']).where('id', '=', userId as any).executeTakeFirst();
    if (!u) return;
    if (u.tenant_id && String(u.tenant_id) !== tenantId) throw new TenantMismatchError(`user ${userId} belongs to another tenant`);
    if (!INACTIVE.has(String(u.status ?? '').toLowerCase())) return;   // still employed: nothing to revoke
    await new KyselyMobilePayDeviceStore(trx as any).revokeForUser(tenantId, userId, `employment_ended:${String(e.payload?.change ?? 'authorization.changed')}`);
  }
}
