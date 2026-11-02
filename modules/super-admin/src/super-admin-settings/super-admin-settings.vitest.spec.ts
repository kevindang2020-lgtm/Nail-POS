import { describe, it, expect, beforeEach } from 'vitest';
import { SuperAdminSettingsService, SettingsError } from './super-admin-settings.service';
import { InMemoryPlatformSettingsRepo } from './platform-settings.repository';
import { DISPLAY_AD_PLATFORM_SETTINGS } from '@aipowersalon/api-contracts';

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io', role: 'SUPER_ADMIN' };

function make() {
  const repo = new InMemoryPlatformSettingsRepo();
  return { svc: new SuperAdminSettingsService(repo), repo };
}

describe('SuperAdminSettingsService.getSettings', () => {
  it('returns grouped settings with code defaults until explicitly set', async () => {
    const { svc } = make();
    const { groups, explicitlySetCount } = await svc.getSettings();
    expect(explicitlySetCount).toBe(0);
    const flat = groups.flatMap((g) => g.settings);
    const trial = flat.find((s) => s.key === 'defaults.tenant_trial_days')!;
    expect(trial.value).toBe(14);
    expect(trial.isExplicitlySet).toBe(false);
    expect(trial.version).toBe(0);
    // groups are present in display order
    expect(groups[0].group).toBe('platform_identity');
    expect(flat.find((s) => s.key === 'support.email')!.mandatory).toBe(true);
  });
});

describe('SuperAdminSettingsService.saveSettings', () => {
  let svc: SuperAdminSettingsService;
  beforeEach(() => { svc = make().svc; });

  it('applies a valid change, bumps the version, and records immutable history', async () => {
    const res = await svc.saveSettings(CTX, [{ key: 'defaults.tenant_trial_days', value: 21, reason: 'Longer trial' }]);
    expect(res.applied).toEqual([{ key: 'defaults.tenant_trial_days', version: 1 }]);
    const after = (await svc.getSettings()).groups.flatMap((g) => g.settings).find((s) => s.key === 'defaults.tenant_trial_days')!;
    expect(after.value).toBe(21);
    expect(after.isExplicitlySet).toBe(true);
    expect(after.version).toBe(1);
    const hist = await svc.recentChanges();
    expect(hist[0]).toMatchObject({ settingKey: 'defaults.tenant_trial_days', previousValue: 14, newValue: 21, version: 1 });
  });

  it('skips unchanged fields (no no-op history)', async () => {
    const res = await svc.saveSettings(CTX, [{ key: 'defaults.tenant_trial_days', value: 14 }]); // same as default
    expect(res.skipped).toContain('defaults.tenant_trial_days');
    expect(res.applied).toHaveLength(0);
    expect(await svc.recentChanges()).toHaveLength(0);
  });

  it('detects a version conflict rather than overwriting a newer change', async () => {
    await svc.saveSettings(CTX, [{ key: 'defaults.booking_interval_min', value: 20 }]); // now version 1
    // a stale editor still thinks it is version 0
    const res = await svc.saveSettings(CTX, [{ key: 'defaults.booking_interval_min', value: 45, expectedVersion: 0 }]);
    expect(res.conflicts).toContain('defaults.booking_interval_min');
    expect((await svc.getSettings()).groups.flatMap((g) => g.settings).find((s) => s.key === 'defaults.booking_interval_min')!.value).toBe(20);
  });

  it('validates by type: rejects bad email, non-https URL, invalid timezone, unsafe scheme', async () => {
    await expect(svc.saveSettings(CTX, [{ key: 'support.email', value: 'not-an-email' }])).rejects.toThrow(SettingsError);
    await expect(svc.saveSettings(CTX, [{ key: 'urls.main_website', value: 'http://insecure.example' }])).rejects.toThrow(/https/i);
    await expect(svc.saveSettings(CTX, [{ key: 'urls.main_website', value: 'javascript:alert(1)' }])).rejects.toThrow(SettingsError);
    await expect(svc.saveSettings(CTX, [{ key: 'localization.default_timezone', value: 'Mars/Phobos' }])).rejects.toThrow(/timezone/i);
    await expect(svc.saveSettings(CTX, [{ key: 'localization.default_currency', value: 'ZZZ' }])).rejects.toThrow(/currency/i);
  });

  it('accepts a valid IANA timezone and a valid https URL', async () => {
    const res = await svc.saveSettings(CTX, [
      { key: 'localization.default_timezone', value: 'America/Los_Angeles' },
      { key: 'urls.main_website', value: 'https://www.example.com' },
    ]);
    expect(res.applied.map((a) => a.key).sort()).toEqual(['localization.default_timezone', 'urls.main_website']);
  });

  it('rejects an unknown setting key', async () => {
    await expect(svc.saveSettings(CTX, [{ key: 'not.a.real.setting', value: 1 }])).rejects.toThrow(/unknown setting/i);
  });

  it('resets to defaults only with the typed confirmation, recording the reversal', async () => {
    await svc.saveSettings(CTX, [{ key: 'defaults.tenant_trial_days', value: 30 }]);
    await expect(svc.resetToDefaults(CTX, 'nope')).rejects.toThrow(/type RESET/i);
    const res = await svc.resetToDefaults(CTX, 'RESET');
    expect(res.reset).toBe(1);
    const after = (await svc.getSettings()).groups.flatMap((g) => g.settings).find((s) => s.key === 'defaults.tenant_trial_days')!;
    expect(after.value).toBe(14); // back to code default
    expect(after.isExplicitlySet).toBe(false);
    expect((await svc.recentChanges()).some((c) => c.source === 'reset')).toBe(true);
  });

  it('operation() is honest about subsystems that are not connected', async () => {
    expect((await svc.operation(CTX, 'search_reindex')).ok).toBe(false);
    expect((await svc.operation(CTX, 'email_test')).ok).toBe(false);
    expect((await svc.operation(CTX, 'cache_clear')).ok).toBe(true);
    await expect(svc.operation(CTX, 'bogus')).rejects.toThrow(/unknown operation/i);
  });

  it('localization distribution counts default POS languages; a tenant that never set one is "Not set (English)", never the platform default (WP-A)', async () => {
    const { svc, repo } = make();
    expect((await svc.localizationDistribution()).available).toBe(false); // no DB distribution → honest unavailable
    repo.seedLocaleDistribution([{ locale: null, count: 200 }, { locale: 'vi-VN', count: 40 }, { locale: 'en-US', count: 8 }]);
    const d = await svc.localizationDistribution();
    expect(d.available).toBe(true);
    expect(d.items[0]).toEqual({ locale: 'unset', label: 'Not set (English)', count: 200 });
    expect(d.items.find((i) => i.locale === 'vi-VN')).toEqual({ locale: 'vi-VN', label: 'Vietnamese (VN)', count: 40 });
    expect(d.items.find((i) => i.locale === 'en-US')!.count).toBe(8);   // explicit English only
  });

  it('adoption rate = tenants on defaults vs customized (honest when no data)', async () => {
    const { svc, repo } = make();
    expect((await svc.adoptionRate()).available).toBe(false); // no counts
    repo.seedAdoption({ totalTenants: 200, overriddenTenants: 60 });
    const a = await svc.adoptionRate();
    expect(a).toEqual({ available: true, totalTenants: 200, onDefaults: 140, customized: 60, rate: 70 });
  });
});

