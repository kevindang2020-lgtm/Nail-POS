// ai-settings.vitest.spec.ts — receptionist settings. Defaults merge, validated patch (rejects unknown keys and
// out-of-range values), permission gating, and merge-on-update.
import { describe, it, expect } from 'vitest';
import { AiSettingsService, InMemorySettingsRepo, validatePatch, DEFAULT_SETTINGS, SettingsForbiddenError, SettingsValidationError } from './ai-settings.service';

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
  it('accepts and coerces valid values', () => {
    expect(validatePatch({ enabled: true, silenceTimeoutSeconds: 12.6 })).toEqual({ enabled: true, silenceTimeoutSeconds: 13 });
  });
});

describe('AiSettingsService', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await svc().get(owner as any)).toEqual(DEFAULT_SETTINGS);
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
