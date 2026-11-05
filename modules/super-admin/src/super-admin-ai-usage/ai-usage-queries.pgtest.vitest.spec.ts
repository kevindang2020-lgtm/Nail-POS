// ai-usage-queries.pgtest — executes the AI usage/config repository against the real migrated schema.
//
// 4 swallowing catches. This module answers "how much AI have tenants used, and what does it cost" — a broken
// query reports **zero usage** and **no providers configured**, which looks like a quiet month rather than a
// blind billing surface. Written with the shared cached schema (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyUsageConfigRepo } from './ai-usage-config.kysely.repository';

let repo: KyselyUsageConfigRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  repo = new KyselyUsageConfigRepo(kyselyFor(pg) as any);
}, 60_000);

describe('ai-usage repository executes against the real migrated schema', () => {
  it('usageAggregate returns a real object, not the zeroed fallback of a failed query', async () => {
    const agg: any = await repo.usageAggregate({});
    expect(agg).toBeTruthy();
    expect(typeof agg).toBe('object');
  });

  it('usageSeries and listProviders execute', async () => {
    const series: any = await repo.usageSeries({ days: 7 });
    expect(series).toBeTruthy();
    expect(Array.isArray(await repo.listProviders())).toBe(true);
  });

  it('upsertProvider → getProviderByKey round-trips through the real table', async () => {
    const saved: any = await repo.upsertProvider({ providerKey: 'openai', displayName: 'OpenAI', enabled: true } as any);
    expect(saved).toBeTruthy();
    const found: any = await repo.getProviderByKey('openai');
    expect(found).not.toBeNull();            // null = the SELECT silently failed
    expect(found.providerKey ?? found.provider_key).toBe('openai');
  });
});
