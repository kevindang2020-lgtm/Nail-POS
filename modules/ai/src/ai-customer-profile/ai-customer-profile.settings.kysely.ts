// ai-customer-profile.settings.kysely.ts — DB-backed settings port. Tenant-scoped reads/writes over
// ai_customer_profile_settings (migration 320). The pure rows→layers mapping lives in the settings core (tested); this
// adapter only does the tenant-scoped I/O. When wired, it makes the §65 emergency controls operable and lets
// per-tenant/branch/user overrides persist.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiCustomerProfileContext } from './ai-customer-profile.dto';
import type { ProfileSettingsPort } from './ai-customer-profile.service';
import { rowsToLayers, type ProfileSettingsLayer, type SettingsRow } from './ai-customer-profile-settings';

export class KyselyProfileSettings implements ProfileSettingsPort {
  constructor(private readonly db: Kysely<DB>) {}

  async layers(ctx: AiCustomerProfileContext) {
    const rows = await this.db.selectFrom('ai_customer_profile_settings')
      .select(['level', 'branch_id', 'user_id', 'enabled', 'tunables'])
      .where('tenant_id', '=', ctx.tenantId)
      .where((eb: any) => eb.or([
        eb('level', '=', 'tenant'),
        eb.and([eb('level', '=', 'branch'), eb('branch_id', '=', ctx.branchId || '')]),
        eb.and([eb('level', '=', 'user'), eb('user_id', '=', ctx.userId || '')]),
      ]))
      .limit(50).execute().catch(() => [] as any[]);
    const mapped: SettingsRow[] = rows.map(r => ({
      level: r.level, branch_id: r.branch_id ?? null, user_id: r.user_id ?? null,
      enabled: r.enabled ?? null, tunables: r.tunables ?? null,
    }));
    return rowsToLayers(mapped, ctx);
  }

  async setLayer(ctx: AiCustomerProfileContext, level: 'tenant' | 'branch' | 'user', patch: ProfileSettingsLayer): Promise<void> {
    const branch_id = level === 'branch' ? (ctx.branchId || null) : null;
    const user_id = level === 'user' ? (ctx.userId || null) : null;
    // Delete-then-insert keeps the write independent of the COALESCE expression index (no onConflict target mismatch).
    let del = this.db.deleteFrom('ai_customer_profile_settings').where('tenant_id', '=', ctx.tenantId).where('level', '=', level);
    del = branch_id ? del.where('branch_id', '=', branch_id) : del.where('branch_id', 'is', null);
    del = user_id ? del.where('user_id', '=', user_id) : del.where('user_id', 'is', null);
    await del.execute();
    await this.db.insertInto('ai_customer_profile_settings').values({
      tenant_id: ctx.tenantId, level, branch_id, user_id,
      enabled: patch.enabled ?? null,
      tunables: (patch.tunables ?? null),
      updated_by_user_id: ctx.userId,
    }).execute();
  }
}
