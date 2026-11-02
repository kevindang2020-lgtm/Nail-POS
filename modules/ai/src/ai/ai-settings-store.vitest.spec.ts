// ai-settings-store.vitest.spec — Constitution 10 §52–§53, §110 on the WRITE path.
import { describe, it, expect } from 'vitest';
import { validateAiSettings, mergeTightest, resolveTenantSafety, InMemoryAiSettingsStore, AiSettingsValidationError, AI_SETTINGS_CATEGORY } from './ai-settings-store';
import { TenantAiDashboardController } from './ai-control-plane.controller';
import { AiControlPlaneService } from './ai-control-plane.service';
import { ProviderCircuitBreakers } from './ai-provider-health';
import { DEFAULT_AI_PERMISSIONS } from './ai-feedback';
import { evaluateSafety, PLATFORM_MAX_AUTOMATION } from './ai-safety-policy';

const emptyPort = { usageSince: async () => [], runningJobs: async () => 0, safetyEventCount: async () => 0, pendingApprovals: async () => [], budgetFor: async () => null, enabledPackages: async () => [], feedbackFor: async () => [] };
const ctl = (store = new InMemoryAiSettingsStore()) => ({ c: new TenantAiDashboardController(new AiControlPlaneService(emptyPort, new ProviderCircuitBreakers()), store), store });
const req = (role: string) => ({ tenant: { id: 't1' }, user: { id: 'u1', tenantId: 't1', role } });

describe('§110 enforced on the WRITE, not only on read', () => {
  it('accepts a tightening', () => {
    expect(validateAiSettings({ automation: { 'review.response_draft': 'SUGGEST_ONLY' } })).toEqual({ automation: { 'review.response_draft': 'SUGGEST_ONLY' } });
  });
  it('REJECTS a loosening with the ceiling named — not stored and clamped later', () => {
    expect(() => validateAiSettings({ automation: { 'review.response_draft': 'AUTOMATIC' } })).toThrow(/allows at most DRAFT/);
    expect(() => validateAiSettings({ automation: { 'money.explain_alert': 'LIMITED_AUTOMATION' } })).toThrow(/at most SUGGEST_ONLY/);
  });
  it('every task can be set to its own ceiling and no higher', () => {
    for (const [taskKey, ceiling] of Object.entries(PLATFORM_MAX_AUTOMATION)) {
      expect(() => validateAiSettings({ automation: { [taskKey]: ceiling } }), taskKey).not.toThrow();
      if (ceiling !== 'AUTOMATIC') expect(() => validateAiSettings({ automation: { [taskKey]: 'AUTOMATIC' } }), taskKey).toThrow();
    }
  });
  it('refuses unknown tasks, tools, levels and settings keys — a typo must not read as "switched off"', () => {
    expect(() => validateAiSettings({ automation: { 'ghost.task': 'OFF' } })).toThrow(/unknown AI task/);
    expect(() => validateAiSettings({ automation: { 'review.response_draft': 'SOMETIMES' } })).toThrow(/not an automation level/);
    expect(() => validateAiSettings({ disabledTasks: ['review.respons_draft'] })).toThrow(/unknown AI task/);
    expect(() => validateAiSettings({ disabledTools: ['booking.search_availabilty'] })).toThrow(/unknown AI tool/);
    expect(() => validateAiSettings({ autoActionsDisbaled: true })).toThrow(/unknown setting/);
    expect(() => validateAiSettings({ autoActionsDisabled: 'yes' })).toThrow(/must be a boolean/);
  });
  it('a valid full payload round-trips', () => {
    const s = validateAiSettings({ automation: { 'voice.summarize': 'OFF' }, autoActionsDisabled: true, disabledTasks: ['marketing.content_draft'], disabledTools: ['queue.read'] });
    expect(s).toMatchObject({ autoActionsDisabled: true, disabledTasks: ['marketing.content_draft'], disabledTools: ['queue.read'] });
  });
});

