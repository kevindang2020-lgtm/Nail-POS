// platform-notice-admin.queries.ts — the Super Admin authoring reads and writes of Platform Announcements that span
// salons. CROSS-TENANT BY DESIGN: a platform notice is authored ONCE by the platform and targets many salons, so its
// target rows (platform_notice_targets) are read and replaced as a set, per notice. Every caller is a Super Admin path
// of PlatformNoticeService that has already passed `need(ctx, VIEW | MANAGE)` (super_admin.communications.*), and every
// route reaching it sits behind SuperAdminGuard. The POS side (what a salon sees, what it dismisses) is NOT here: it
// stays in platform-notice.service.ts, where every statement is scoped by the session's tenant_id and checked by
// check:tenant / check:tenant-builder.
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';

type Db = Kysely<DB>;
type Trx = Transaction<DB>;
export type AdminNoticeRow = Record<string, unknown>;

/** §60: the creator's name — a PLATFORM user (tenant_id IS NULL); a tenant user's name can never surface here. */
const CREATOR = sql`(SELECT coalesce(nullif(u.full_name, ''), nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email) FROM users u WHERE u.id = n.created_by AND u.tenant_id IS NULL) AS created_by_name`;

/** One page of notices with how many salons / branches each targets (the where clause is built by the service). */
export async function adminNoticePage(db: Db, where: RawBuilder<unknown>, limit: number, offset: number): Promise<AdminNoticeRow[]> {
  const r = await sql<AdminNoticeRow>`SELECT n.*, (SELECT count(*) FROM platform_notice_targets t WHERE t.notice_id = n.id)::int AS target_count, ${CREATOR}
    FROM platform_notices n ${where} ORDER BY n.updated_at DESC, n.id LIMIT ${limit} OFFSET ${offset}`.execute(db);
  return r.rows;
}

/** One notice with its target count, or null. */
export async function adminNotice(db: Db, id: string): Promise<AdminNoticeRow | null> {
  const r = await sql<AdminNoticeRow>`SELECT n.*, (SELECT count(*) FROM platform_notice_targets t WHERE t.notice_id = n.id)::int AS target_count, ${CREATOR} FROM platform_notices n WHERE n.id = ${id}`.execute(db);
  return r.rows[0] ?? null;
}

/** Replace a notice's whole audience (inside the authoring transaction that locked the notice row). */
export async function replaceNoticeTargets(trx: Trx, id: string, targets: Array<{ tenantId: string; branchId: string | null }>): Promise<void> {
  await trx.deleteFrom('platform_notice_targets').where('notice_id', '=', id).execute();
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    await trx.insertInto('platform_notice_targets').values(chunk.map((t) => ({ notice_id: id, tenant_id: t.tenantId, branch_id: t.branchId, target_type: t.branchId ? 'branch' : 'tenant' })) as never).execute();
  }
}
