// settings.devices.kysely.repository.ts — the salon's customer displays, read for Go-Live readiness (is one paired?).
// Pairing and every device action live in POS → Devices → Customer Displays (apps/api display-devices.*, 23-inch spec
// §8–§12, §86). Tenant-scoped (and branch-scoped when a branch is in context); revoked displays are history.
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SettingsContext } from './settings.dto';
import type { DisplayDevice, DevicePairingRepositoryPort } from './settings.integrations';

const iso = (v: unknown): string | undefined => (v ? new Date(v as any).toISOString() : undefined);
const toDevice = (r: any): DisplayDevice => ({
  id: r.id, name: r.device_name || 'iPad', stationId: r.pos_station_id || undefined,
  status: r.pairing_status === 'paired' ? 'paired' : 'unpaired', lastSeenAt: iso(r.last_seen_at),
});

export class KyselyDevicePairingRepository implements DevicePairingRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async list(ctx: SettingsContext): Promise<DisplayDevice[]> {
    let q = this.db.selectFrom('customer_display_devices').where('tenant_id', '=', ctx.tenantId)
      .where('revoked_at', 'is', null).where('pairing_status', '!=', 'pending');
    if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    // the columns a list shows — never the credential or pairing-code hashes
    const rows = await q.select(['id', 'device_name', 'pos_station_id', 'pairing_status', 'last_seen_at']).orderBy('created_at', 'asc').execute().catch(() => [] as any[]);
    return (rows as any[]).map(toDevice);
  }
}
