// ai-usage.pgtest — §83 on real Postgres. The prompt-leak refusal is the point: a consumer that would happily
// persist a prompt makes the producer's discipline the only thing standing between a customer's words and the
// usage ledger, and §83 says not to rely on that.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, validateDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { AiUsageConsumer } from './ai-usage.consumer';

const T = '11111111-1111-1111-1111-111111111111';
const USER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
let db: any; let publisher: OutboxPublisher; let runner: ConsumerRunner; let consumer: AiUsageConsumer;
const rows = async () => (await sql`SELECT package_code, model_provider, model_name, input_tokens, output_tokens, total_tokens, cost_estimate_cents, status, request_id, user_id FROM ai_usage_logs WHERE tenant_id = ${T} ORDER BY created_at`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg); consumer = new AiUsageConsumer();
  const registry = new ConsumerRegistry(); registry.register(consumer);
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
}, 60_000);

const usage = (payload: any) => createDomainEvent({
  eventType: DOMAIN_EVENTS.AI_USAGE_RECORDED, tenantId: T, aggregateType: 'ai_job', aggregateId: 'job-1',
  actorId: USER, actorType: 'ai', payload,
});

describe('§83 — AI usage recorded as a durable fact, never the prompt', () => {
  it('a completed job lands in the EXISTING ai_usage_logs with tokens, integer-cent cost and the event id', async () => {
    const e = usage({ packageCode: 'ai_business', provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 1200, outputTokens: 340, costCents: 7, usageUnit: 'calls', usageAmount: 1 });
    await new OutboxWriter().write(db, e);
    await publisher.tick();
    const r = await rows();
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ package_code: 'ai_business', model_provider: 'anthropic', model_name: 'claude-sonnet-4-6',
      input_tokens: 1200, output_tokens: 340, total_tokens: 1540, cost_estimate_cents: 7, status: 'success', request_id: e.eventId, user_id: USER });
  });

  it('a failed job is recorded as failed — usage that cost money is not lost because the job errored', async () => {
    await new OutboxWriter().write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.AI_JOB_FAILED, tenantId: T, aggregateType: 'ai_job', aggregateId: 'job-2',
      actorType: 'ai', payload: { packageCode: 'ai_business', provider: 'anthropic', inputTokens: 900, costCents: 3 } }));
    await publisher.tick();
    const r = await rows();
    expect(r.length).toBe(2);
    expect(r[1]).toMatchObject({ status: 'failed', input_tokens: 900, cost_estimate_cents: 3 });
  });

  it('§83 a payload carrying prompt or response text is REFUSED — the consumer does not trust the producer', async () => {
    const leaky = usage({ packageCode: 'ai_business', provider: 'anthropic', inputTokens: 10, prompt: 'the customer said her nails keep chipping' });
    const out = await runner.run(consumer, leaky);
    expect(out.status).toBe('dead_lettered');
    if (out.status === 'dead_lettered') {
      expect(out.errorClass).toBe('PERMANENT');                    // a leak is a bug to fix, never a retry
      expect(out.code).toContain('ai_payload_forbidden_key:prompt');
    }
    expect((await rows()).length).toBe(2);                          // nothing persisted
  });

  it('the envelope validator independently rejects a prompt-bearing event before it is even written', () => {
    const e = usage({ packageCode: 'x', response: 'here is what I suggest' });
    expect(validateDomainEvent({ ...e, payload: { ...e.payload, apiKey: 'sk-live-123' } })).toContain('forbidden_payload_key:apiKey');
  });

  it('§23 redelivery does not double-bill', async () => {
    const e = usage({ packageCode: 'ai_business', inputTokens: 50, costCents: 1 });
    await new OutboxWriter().write(db, e);
    await publisher.tick();
    const n = (await rows()).length;
    expect((await runner.run(consumer, e)).status).toBe('duplicate');
    expect((await rows()).length).toBe(n);
  });
});
