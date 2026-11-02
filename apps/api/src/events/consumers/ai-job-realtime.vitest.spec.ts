// ai-job-realtime.vitest.spec — Constitution 10 §164: AI job progress/completion reaching a client.
import { describe, it, expect } from 'vitest';
import { RealtimeProjectionConsumer } from './realtime-projection.consumer';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS, EVENT_VERSIONS, FORBIDDEN_PAYLOAD_KEYS, payloadViolations } from '@aipowersalon/realtime-contracts';

function harness() {
  const sent: Array<{ event: string; payload: any }> = [];
  const emitter = { toTenant: (_c: any, event: any, payload: any) => { sent.push({ event, payload }); } };
  return { sent, consumer: new RealtimeProjectionConsumer(emitter as never) };
}

// The contract field is `eventType`, not `type` — a fixture using the wrong name projects nothing and every
// assertion fails at once, which is how this was caught.
const ev = (eventType: string, payload: Record<string, unknown>) => ({
  eventType, aggregateId: 'agg-1', tenantId: 'tn-1', branchId: 'br-1', payload,
}) as never;

describe('§164: the two client events exist in the registry', () => {
  it('both are registered names, not strings invented at the emit site', () => {
    expect(EVENTS.aiJobProgress).toBe('ai_job_progress');
    expect(EVENTS.aiJobCompleted).toBe('ai_job_completed');
  });

  it('both carry a version — an unversioned event breaks the client contract', () => {
    expect(EVENT_VERSIONS.ai_job_progress).toBe(1);
    expect(EVENT_VERSIONS.ai_job_completed).toBe(1);
  });
});

describe('§164: what reaches a client, and what does not', () => {
  it('a completed job tells the client which request finished', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_COMPLETED, { requestId: 'rq-9', taskKey: 'followups.draft', status: 'SUCCESS', output: 'Hi Jane, ...' }));
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe('ai_job_completed');
    expect(sent[0].payload.requestId).toBe('rq-9');
  });

  it('THE RULE: the AI OUTPUT never crosses the wire — the result stays server-side', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_COMPLETED, { requestId: 'rq-9', taskKey: 't', status: 'SUCCESS', output: 'Hi Jane, your appointment', prompt: 'system prompt', confidence: 0.9 }));
    const json = JSON.stringify(sent[0].payload);
    expect(json).not.toMatch(/Hi Jane/);
    expect(json).not.toMatch(/system prompt/);
    expect(sent[0].payload.output).toBeUndefined();
    expect(sent[0].payload.prompt).toBeUndefined();
  });

  it('a FAILED job still completes the client — a spinner that never resolves is the worst outcome', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_FAILED, { requestId: 'rq-3', taskKey: 't', reason: 'FAILED_VALIDATION' }));
    expect(sent[0].event).toBe('ai_job_completed');
    expect(sent[0].payload.status).toBe('FAILED');
  });

  it('a started job is progress, not completion', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_STARTED, { requestId: 'rq-4', taskKey: 't' }));
    expect(sent[0].event).toBe('ai_job_progress');
    expect(sent[0].payload.phase).toBe('started');
  });

  it('ai.job_requested is NOT broadcast — internal bookkeeping is not a client event (§225)', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_REQUESTED, { requestId: 'rq-5', taskKey: 't' }));
    expect(sent).toHaveLength(0);
  });

  it('no payload trips the forbidden-keys guard', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_COMPLETED, { requestId: 'rq-6', taskKey: 't', status: 'SUCCESS' }));
    expect(payloadViolations(sent[0].payload)).toEqual([]);
    expect(FORBIDDEN_PAYLOAD_KEYS.length).toBeGreaterThan(0);   // the guard is real, not an empty list
  });

  it('a missing requestId falls back to the aggregate id rather than sending null', async () => {
    const { sent, consumer } = harness();
    await consumer.handle(ev(DOMAIN_EVENTS.AI_JOB_COMPLETED, { taskKey: 't', status: 'SUCCESS' }));
    expect(sent[0].payload.requestId).toBe('agg-1');
  });
});
