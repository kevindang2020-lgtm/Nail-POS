// deposit-reconciliation.explain.usage.ts — persists AI-explanation usage into the EXISTING ai_usage_logs table
// (reused, not duplicated). In-memory adapter for tests.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface ExplainUsageEntry {
  tenantId: string; provider: string; model: string;
  inputTokens: number; outputTokens: number; costCents: number;
  status: 'success' | 'provider_error';
}

export interface ExplainUsageLogger { log(e: ExplainUsageEntry): Promise<void> }

export class InMemoryExplainUsageLogger implements ExplainUsageLogger {
  entries: ExplainUsageEntry[] = [];
  async log(e: ExplainUsageEntry): Promise<void> { this.entries.push(e); }
}

export class KyselyExplainUsageLogger implements ExplainUsageLogger {
  constructor(private readonly db: Kysely<DB>) {}
  async log(e: ExplainUsageEntry): Promise<void> {
    await sql`
      INSERT INTO ai_usage_logs (tenant_id, package_code, model_provider, model_name, input_tokens, output_tokens, total_tokens, cost_estimate_cents, status)
      VALUES (${e.tenantId}, ${'deposit_reconciliation'}, ${e.provider}, ${e.model}, ${e.inputTokens}, ${e.outputTokens}, ${e.inputTokens + e.outputTokens}, ${Math.round(e.costCents)}, ${e.status})
    `.execute(this.db).catch(() => undefined);
  }
}
