// ai-queue-assignment-settings.pgtest — BUILD_PLAN Phase 6: the ONE settings source, against the real migrated schema.
// Layering (salon defaults under branch rows, null = inherit), versions (stale save refused), the version log + audit +
// outbox event in the same transaction, the salon kill switch and the platform switch.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyQueueAssignmentSettings, QueueSettingsConflictError, QueueSettingsValidationError, InMemoryQueueAssignmentSettings, SETTINGS_DEFAULTS } from './ai-queue-assignment-settings';

const T = 'a6a6a6a6-0000-4000-8000-000000000001';
const B1 = 'a6a6a6a6-0000-4000-8000-000000000002';
const B2 = 'a6a6a6a6-0000-4000-8000-000000000003';
const B3 = 'a6a6a6a6-0000-4000-8000-000000000004';
const U = 'a6a6a6a6-0000-4000-8000-0000000000aa';
const TECH1 = 'a6a6a6a6-0000-4000-8000-0000000000c1';
const TECH2 = 'a6a6a6a6-0000-4000-8000-0000000000c2';
const actor = { userId: U, role: 'OWNER' };
let pg: any; let s: KyselyQueueAssignmentSettings;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Settings Salon LLC', 'Settings Salon', 'settings-salon-p6', 'SETP6', 'active') ON CONFLICT DO NOTHING;`);
  for (const b of [B1, B2, B3]) await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${b}', '${T}', 'Branch ${b.slice(-1)}', 'active') ON CONFLICT DO NOTHING;`);
  s = new KyselyQueueAssignmentSettings(kyselyFor(pg) as never, new OutboxWriter());
});

describe('defaults (no rows)', () => {
  it('a salon with no settings gets the defaults, version 0, auto OFF', async () => {
    const e = await s.effective({ tenantId: T, branchId: B1 });
    expect(e.waitSevereMin).toBe(SETTINGS_DEFAULTS.waitSevereMin);
    expect(e.configVersion).toBe('0.0');
    expect(e.autoEnabled).toBe(false);
    expect(e.autoAllowed).toBe(false);
    expect(e.autoBlockedBy).toBe('disabled');
  });
});

