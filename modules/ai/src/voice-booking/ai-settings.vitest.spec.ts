// ai-settings.vitest.spec.ts — receptionist settings. Defaults merge, validated patch (rejects unknown keys and
// out-of-range values), permission gating, and merge-on-update.
import { describe, it, expect } from 'vitest';
import { AiSettingsService, InMemorySettingsRepo, validatePatch, DEFAULT_SETTINGS, SettingsForbiddenError, SettingsValidationError, SettingsConflictError } from './ai-settings.service';

const owner = { tenantId: 't1', branchId: null, userId: 'u1', role: 'OWNER', permissions: ['ai.manage'] };
const viewer = { tenantId: 't1', branchId: null, userId: 'u2', role: 'RECEPTION', permissions: ['ai.use'] };
const svc = () => new AiSettingsService(new InMemorySettingsRepo());

describe('validatePatch', () => {
  it('rejects unknown keys and out-of-range numbers', () => {
    expect(() => validatePatch({ bogus: 1 })).toThrow(SettingsValidationError);
    expect(() => validatePatch({ silenceTimeoutSeconds: 100 })).toThrow(SettingsValidationError);
    expect(() => validatePatch({ maxCallDurationSeconds: 10 })).toThrow(SettingsValidationError);
    expect(() => validatePatch({ afterHoursBehavior: 'party' })).toThrow(SettingsValidationError);
    expect(() => validatePatch({ enabled: 'yes' as any })).toThrow(SettingsValidationError);
  });
  it('accepts valid values; a decimal is refused, never rounded (Nov 3 audit, guide SET-11)', () => {
    expect(validatePatch({ enabled: true, silenceTimeoutSeconds: 13 })).toEqual({ enabled: true, silenceTimeoutSeconds: 13 });
    expect(() => validatePatch({ silenceTimeoutSeconds: 12.6 })).toThrow(SettingsValidationError);
    expect(() => validatePatch({ maxCallDurationSeconds: 90.5 })).toThrow(SettingsValidationError);
  });
  it('a consent message is kept whole up to 2000 characters, refused beyond — never cut to 500', () => {
    expect(validatePatch({ recordingConsentMessage: 'x'.repeat(1200) }).recordingConsentMessage).toHaveLength(1200);
    expect(() => validatePatch({ recordingConsentMessage: 'x'.repeat(2001) })).toThrow(SettingsValidationError);
  });
});

describe('AiSettingsService', () => {
  it('returns defaults when nothing is stored', async () => {
    const { meta, ...rest } = await svc().get(owner as any);
    expect(rest).toEqual(DEFAULT_SETTINGS);
    expect(meta).toEqual({ version: 0, source: 'defaults', scope: 'salon', appliedToCalls: false });
  });
  it('refuses writes without ai.manage', async () => {
    await expect(svc().update(viewer as any, { enabled: true })).rejects.toBeInstanceOf(SettingsForbiddenError);
  });
  it('merges a patch over current settings and persists', async () => {
    const s = svc();
    const updated = await s.update(owner as any, { enabled: true, recordingEnabled: true });
    expect(updated).toMatchObject({ enabled: true, recordingEnabled: true, defaultLanguage: 'en' });
    const reread = await s.get(owner as any);
    expect(reread.enabled).toBe(true);
    expect(reread.recordingEnabled).toBe(true);
  });
});

describe('Kevin (Oct 28 2026): the AI receptionist speaks English only', () => {
  it('a Spanish or Vietnamese default is saved and read back as English; the rest of the form still saves', async () => {
    for (const lang of ['es', 'vi', 'en-US']) expect(validatePatch({ defaultLanguage: lang, enabled: true })).toEqual({ defaultLanguage: 'en', enabled: true });
  });
  it('a Vietnamese default stored before Oct 28 reads back as English', async () => {
    const repo = new InMemorySettingsRepo();
    await repo.upsert('t1', '00000000-0000-0000-0000-000000000000', { ...DEFAULT_SETTINGS, defaultLanguage: 'vi' }, 'u1');
    expect((await new AiSettingsService(repo).get(owner as any)).defaultLanguage).toBe('en');
  });
});

describe('Nov 3 audit: a failed read never turns into defaults that a save writes back', () => {
  it('get and update fail when the stored settings cannot be read; nothing is written', async () => {
    let writes = 0;
    const broken = { get: async () => { throw new Error('db down'); }, upsert: async () => { writes++; } };
    const s = new AiSettingsService(broken as any);
    await expect(s.get(owner as any)).rejects.toThrow('db down');
    await expect(s.update(owner as any, { enabled: true })).rejects.toThrow('db down');
    expect(writes).toBe(0);
  });
  it('a branch reads the salon-wide settings unless it has its own', async () => {
    const repo = new InMemorySettingsRepo();
    await repo.upsert('t1', '00000000-0000-0000-0000-000000000000', { ...DEFAULT_SETTINGS, silenceTimeoutSeconds: 20 }, 'u1');
    const branchCtx = { ...owner, branchId: 'b1' };
    expect((await new AiSettingsService(repo).get(branchCtx as any)).silenceTimeoutSeconds).toBe(20);
    await repo.upsert('t1', 'b1', { ...DEFAULT_SETTINGS, silenceTimeoutSeconds: 9 }, 'u1');
    expect((await new AiSettingsService(repo).get(branchCtx as any)).silenceTimeoutSeconds).toBe(9);
  });
});

describe('Receptionist Settings guide: versions, history, concurrent edits', () => {
  it('each save is a new version with before / changed keys; a save from an older screen is refused', async () => {
    const s = svc();
    const v1 = await s.update(owner as any, { enabled: true, expectedVersion: 0 });
    expect(v1.meta).toMatchObject({ version: 1, source: 'salon' });
    await s.update(owner as any, { silenceTimeoutSeconds: 12, expectedVersion: 1 });
    await expect(s.update(owner as any, { enabled: false, expectedVersion: 1 })).rejects.toBeInstanceOf(SettingsConflictError);
    const h = await s.history(owner as any);
    expect(h.items.map((x) => x.version)).toEqual([2, 1]);
    expect(h.items[0]).toMatchObject({ changedKeys: ['silenceTimeoutSeconds'], before: expect.objectContaining({ silenceTimeoutSeconds: 8 }) });
    expect((await s.get(owner as any)).enabled).toBe(true);
  });
});
