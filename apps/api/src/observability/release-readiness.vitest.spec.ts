// release-readiness.vitest.spec — Railway's readiness gate is the API's deployment contract; asserted from the API
// (the build-info kernel moved to @aipowersalon/observability, whose tests do not read this repo's deploy config).
import { describe, it, expect } from 'vitest';

describe('railway.json gates a release on READINESS', () => {
  it('Railway switches traffic only when /health/ready answers — a release that cannot reach the database never goes live', async () => {
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(readFileSync(new URL('../../../../railway.json', import.meta.url), 'utf8'));
    expect(cfg.deploy.healthcheckPath).toBe('/health/ready');
  });
});
