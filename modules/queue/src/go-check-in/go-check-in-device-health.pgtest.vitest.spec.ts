// go-check-in-device-health.pgtest — round 10 (Tablets 02): a Go Check-In kiosk's heartbeat stores the OS / battery its browser
// reported (migration 931) on the REAL schema; a malformed or missing reading is never stored (never guessed) and a later beat
// without a battery reading keeps the last one with its own time.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyGoCheckInRepository } from './go-check-in.kysely.repository';
import { deviceHealthFacts } from './go-check-in.service';

const T = 'c9310000-0000-4000-8000-000000000001', B = 'c9310000-0000-4000-8000-000000000002';
let db: any; let repo: KyselyGoCheckInRepository; let dev = '';
const row = async () => (await sql<any>`select os_version, battery_percent, battery_charging, battery_reported_at, last_seen_at from go_checkin_devices where id = ${dev}`.execute(db)).rows[0];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  repo = new KyselyGoCheckInRepository(db);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'S', 'gci-931', 'GCI931', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  dev = (await sql<any>`insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, checkin_slug, status) values (${T}, ${B}, 'Lobby iPad', 'ipad', 'gci-931-k', 'active') returning id`.execute(db)).rows[0].id;
}, 180_000);

describe('Go Check-In heartbeat — device health facts', () => {
  it('parses only well-formed readings', () => {
    expect(deviceHealthFacts({ os: 'iPadOS 17.4', battery: { percent: 41.6, charging: true } })).toEqual({ os: 'iPadOS 17.4', battery: { percent: 42, charging: true } });
    expect(deviceHealthFacts({ os: 'x'.repeat(65), battery: { percent: -1 } })).toEqual({ os: null, battery: null });
    expect(deviceHealthFacts(undefined)).toEqual({ os: null, battery: null });
    expect(deviceHealthFacts({ battery: { percent: 100, charging: 'maybe' } })).toEqual({ os: null, battery: { percent: 100, charging: null } });
  });
  it('stores what was reported; a beat without a reading keeps the last one; nothing reported → null', async () => {
    await repo.touchDevice(dev);
    expect(await row()).toMatchObject({ os_version: null, battery_percent: null, battery_reported_at: null });
    await repo.touchDevice(dev, deviceHealthFacts({ os: 'iPadOS 17.4', battery: { percent: 14, charging: false } }));
    const r = await row();
    expect(r).toMatchObject({ os_version: 'iPadOS 17.4', battery_percent: 14, battery_charging: false }); expect(r.battery_reported_at).toBeTruthy();
    await repo.touchDevice(dev, deviceHealthFacts({}));
    expect((await row()).battery_percent).toBe(14);
    await expect(sql`update go_checkin_devices set battery_percent = 150 where id = ${dev}`.execute(db)).rejects.toThrow();
  });
});
