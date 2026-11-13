// tenant-warning-dispatch.kysely.repository.ts — reads pending tenant_warnings with the tenant owner's contact
// (tenants.owner_user_id → users.email / normalized_phone) and flips delivery_status to a terminal value.
import { sql, type Kysely } from 'kysely';
import type { TenantWarningDispatchRepo, PendingWarning } from './tenant-warning-dispatch.job';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_WARNING_DELIVERY } from '../lifecycles';

export class KyselyTenantWarningDispatchRepo implements TenantWarningDispatchRepo {
  constructor(private readonly db: Kysely<any>) {}

  async listPending(limit: number): Promise<PendingWarning[]> {
    const rows: any[] = await sql`
      select w.id, w.tenant_id, w.subject, w.message, w.send_email, w.send_sms, w.severity,
             t.owner_user_id, o.email as owner_email, o.normalized_phone as owner_phone
      from tenant_warnings w
      join tenants t on t.id = w.tenant_id
      left join users o on o.id = t.owner_user_id
      where w.delivery_status = 'pending'
      order by w.created_at asc
      limit ${limit}
    `.execute(this.db).then((r: any) => r.rows).catch(() => []);
    return rows.map((r) => ({
      id: String(r.id), tenantId: String(r.tenant_id), subject: String(r.subject ?? ''), message: String(r.message ?? ''),
      sendEmail: !!r.send_email, sendSms: !!r.send_sms, ownerEmail: r.owner_email ?? null, ownerPhone: r.owner_phone ?? null,
      severity: r.severity ?? null, ownerUserId: r.owner_user_id ? String(r.owner_user_id) : null,
    }));
  }

  async markStatus(id: string, status: string): Promise<void> {
    await sql`update tenant_warnings set delivery_status = ${status} where id = ${id} and ${canMoveToSql(TENANT_WARNING_DELIVERY, status)}`.execute(this.db).catch(() => undefined);
  }
}