describe('SuperAdminSettingsService.getOverview', () => {
  it('derives cards from real settings and flags unmodeled data honestly', async () => {
    const { svc } = make();
    const { cards } = await svc.getOverview();
    expect(cards.platformLocale.value).toBe('English (US)');
    expect(cards.brandTheme.value).toBe('Sunset Orange');
    expect(cards.maintenanceMode.on).toBe(false);
    expect(cards.defaultTimezone.value).toMatch(/^\(UTC[-+]\d{2}:\d{2}\)$/);
    expect(cards.supportChannels.value).toBe(4); // 4 configured support settings by default
    expect(cards.platformStatus.value).toBe('Healthy');
    // no DB in memory → tenant count unavailable (not faked); legal-doc entity not built → unavailable
    expect(cards.activeTenants.available).toBe(false);
    expect(cards.legalDocsVersion.available).toBe(false);
  });
});

describe('SuperAdminSettingsService.changesSeries', () => {
  it('returns a daily bucket per day with real change counts', async () => {
    const { svc } = make();
    await svc.saveSettings(CTX, [{ key: 'defaults.tenant_trial_days', value: 21 }]);
    await svc.saveSettings(CTX, [{ key: 'defaults.booking_interval_min', value: 20 }]);
    const series = await svc.changesSeries(7);
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].count).toBe(2); // both changes are today
    expect(series.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date))).toBe(true);
  });
});

// 23-inch dual-screen spec §110: Super Admin's controls for salons' customer-display advertising. The keys, labels and
// defaults are the ONE copy in @aipowersalon/api-contracts that the marketing module enforces — so the screen shows
// exactly the rule in force.
describe('Customer Display Advertising platform controls (§110)', () => {
  it('appear as their own group, with the contract defaults, as mandatory platform rules', async () => {
    const { svc } = make();
    const g = (await svc.getSettings()).groups.find((x) => x.group === 'customer_display_ads')!;
    expect(g.settings.map((s) => [s.key, s.default, s.valueType])).toEqual(DISPLAY_AD_PLATFORM_SETTINGS.map((d) => [d.key, d.default, d.valueType]));
    expect(g.settings.every((s) => s.mandatory && s.policy === 'mandatory')).toBe(true);
  });
  it('a change is saved, versioned and audited like any platform setting; a wrong type is refused', async () => {
    const { svc } = make();
    const res = await svc.saveSettings(CTX, [{ key: 'display_ads.max_ads_per_tenant', value: 25, reason: 'Pilot cap' }]);
    expect(res.applied).toEqual([{ key: 'display_ads.max_ads_per_tenant', version: 1 }]);
    await expect(svc.saveSettings(CTX, [{ key: 'display_ads.fullscreen_idle_allowed', value: 'yes' as any }])).rejects.toBeInstanceOf(SettingsError);
  });
});