describe('§53 branch settings layer over tenant-wide by TIGHTENING', () => {
  it('a branch may tighten automation; it may not loosen it', () => {
    const merged = mergeTightest({ automation: { 'review.response_draft': 'DRAFT' } }, { automation: { 'review.response_draft': 'SUGGEST_ONLY' } });
    expect(merged.automation!['review.response_draft']).toBe('SUGGEST_ONLY');
    const loosen = mergeTightest({ automation: { 'review.response_draft': 'SUGGEST_ONLY' } }, { automation: { 'review.response_draft': 'DRAFT' } });
    expect(loosen.automation!['review.response_draft']).toBe('SUGGEST_ONLY');   // branch could not loosen
  });
  it('a kill switch set at EITHER level is on; disabled lists union', () => {
    expect(mergeTightest({ autoActionsDisabled: true }, {}).autoActionsDisabled).toBe(true);
    expect(mergeTightest({}, { autoActionsDisabled: true }).autoActionsDisabled).toBe(true);
    expect(mergeTightest({ disabledTasks: ['a'] } as never, { disabledTasks: ['b'] } as never).disabledTasks).toEqual(['a', 'b']);
  });
  it('PII permission INTERSECTS — a branch cannot permit what the tenant did not', () => {
    expect(mergeTightest({ allowPiiInText: ['PHONE'] }, { allowPiiInText: ['PHONE', 'EMAIL'] }).allowPiiInText).toEqual(['PHONE']);
  });
  it('the store layers tenant-wide and branch rows the same way', async () => {
    const store = new InMemoryAiSettingsStore();
    await store.put('t1', { automation: { 'review.response_draft': 'DRAFT' } }, 'u1', null);
    await store.put('t1', { automation: { 'review.response_draft': 'OFF' } }, 'u1', 'b1');
    expect((await store.get('t1', 'b1')).automation!['review.response_draft']).toBe('OFF');
    expect((await store.get('t1')).automation!['review.response_draft']).toBe('DRAFT');
  });
});

describe('the settings endpoints', () => {
  it('§169 only a role with ai.settings.manage may read or write', async () => {
    const { c } = ctl();
    expect(() => c.getSettings(req('RECEPTION'))).toThrow();
    expect(() => c.putSettings(req('TECHNICIAN'), { settings: {} })).toThrow();
    await expect(c.getSettings(req('OWNER'))).resolves.toHaveProperty('settings');
  });
  it('returns the platform ceilings alongside, so a UI offers only adjustable choices', async () => {
    const r: any = await ctl().c.getSettings(req('OWNER'));
    expect(r.levels[0]).toBe('OFF');
    expect(r.tasks.find((t: any) => t.taskKey === 'money.explain_alert')).toMatchObject({ risk: 'HIGH', platformMax: 'SUGGEST_ONLY' });
  });
  it('saves, and the DASHBOARD then reflects it — the loop the platform was missing', async () => {
    const { c, store } = ctl();
    await c.putSettings(req('OWNER'), { settings: { automation: { 'review.response_draft': 'SUGGEST_ONLY' } } });
    expect((await store.get('t1')).automation!['review.response_draft']).toBe('SUGGEST_ONLY');
    const dash: any = await c.dashboard(req('OWNER'));
    expect(dash.automationByTask.find((a: any) => a.taskKey === 'review.response_draft')).toEqual({ taskKey: 'review.response_draft', effective: 'SUGGEST_ONLY', platformMax: 'DRAFT' });
    // …and the safety engine agrees, which is what makes the setting real rather than cosmetic
    expect(evaluateSafety('review.response_draft', { tenant: await store.get('t1') }).automation).toBe('SUGGEST_ONLY');
  });
  it('a rejected payload is NOT saved', async () => {
    const { c, store } = ctl();
    await expect(c.putSettings(req('OWNER'), { settings: { automation: { 'review.response_draft': 'AUTOMATIC' } } })).rejects.toMatchObject({ status: 400 });
    expect(await store.get('t1')).toEqual(expect.objectContaining({ automation: undefined }));
  });
  // w4 sweep SW-05: the app's session middleware puts the caller on req.ctx — nothing ever sets req.user — so every
  // real caller (the OWNER included) was read as a TECHNICIAN and pos-web's AI settings screen answered 403 to everyone.
  it('reads the caller from the REAL session shape (req.ctx), so the owner opens and saves the settings for her branch', async () => {
    const { c, store } = ctl();
    const session = (role: string) => ({ ctx: { tenantId: 't1', userId: 'u1', role, branchId: 'b1', permissions: [] } });
    await expect(c.getSettings(session('OWNER'))).resolves.toHaveProperty('settings');
    await expect(c.feedback(session('MANAGER'))).resolves.toBeDefined();
    expect(() => c.getSettings(session('FRONT_DESK'))).toThrow();
    await c.putSettings(session('OWNER'), { settings: { automation: { 'review.response_draft': 'OFF' } } });
    expect((await store.get('t1', 'b1')).automation!['review.response_draft']).toBe('OFF');
  });
  it('the settings live in the existing tenant_settings store, not a new table', () => {
    expect(AI_SETTINGS_CATEGORY).toBe('ai-platform');
  });
});

