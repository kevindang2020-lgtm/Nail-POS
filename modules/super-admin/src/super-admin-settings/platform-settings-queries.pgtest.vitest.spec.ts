// platform-settings-queries.pgtest — executes the platform settings store against the real migrated schema.
//
// Two things worth pinning. A settings read that silently empties means the platform runs on **compiled-in
// defaults nobody chose**, while the Super Admin screen shows the values they saved. And `upsertIfVersion`
// implements optimistic concurrency: a stale `expectedVersion` must be REFUSED, not silently applied, or two
// admins editing the same setting quietly overwrite each other.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyPlatformSettingsRepo } from './platform-settings.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let repo: KyselyPlatformSettingsRepo;
const base = { group: 'branding', valueType: 'string', policy: 'overridable', isMandatory: false, isSensitive: false, changedBy: 'u1' };

beforeAll(async () => {
  const pg = await migratedPglite();
  repo = new KyselyPlatformSettingsRepo(kyselyFor(pg) as never);
});

describe('a stored setting round-trips', () => {
  it('a new setting is created at version 1 and READS BACK', async () => {
    const r = await repo.upsertIfVersion({ ...base, key: 'brand.name', value: 'AIPowerSalon', expectedVersion: 0 } as never);
    expect(r).not.toBeNull();
    const stored = (await repo.getStored('brand.name'))!;
    expect(stored.value).toBe('AIPowerSalon');
    // Version 1 specifically. Without this, an insert that writes version 0 passes every other test here,
    // because the update path only compares "after > before" and 1 > 0 just as well as 2 > 1.
    expect(stored.version).toBe(1);
  });

  it('it appears in the list — an empty list means the platform silently runs on defaults', async () => {
    expect((await repo.listStored()).map((s) => s.settingKey)).toContain('brand.name');
  });

  it('an update at the CURRENT version is applied and bumps the version', async () => {
    const before = (await repo.getStored('brand.name'))!;
    const r = await repo.upsertIfVersion({ ...base, key: 'brand.name', value: 'AIPowerSalon POS', expectedVersion: before.version } as never);
    expect(r).not.toBeNull();
    const after = (await repo.getStored('brand.name'))!;
    expect(after.value).toBe('AIPowerSalon POS');
    expect(after.version).toBeGreaterThan(before.version);
  });
});

describe('optimistic concurrency — the refusal is the feature', () => {
  it('a STALE expectedVersion is refused, and the stored value is UNCHANGED', async () => {
    const current = (await repo.getStored('brand.name'))!;
    const r = await repo.upsertIfVersion({ ...base, key: 'brand.name', value: 'Clobbered', expectedVersion: current.version - 1 } as never);
    expect(r).toBeNull();
    // The assertion that matters: refusing must also mean not writing.
    expect((await repo.getStored('brand.name'))!.value).toBe(current.value);
  });

  it('expectedVersion 0 against an EXISTING key is refused — that is the concurrent-create case', async () => {
    const r = await repo.upsertIfVersion({ ...base, key: 'brand.name', value: 'Racy', expectedVersion: 0 } as never);
    expect(r).toBeNull();
  });

  it('a non-zero expectedVersion against a MISSING key is refused', async () => {
    expect(await repo.upsertIfVersion({ ...base, key: 'brand.missing', value: 'x', expectedVersion: 3 } as never)).toBeNull();
  });
});

describe('the change log', () => {
  it('a recorded change comes back — an empty audit of settings changes reads as "nobody changed anything"', async () => {
    await repo.recordChange({ settingKey: 'brand.name', settingGroup: 'branding', previousValue: 'a', newValue: 'b', version: 2, actor: 'u1' } as never);
    const changes = await repo.listChanges(10);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.map((c) => c.settingKey)).toContain('brand.name');
  });
});
