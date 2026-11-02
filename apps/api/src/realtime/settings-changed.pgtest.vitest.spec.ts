// settings-changed.pgtest — settings_updated end to end on the real schema, and the payroll-policy save that used
// to report success when its write failed.
import { notifySettingsChanged, EVENTS } from '@aipowersalon/realtime-contracts';
import { describe, it, expect, beforeAll } from 'vitest';
import { CompensationTipPolicyService } from '@aipowersalon/workforce';
import { KyselyAiSettingsStore } from '@aipowersalon/ai';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'd8d8d8d8-0000-4000-8000-000000000001';
const B = 'd8d8d8d8-0000-4000-8000-000000000002';
const ctx = { tenantId: T, branchId: B, userId: null };
let db: any;

const spy = () => {
  const sent: Array<{ tenantId: string; event: string; payload: any }> = [];
  return { sent, rt: { toOwner: (tenantId: string, event: string, payload: any) => sent.push({ tenantId, event, payload }) } as never };
};

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Settings Salon LLC', 'Settings Salon', 'settings-salon', 'SETT1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;`).catch(() => undefined);
  db = kyselyFor(pg);
});

describe('the notifier', () => {
  it('sends settings_updated to the OWNER room with the category — the owner dashboard channel subscribes to it', () => {
    const { sent, rt } = spy();
    notifySettingsChanged(rt, T, 'receipts-branding');
    expect(sent).toEqual([{ tenantId: T, event: EVENTS.settingsUpdated, payload: { category: 'receipts-branding' } }]);
  });

  it('never throws — a failed emit must not fail the save that caused it', () => {
    const broken = { toOwner: () => { throw new Error('bus down'); } } as never;
    expect(() => notifySettingsChanged(broken, T, 'x')).not.toThrow();
  });

  it('with no emitter wired, it is a no-op rather than an error', () => {
    expect(() => notifySettingsChanged(undefined, T, 'x')).not.toThrow();
  });
});

describe('a successful save announces itself', () => {
  it('saving the tip split emits settings_updated, and the new value is really stored', async () => {
    const { sent, rt } = spy();
    const svc = new CompensationTipPolicyService(db, rt);
    await svc.set(ctx, 'equal');
    expect(sent.map((s) => s.payload.category)).toContain('compensation.tip_policy');
    expect((await svc.get(ctx)).manyTechTipMethod).toBe('equal');
  });

  it('the AI settings store — the writer a case-sensitive search missed — emits too', async () => {
    const { sent, rt } = spy();
    await new KyselyAiSettingsStore(db, rt).put(T, {} as never, null);
    expect(sent.map((s) => s.payload.category)).toContain('ai-platform');
  });
});

describe('FIXED: a failed payroll-policy save no longer reports success', () => {
  // A database whose tenant_settings write throws, while reads still work — so the service gets far enough to try.
  const writeFails = () => new Proxy(db, {
    get(target, prop) {
      if (prop === 'updateTable' || prop === 'insertInto') return () => { throw new Error('write failed'); };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  it('the save REJECTS instead of returning the new value as if it were stored', async () => {
    const svc = new CompensationTipPolicyService(writeFails() as never);
    await expect(svc.set(ctx, 'proportional')).rejects.toThrow();
  });

  it('…the stored tip split is unchanged — what payroll uses matches what the owner is told', async () => {
    const before = (await new CompensationTipPolicyService(db).get(ctx)).manyTechTipMethod;
    await new CompensationTipPolicyService(writeFails() as never).set(ctx, before === 'equal' ? 'proportional' : 'equal').catch(() => undefined);
    expect((await new CompensationTipPolicyService(db).get(ctx)).manyTechTipMethod).toBe(before);
  });

  it('…and a failed save does NOT announce a change that never happened', async () => {
    const { sent, rt } = spy();
    await new CompensationTipPolicyService(writeFails() as never, rt).set(ctx, 'proportional').catch(() => undefined);
    expect(sent).toHaveLength(0);
  });
});