describe('layering — salon defaults under branch overrides', () => {
  it('a salon change reaches every branch that has no own value', async () => {
    await s.update({ tenantId: T, branchId: null }, { waitSevereMin: 35, waitCriticalMin: 50, stuckMinutes: 40, autoEnabled: true }, actor, { reason: 'busier season' });
    const e = await s.effective({ tenantId: T, branchId: B1 });
    expect(e.waitSevereMin).toBe(35);
    expect(e.stuckMinutes).toBe(40);
    expect(e.autoEnabled).toBe(true);
    expect(e.autoAllowed).toBe(true);
    expect(e.configVersion).toBe('1.0');
  });

  it('a branch saving ONE value does not freeze every other value at the old defaults (layering bug)', async () => {
    // before the fix the branch row was inserted with wait 10/20/30/45 and auto_enabled=false — all NOT NULL columns —
    // so saving stuckMinutes on a branch silently cut it off from the salon's thresholds and turned auto OFF there.
    await s.update({ tenantId: T, branchId: B2 }, { stuckMinutes: 25 }, actor, {});
    const e = await s.effective({ tenantId: T, branchId: B2 });
    expect(e.stuckMinutes).toBe(25);           // its own value
    expect(e.waitSevereMin).toBe(35);          // still the salon's
    expect(e.waitCriticalMin).toBe(50);
    expect(e.autoEnabled).toBe(true);          // still the salon's
    expect(e.configVersion).toBe('1.1');
    const own = await s.branchOverrides({ tenantId: T, branchId: B2 });
    expect(own.stuckMinutes).toBe(25);
    expect(own.waitSevereMin).toBeUndefined();
    expect(own.autoEnabled).toBeUndefined();
  });

  it('a branch value wins over the salon value, and clearing it inherits again (wait thresholds included)', async () => {
    await s.update({ tenantId: T, branchId: B2 }, { waitApproachingMin: 5, waitExceededMin: 15, waitSevereMin: 25, waitCriticalMin: 40, autoEnabled: false }, actor, {});
    let e = await s.effective({ tenantId: T, branchId: B2 });
    expect(e.waitSevereMin).toBe(25);
    expect(e.autoEnabled).toBe(false);
    expect(e.autoBlockedBy).toBe('disabled');
    await s.clearBranchOverrides({ tenantId: T, branchId: B2 }, ['waitApproachingMin', 'waitExceededMin', 'waitSevereMin', 'waitCriticalMin', 'autoEnabled'], actor);
    e = await s.effective({ tenantId: T, branchId: B2 });
    expect(e.waitSevereMin).toBe(35);
    expect(e.autoEnabled).toBe(true);
    expect(e.stuckMinutes).toBe(25);           // not cleared
  });

  it('a legacy (pre-Phase 6) branch row keeps its explicit values and inherits the old defaults', async () => {
    // migration 527: values equal to the old column defaults become "inherit"; a value someone actually chose stands
    await pg.exec(`INSERT INTO queue_assignment_settings (tenant_id, branch_id, wait_severe_min, auto_enabled) VALUES ('${T}', '${B3}', 28, false)`);
    const e = await s.effective({ tenantId: T, branchId: B3 });
    expect(e.waitSevereMin).toBe(28);
    expect(e.waitCriticalMin).toBe(50);        // inserted with no value → inherits (the column has no default any more)
  });

  it('a branch fixed order alone inherits the salon rotation policy (it used to force "hybrid")', async () => {
    await s.update({ tenantId: T, branchId: null }, { rotationPolicy: 'fixed_order' }, actor, {});
    await s.update({ tenantId: T, branchId: B1 }, { fixedOrder: [TECH2, TECH1] }, actor, {});
    const e = await s.effective({ tenantId: T, branchId: B1 });
    expect(e.rotationPolicy).toBe('manual_order');   // RE-PINNED Oct 13 2026 (T1): fixed_order IS the manual_order fairness mode
    expect(e.fixedOrder).toEqual([TECH2, TECH1]);
  });

  it('a fixed order is per location — the salon scope refuses it', async () => {
    await expect(s.update({ tenantId: T, branchId: null }, { fixedOrder: [TECH1] }, actor, {})).rejects.toBeInstanceOf(QueueSettingsValidationError);
  });

  it('bad values are refused in plain words', async () => {
    await expect(s.update({ tenantId: T, branchId: B1 }, { waitSevereMin: 10, waitCriticalMin: 5 }, actor, {})).rejects.toThrow(/rise/);
    await expect(s.update({ tenantId: T, branchId: B1 }, { autoConfidenceFloor: 2 }, actor, {})).rejects.toBeInstanceOf(QueueSettingsValidationError);
    await expect(s.update({ tenantId: T, branchId: B1 }, { rotationPolicy: 'random' as never }, actor, {})).rejects.toBeInstanceOf(QueueSettingsValidationError);
  });

  it('wait thresholds are checked against the EFFECTIVE values, not the defaults', async () => {
    // salon severe=35; a branch setting only critical=33 would make critical < severe
    await expect(s.update({ tenantId: T, branchId: B1 }, { waitCriticalMin: 33 }, actor, {})).rejects.toThrow(/rise/);
  });
});