// N-4 / SD-23: the POS "Turn off all AI in this salon" checkbox. The editor sent settings.killSwitch on every save and the
// server had no such setting, so the checkbox did nothing (and the route had to stay non-strict for it).
describe('N-4 the salon\'s "turn off all AI" switch', () => {
  it('is a real setting: validated, stored, and refused when it is not a boolean', () => {
    expect(validateAiSettings({ killSwitch: true })).toEqual({ killSwitch: true });
    expect(validateAiSettings({ automation: {}, killSwitch: false })).toEqual({ automation: {}, killSwitch: false });
    expect(() => validateAiSettings({ killSwitch: 'on' })).toThrow(/killSwitch must be a boolean/);
  });
  it('on at EITHER level is on — a branch may turn AI off when the tenant-wide setting leaves it on', () => {
    expect(mergeTightest({ killSwitch: true }, {}).killSwitch).toBe(true);
    expect(mergeTightest({}, { killSwitch: true }).killSwitch).toBe(true);
    expect(mergeTightest({ killSwitch: true }, { killSwitch: false }).killSwitch).toBe(true);   // a branch cannot turn it back on
    expect(mergeTightest({}, {}).killSwitch).toBeUndefined();
  });
  it('the POS editor\'s exact save round-trips through the endpoint, and every AI task is then OFF for the salon', async () => {
    const { c, store } = ctl();
    // posAiGovernanceApi.saveSettings({ automation: draft, killSwitch }) → POST { settings: { automation, killSwitch } }
    const r: any = await c.putSettings(req('OWNER'), { settings: { automation: { 'review.response_draft': 'DRAFT' }, killSwitch: true } });
    expect(r).toMatchObject({ ok: true, settings: { killSwitch: true } });
    const saved = await store.get('t1');
    expect(saved.killSwitch).toBe(true);
    for (const taskKey of Object.keys(PLATFORM_MAX_AUTOMATION)) {
      const d = evaluateSafety(taskKey, { tenant: saved });
      expect(d.allowed, taskKey).toBe(false);
      expect(d.automation, taskKey).toBe('OFF');
      expect(d.boundBy, taskKey).toBe('tenant_kill_switch');
    }
    // …the dashboard shows it, and the GET hands the checkbox its state back
    const dash: any = await c.dashboard(req('OWNER'));
    expect(dash.automationByTask.every((a: any) => a.effective === 'OFF')).toBe(true);
    expect(((await c.getSettings(req('OWNER'))) as any).settings.killSwitch).toBe(true);
    // unticking it saves false, and AI comes back under the remaining settings
    await c.putSettings(req('OWNER'), { settings: { automation: { 'review.response_draft': 'DRAFT' }, killSwitch: false } });
    expect(evaluateSafety('review.response_draft', { tenant: await store.get('t1') }).automation).toBe('DRAFT');
  });
});

describe('N-4 resolveTenantSafety — what one AI call runs under', () => {
  it('reads the SAVED settings for the call\'s tenant + branch', async () => {
    const store = new InMemoryAiSettingsStore();
    await store.put('t1', { killSwitch: true }, 'u1', 'b1');
    expect((await resolveTenantSafety((t, b) => store.get(t, b), 't1', 'b1', undefined))?.killSwitch).toBe(true);
    expect((await resolveTenantSafety((t, b) => store.get(t, b), 't1', 'b2', undefined))?.killSwitch).toBeUndefined();   // other branch
  });
  it('a caller\'s explicit settings can only tighten what the salon saved, never loosen it', async () => {
    const reader = async () => ({ killSwitch: true, automation: { 'review.response_draft': 'SUGGEST_ONLY' as const } });
    const s = await resolveTenantSafety(reader, 't1', null, { killSwitch: false, automation: { 'review.response_draft': 'DRAFT' } });
    expect(s?.killSwitch).toBe(true);
    expect(s?.automation?.['review.response_draft']).toBe('SUGGEST_ONLY');
  });
  it('with no reader wired it is exactly the caller\'s settings (tests, no-DB dev)', async () => {
    expect(await resolveTenantSafety(undefined, 't1', null, undefined)).toBeUndefined();
    expect(await resolveTenantSafety(undefined, 't1', null, { killSwitch: true })).toEqual({ killSwitch: true });
  });
  it('a failed read is REPORTED (never silent) and the call proceeds under the caller\'s settings', async () => {
    const warnings: string[] = [];
    const s = await resolveTenantSafety(async () => { throw new Error('db down'); }, 't1', null, undefined, (m) => warnings.push(m));
    expect(s).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('db down')]);
  });
});
