// app-flags.util.ts — one shared reader for the §26 per-tenant kill switches (tenant_app_flags, migration 063).
// Pure function over a db handle (no DI), defaulting via APP_FLAG_DEFAULTS; any read error falls back to the default
// so a flags hiccup can never lock a tenant out of default-ON behavior.
import { APP_FLAG_DEFAULTS, AppFlagKey } from './salon-directory-core';

export async function readAppFlag(db: any, tenantId: string, key: AppFlagKey): Promise<boolean> {
  try {
    const row = await db.selectFrom('tenant_app_flags').where('tenant_id', '=', tenantId).where('flag_key', '=', key)
      .select(['enabled']).executeTakeFirst();
    return row ? !!row.enabled : APP_FLAG_DEFAULTS[key];
  } catch {
    return APP_FLAG_DEFAULTS[key];
  }
}