describe('versions', () => {
  it('a background job (no user: \'\') can save — recorded with a null actor, never a raw DB error', async () => {
    await s.update({ tenantId: T, branchId: B3 }, { lateGraceMin: 9 }, { userId: '', role: 'SYSTEM' }, { change: 'system' });
    const v = (await s.versions({ tenantId: T, branchId: B3 })).find((x) => x.change === 'system');
    expect(v?.changedBy).toBeNull();
  });

  it('a stale save is refused with the current version; a fresh one goes through', async () => {
    const cur = await s.tenantSettings(T);
    await expect(s.update({ tenantId: T, branchId: null }, { lateGraceMin: 12 }, actor, { expectedVersion: cur.version - 1 })).rejects.toBeInstanceOf(QueueSettingsConflictError);
    const e = await s.update({ tenantId: T, branchId: null }, { lateGraceMin: 12 }, actor, { expectedVersion: cur.version });
    expect(e.tenantVersion).toBe(cur.version + 1);
    const b = await s.branchOverrides({ tenantId: T, branchId: B2 });
    await expect(s.update({ tenantId: T, branchId: B2 }, { lateGraceMin: 3 }, actor, { expectedVersion: b.version + 5 })).rejects.toBeInstanceOf(QueueSettingsConflictError);
  });

  it('every change is logged with its reason, audited and announced in the same transaction', async () => {
    const v = await s.versions({ tenantId: T, branchId: null });
    expect(v.find((x) => x.reason === 'busier season')).toBeTruthy();
    expect(v.every((x) => x.branchId === null)).toBe(true);    // the salon scope lists the salon rows only
    const vb = await s.versions({ tenantId: T, branchId: B2 });
    expect(vb.some((x) => x.branchId === B2)).toBe(true);
    const audit = await q(`select action_type from audit_logs where tenant_id = $1 and entity_type = 'queue_assignment_settings'`, [T]);
    expect(audit.length).toBeGreaterThanOrEqual(v.length);
    const ev = await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.assignment_settings_changed'`, [T]);
    expect(ev[0].n).toBeGreaterThanOrEqual(v.length);
  });
});

