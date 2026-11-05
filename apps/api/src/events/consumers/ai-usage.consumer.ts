// ai-usage.consumer.ts — Constitution 8 §83: the AI operational consumer.
//
// Reuse, not a new store (§211): ai_usage_logs already exists with tokens, integer-cent cost and a status
// vocabulary, and the Super Admin AI-usage screens already read it. This consumer records an AI job's usage
// there when the job reports it as an event, so usage survives a crash between "the model answered" and
// "we wrote the bill" — which, done inline, is exactly the lost-effect §1 describes, and it is billable.
//
// §83's own prohibition shapes the payload: "do not publish raw sensitive prompt/response content by default".
// So the envelope carries provider, model, token COUNTS, cost and status — never a prompt or a completion.
// The consumer additionally refuses to write anything that looks like prompt text, so a future producer that
// ignores the rule fails loudly here rather than persisting it (§225).
import { type EventConsumer, ConsumerError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';

/** §83/§225: keys that must never reach a usage row. Checked at the consumer, not just at the producer. */
export const FORBIDDEN_AI_PAYLOAD_KEYS = ['prompt', 'completion', 'response', 'messages', 'transcript', 'inputText', 'outputText'] as const;

export class AiUsageConsumer implements EventConsumer {
  readonly name = 'ai.usage_ledger';
  readonly eventTypes = [DOMAIN_EVENTS.AI_USAGE_RECORDED, DOMAIN_EVENTS.AI_JOB_FAILED] as const;
  // §44: the ledger row carries the event id, and processed_events stops a redelivery; replaying rebuilds a
  // gap without double-billing. Not REPLAY_SAFE — the row is money-adjacent, so the marker is load-bearing.
  readonly replay = 'REPLAY_SAFE_WITH_IDEMPOTENCY' as const;
  readonly critical = true;        // §158: billable usage gets the longer retry budget

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    if (!e.tenantId) return;
    const p = e.payload ?? {};
    const leaked = FORBIDDEN_AI_PAYLOAD_KEYS.filter((k) => p[k] !== undefined);
    if (leaked.length) throw new ConsumerError('PERMANENT', `ai_payload_forbidden_key:${leaked[0]}`);   // §83

    const failed = e.eventType === DOMAIN_EVENTS.AI_JOB_FAILED;
    await sql`
      INSERT INTO ai_usage_logs (tenant_id, user_id, package_code, action, model_provider, model_name,
                                 input_tokens, output_tokens, total_tokens, cost_estimate_cents, usage_unit,
                                 usage_amount, status, request_id)
      VALUES (${e.tenantId}, ${isUuid(e.actorId) ? e.actorId : null}, ${String(p.packageCode ?? 'unknown')},
              ${String(p.action ?? (failed ? 'failed' : 'invoke'))}, ${p.provider ?? null}, ${p.model ?? null},
              ${int(p.inputTokens)}, ${int(p.outputTokens)}, ${int(p.totalTokens) || int(p.inputTokens) + int(p.outputTokens)},
              ${int(p.costCents)}, ${String(p.usageUnit ?? 'calls')}, ${int(p.usageAmount) || 1},
              ${failed ? 'failed' : 'success'}, ${e.eventId})
    `.execute(trx);
  }
}

const int = (v: unknown) => Math.max(0, Math.trunc(Number(v ?? 0) || 0));
const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
