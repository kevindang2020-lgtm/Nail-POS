// Constitution 7 §34 / AI §113 on the real schema: the platform auto-action kill switch is READ from platform_settings
// (before, nothing supplied it, so it could never be turned on). Cached; a read failure keeps the last known value.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformAiKillSwitchReader } from '@aipowersalon/ai';

let db: any;
beforeAll(async () => { const pg = await migratedPglite(); db = kyselyFor(pg); });

describe('AI platform kill switch reader', () => {
  it('off when the setting is absent; on once it is true; cached for the TTL', async () => {
    let t = 0; const read = platformAiKillSwitchReader(db, 30_000, () => t);
    expect(await read()).toEqual({ autoActionsDisabled: false });
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values ('ai.auto_actions_disabled', 'kill_switches', 'true'::jsonb, 'boolean')`.execute(db);
    expect(await read()).toEqual({ autoActionsDisabled: false });          // still cached
    t = 31_000;
    expect(await read()).toEqual({ autoActionsDisabled: true });
  });
});

// ── §34: the kill switch centre ─────────────────────────────────────────────────────────────────────────────────────
import { KillSwitchService } from '@aipowersalon/super-admin';
import { platformAiKillSwitchReader as reader2 } from '@aipowersalon/ai';
describe('kill switch centre (§34)', () => {
  const U = '71717171-7171-4717-8717-717171717171';
  it('lists every switch from where it lives', async () => {
    const list = await new KillSwitchService(db).list();
    expect(list.map((k) => k.key)).toEqual(['ai.auto_actions', 'sms.emergency_send', 'booking.verification', 'deals.engine', 'payments.cardpointe', 'payments.clover', 'payments.tap_to_pay', 'payments.fiserv_tap_to_pay', 'staff.bulk_invites']);
  });
  it('flipping the AI switch needs a reason; it writes the setting, an immutable history row and an audit row; the AI engine then reads it', async () => {
    const svc = new KillSwitchService(db);
    await expect(svc.setAiAutoActions({ userId: U }, false, 'x')).rejects.toBeTruthy();
    const after = await svc.setAiAutoActions({ userId: U }, false, 'incident resolved, re-enabling');
    expect(after.find((k) => k.key === 'ai.auto_actions')).toMatchObject({ active: false, reason: null });
    const on = await svc.setAiAutoActions({ userId: U }, true, 'runaway auto-assignment incident');
    expect(on.find((k) => k.key === 'ai.auto_actions')).toMatchObject({ active: true, reason: 'runaway auto-assignment incident' });
    expect((await sql<any>`select count(*)::int n from platform_setting_changes where setting_key = 'ai.auto_actions_disabled'`.execute(db)).rows[0].n).toBe(2);
    expect((await sql<any>`select action_type from audit_logs where entity_type = 'kill_switch' order by created_at`.execute(db)).rows.map((r: any) => r.action_type)).toEqual(['kill_switch_released', 'kill_switch_activated']);
    expect(await reader2(db, 0)()).toEqual({ autoActionsDisabled: true });
  });
});

describe('Deals engine switch through the centre (real schema)', () => {
  it('stopping it writes platform_settings, and the deals repository reads it as disabled', async () => {
    const { KyselyDealsRepository } = await import('@aipowersalon/deals');
    const svc = new KillSwitchService(db);
    const list = await svc.setSettingSwitch('deals.engine', { userId: '72727272-7272-4727-8727-727272727272' }, true, 'deal pricing bug found');
    expect(list.find((k) => k.key === 'deals.engine')).toMatchObject({ active: true, reason: 'deal pricing bug found' });
    expect(await new (KyselyDealsRepository as any)(db).dealsEngineDisabled()).toBe(true);
    await expect(svc.setSettingSwitch('sms.emergency_send', { userId: null }, true, 'wrong place to toggle')).rejects.toBeTruthy();
  });
});

describe('round 11 — Team bulk invites platform pause through the centre (extras 200-Technician 08)', () => {
  it('not active by default; pausing needs a reason and writes the setting the bulk invite reads; releasing clears it', async () => {
    const svc = new KillSwitchService(db); const U = '73737373-7373-4737-8737-737373737373';
    expect((await svc.list()).find((k) => k.key === 'staff.bulk_invites')).toMatchObject({ active: false, reason: null });
    await expect(svc.setSettingSwitch('staff.bulk_invites', { userId: U }, true, 'short')).rejects.toBeTruthy();
    const on = await svc.setSettingSwitch('staff.bulk_invites', { userId: U }, true, 'invite messages complaint review');
    expect(on.find((k) => k.key === 'staff.bulk_invites')).toMatchObject({ active: true, reason: 'invite messages complaint review' });
    expect((await sql<any>`select value from platform_settings where setting_key = 'staff.bulk_invites_disabled'`.execute(db)).rows[0].value).toBe(true);
    const off = await svc.setSettingSwitch('staff.bulk_invites', { userId: U }, false, 'review finished, resuming');
    expect(off.find((k) => k.key === 'staff.bulk_invites')).toMatchObject({ active: false });
  });
});