describe('switches', () => {
  it('the salon kill switch stops auto everywhere, with its reason; unkill restores', async () => {
    let e = await s.setSalonKill(T, true, actor, 'wrong technician twice');
    expect(e.salonAutoKilled).toBe(true);
    const b1 = await s.effective({ tenantId: T, branchId: B1 });
    expect(b1.autoEnabled).toBe(true);
    expect(b1.autoAllowed).toBe(false);
    expect(b1.autoBlockedBy).toBe('salon_kill_switch');
    expect(b1.salonAutoKilledReason).toBe('wrong technician twice');
    const ev = await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.auto_assignment_disabled'`, [T]);
    expect(ev[0].n).toBe(1);
    e = await s.setSalonKill(T, false, actor, 'fixed');
    expect((await s.effective({ tenantId: T, branchId: B1 })).autoAllowed).toBe(true);
  });

  it('a branch-scope kill (update with change "kill") announces QUEUE_AUTO_ASSIGNMENT_DISABLED in the same transaction', async () => {
    const before = (await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.auto_assignment_disabled'`, [T]))[0].n;
    await s.update({ tenantId: T, branchId: B1 }, { autoEnabled: false }, actor, { change: 'kill', reason: 'assigning the wrong people' });
    const ev = await q(`select branch_id, actor_id, payload_json from outbox_events where tenant_id = $1 and event_type = 'queue.auto_assignment_disabled' order by occurred_at desc`, [T]);
    expect(ev.length).toBe(before + 1);
    const payload = typeof ev[0].payload_json === 'string' ? JSON.parse(ev[0].payload_json) : ev[0].payload_json;
    expect([ev[0].branch_id, ev[0].actor_id, payload]).toEqual([B1, U, { scope: 'branch', reason: 'assigning the wrong people' }]);
    // an ordinary settings save (or turning auto back on) is not a kill
    await s.update({ tenantId: T, branchId: B1 }, { autoEnabled: true }, actor, { change: 'unkill', reason: 'fixed' });
    await s.update({ tenantId: T, branchId: B1 }, { lateGraceMin: 11 }, actor, {});
    expect((await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.auto_assignment_disabled'`, [T]))[0].n).toBe(before + 1);
    // the event lives in the update's transaction: a refused (stale) kill writes nothing
    await expect(s.update({ tenantId: T, branchId: B1 }, { autoEnabled: false }, actor, { change: 'kill', reason: 'x', expectedVersion: 0 })).rejects.toBeInstanceOf(QueueSettingsConflictError);
    expect((await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.auto_assignment_disabled'`, [T]))[0].n).toBe(before + 1);
  });

  it('the platform switch (ai.auto_actions_disabled) wins over everything', async () => {
    await pg.exec(`INSERT INTO platform_settings (setting_key, setting_group, value, value_type) VALUES ('ai.auto_actions_disabled', 'kill_switches', 'true'::jsonb, 'boolean')
                   ON CONFLICT (setting_key) DO UPDATE SET value = 'true'::jsonb`);
    const e = await s.effective({ tenantId: T, branchId: B1 });
    expect(e.platformAutoActionsDisabled).toBe(true);
    expect(e.autoAllowed).toBe(false);
    expect(e.autoBlockedBy).toBe('platform');
    await pg.exec(`UPDATE platform_settings SET value = 'false'::jsonb WHERE setting_key = 'ai.auto_actions_disabled'`);
    expect((await s.effective({ tenantId: T, branchId: B1 })).autoAllowed).toBe(true);
  });
});

describe('in-memory twin behaves the same on the rules the services rely on', () => {
  it('layers, versions, kills', async () => {
    const m = new InMemoryQueueAssignmentSettings();
    await m.update({ tenantId: 't', branchId: null }, { autoEnabled: true, waitSevereMin: 33, waitCriticalMin: 44 }, actor);
    await m.update({ tenantId: 't', branchId: 'b' }, { stuckMinutes: 20 }, actor);
    const e = await m.effective({ tenantId: 't', branchId: 'b' });
    expect([e.waitSevereMin, e.stuckMinutes, e.autoAllowed, e.configVersion]).toEqual([33, 20, true, '1.1']);
    await expect(m.update({ tenantId: 't', branchId: 'b' }, { lateGraceMin: 1 }, actor, { expectedVersion: 0 })).rejects.toBeInstanceOf(QueueSettingsConflictError);
    await m.setSalonKill('t', true, actor, 'stop it now please');
    expect((await m.effective({ tenantId: 't', branchId: 'b' })).autoBlockedBy).toBe('salon_kill_switch');
    await expect(m.update({ tenantId: 't', branchId: null }, { fixedOrder: ['x'] }, actor)).rejects.toBeInstanceOf(QueueSettingsValidationError);
  });
});

// Oct 13 2026 (FLOW duplicate T1 merged): the five legacy scoring policies are no longer a second ranking authority
// beside the Fair Turn Engine — a legacy value, stored or sent, means its fairness mode (hybrid → hybrid_fairness,
// least_minutes → workload_balanced, least_customers → lowest_turn_units, first_available → traditional_weighted_rotation,
// fixed_order → manual_order), so EVERY salon ranks through the one explainable engine.
describe('legacy rotation policies resolve to the one Fair Turn Engine (T1)', () => {
  it('a legacy value saved on the salon or a branch is stored AND read as its fairness mode; a legacy value already in the database reads as its mode', async () => {
    await s.update({ tenantId: T, branchId: null }, { rotationPolicy: 'least_minutes' as any }, actor, { reason: 'old screen' });
    expect((await s.effective({ tenantId: T, branchId: B3 })).rotationPolicy).toBe('workload_balanced');
    expect((await q(`select rotation_policy from queue_assignment_tenant_settings where tenant_id = $1`, [T]))[0].rotation_policy).toBe('workload_balanced');
    await s.update({ tenantId: T, branchId: B3 }, { rotationPolicy: 'fixed_order' as any, fixedOrder: [TECH2, TECH1] }, actor, { reason: 'old screen' });
    const e = await s.effective({ tenantId: T, branchId: B3 });
    expect(e.rotationPolicy).toBe('manual_order');
    expect(e.fixedOrder).toEqual([TECH2, TECH1]);
    // a row written before this change (raw legacy value) still resolves to its mode on read
    await q(`update queue_assignment_rotation_state set policy = 'least_customers' where tenant_id = $1 and branch_id = $2`, [T, B3]);
    expect((await s.effective({ tenantId: T, branchId: B3 })).rotationPolicy).toBe('lowest_turn_units');
    await q(`update queue_assignment_tenant_settings set rotation_policy = 'first_available' where tenant_id = $1`, [T]);
    expect((await s.effective({ tenantId: T, branchId: B1 })).rotationPolicy).toBe('traditional_weighted_rotation');
  });
});

// Oct 13 2026 (FLOW §158 BUILT): the language reads behind the Fair Turn Engine's soft/hard language matching —
// the guest's customers.preferred_language (490) via her queue entry; a technician's profile languages (global_tech_profiles)
// plus her app language (users.preferred_language, 560). No data = unknown (absent), never "does not speak".
describe('KyselyTurnReadAdapter — language reads (§158)', () => {
  const CUST = 'a6a6a6a6-0000-4000-8000-0000000000d1', QI = 'a6a6a6a6-0000-4000-8000-0000000000e1', QI2 = 'a6a6a6a6-0000-4000-8000-0000000000e2';
  const USER1 = 'a6a6a6a6-0000-4000-8000-0000000000f1', GTP2 = 'a6a6a6a6-0000-4000-8000-0000000000f2', TECH3 = 'a6a6a6a6-0000-4000-8000-0000000000c3';
  it('guest language and technician languages resolve to short codes; unknown stays unknown', async () => {
    const { KyselyTurnReadAdapter } = await import('./ai-queue-assignment.adapters');
    await pg.exec(`
      INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, preferred_language) VALUES ('${CUST}', '${T}', '${B1}', 'Thao', 'N', 'Thao N', 'Vietnamese') ON CONFLICT DO NOTHING;
      INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, status, checked_in_at) VALUES ('${QI}', '${T}', '${B1}', '${CUST}', 'Thao N', 'waiting', now()) ON CONFLICT DO NOTHING;
      INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, status, checked_in_at) VALUES ('${QI2}', '${T}', '${B1}', 'Walk-in', 'waiting', now()) ON CONFLICT DO NOTHING;
      INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, preferred_language) VALUES ('${USER1}', '${T}', '${B1}', 'Lan', 'T', 'Lan T', 'lan-158@aipowersalon.test', 'x', 'active', 'TECHNICIAN', 'vi') ON CONFLICT DO NOTHING;
      INSERT INTO global_tech_profiles (id, public_slug, display_name, tech_code, languages) VALUES ('${GTP2}', 'mia-158', 'Mia', 'MIA158', '["English", "es"]'::jsonb) ON CONFLICT DO NOTHING;
      INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) VALUES ('${TECH1}', '${T}', '${B1}', '${USER1}', 'Lan', 'T', 'Lan T', 'active') ON CONFLICT DO NOTHING;
      INSERT INTO technicians (id, tenant_id, branch_id, global_tech_profile_id, first_name, last_name, full_name, status) VALUES ('${TECH2}', '${T}', '${B1}', '${GTP2}', 'Mia', 'K', 'Mia K', 'active') ON CONFLICT DO NOTHING;
      INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH3}', '${T}', '${B1}', 'No', 'Data', 'No Data', 'active') ON CONFLICT DO NOTHING;
    `);
    const a = new KyselyTurnReadAdapter(kyselyFor(pg) as never);
    const ctx = { tenantId: T, branchId: B1, userId: U, role: 'OWNER', permissions: [] } as any;
    expect(await a.guestLanguage(ctx, QI)).toBe('vi');
    expect(await a.guestLanguage(ctx, QI2)).toBeNull();
    const m = await a.technicianLanguages(ctx, [TECH1, TECH2, TECH3]);
    expect([...m.get(TECH1)!]).toEqual(['vi']);
    expect([...m.get(TECH2)!].sort()).toEqual(['en', 'es']);
    expect(m.has(TECH3)).toBe(false);
    // another tenant sees nothing
    expect((await a.technicianLanguages({ ...ctx, tenantId: 'a6a6a6a6-0000-4000-8000-0000000000ff' }, [TECH1])).size).toBe(0);
  });
});
