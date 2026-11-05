import { describe, it, expect } from 'vitest';
import { resolveEffectiveLimit, evaluateLimit, resolveEffectiveFeature } from './entitlements-core';

describe('resolveEffectiveLimit', () => {
  it('override beats plan default', () => {
    const e = resolveEffectiveLimit(2500, { limitValue: 1, enforcement: 'hard' });
    expect(e).toMatchObject({ value: 1, source: 'override', configured: true });
  });
  it('falls back to plan default, then to unconfigured', () => {
    expect(resolveEffectiveLimit(2500, null)).toMatchObject({ value: 2500, source: 'plan', configured: true });
    expect(resolveEffectiveLimit(null, null)).toMatchObject({ value: null, source: 'plan', configured: true }); // plan grants unlimited
    expect(resolveEffectiveLimit(undefined, null)).toMatchObject({ source: 'none', configured: false });
  });
});

describe('evaluateLimit (hard/soft)', () => {
  it('hard limit blocks creation at/over the cap; soft allows + flags overage', () => {
    const hard = resolveEffectiveLimit(2, { limitValue: 2, enforcement: 'hard' });
    expect(evaluateLimit(hard, 2)).toMatchObject({ allowed: false, atLimit: true, status: 'blocked' });
    expect(evaluateLimit(hard, 1)).toMatchObject({ allowed: true, atLimit: false });
    const soft = resolveEffectiveLimit(2, { limitValue: 2, enforcement: 'soft' });
    expect(evaluateLimit(soft, 3)).toMatchObject({ allowed: true, atLimit: true, over: 1, status: 'overage' });
  });
  it('unlimited and unconfigured always allow; thresholds drive advisory/warning', () => {
    expect(evaluateLimit(resolveEffectiveLimit(null, null), 9999)).toMatchObject({ allowed: true, status: 'unlimited' });
    expect(evaluateLimit(resolveEffectiveLimit(undefined, null), 5)).toMatchObject({ allowed: true, status: 'unconfigured' });
    const eff = resolveEffectiveLimit(100, null);
    expect(evaluateLimit(eff, 50).status).toBe('ok');
    expect(evaluateLimit(eff, 80).status).toBe('advisory');
    expect(evaluateLimit(eff, 95).status).toBe('warning');
  });
});

describe('resolveEffectiveFeature', () => {
  it('override enables/disables; otherwise plan "enabled" state wins', () => {
    expect(resolveEffectiveFeature('unavailable', 'enabled')).toMatchObject({ enabled: true, source: 'override' });
    expect(resolveEffectiveFeature('enabled', 'disabled')).toMatchObject({ enabled: false, blocked: true });
    expect(resolveEffectiveFeature('enabled', null)).toMatchObject({ enabled: true, source: 'plan' });
    expect(resolveEffectiveFeature('available', null)).toMatchObject({ enabled: false, source: 'plan' });
    expect(resolveEffectiveFeature(undefined, null)).toMatchObject({ enabled: false });
  });
});
