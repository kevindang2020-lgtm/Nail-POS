// key-fallback-reporter.vitest.spec — §41: a derived or constant key in use is recorded as a CRITICAL security event.
// The wiring moved out of SecurityEvents' constructor (so the recorder can leave the API without importing the key
// ring); this proves the API still wires it.
import { describe, it, expect, afterEach } from 'vitest';
import { KeyFallbackReporter, SecurityEventsModule } from './security-events.module';
import { keyFor, onKeyFallback, _resetFallbackReports } from './key-ring';

afterEach(() => { onKeyFallback(null); _resetFallbackReports(); });

describe('KeyFallbackReporter', () => {
  it('a key-ring fallback becomes a KEY_FALLBACK_IN_USE event', () => {
    const recorded: any[] = [];
    new KeyFallbackReporter({ record: async (e: any) => { recorded.push(e); return true; } } as any);
    _resetFallbackReports();
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;   // no PROVIDER_VAULT_KEK -> the dev fallback
    keyFor('provider', env);
    expect(recorded.map((e) => e.type)).toContain('KEY_FALLBACK_IN_USE');
    expect(recorded[0].resourceId).toBe('provider');
  });
  it('is provided by the global SecurityEventsModule', () => {
    const providers = Reflect.getMetadata('providers', SecurityEventsModule) as any[];
    expect(providers.some((p) => p?.provide === KeyFallbackReporter)).toBe(true);
  });
});
