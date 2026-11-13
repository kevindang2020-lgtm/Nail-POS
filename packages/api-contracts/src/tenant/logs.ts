// logs.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

export interface LogEntryView {
  id: string; category: string; severity: string; source: string; message: string;
  correlationId: string | null; relatedId: string | null; status: string | null; metadata: unknown; createdIso: string | null;
}

/** Device Integration Logs backlog · 09: the salon's work waiting in the platform's existing retry stores (the job queue and
 *  outbound webhook deliveries) — read-only, no second retry engine. Never a payload; errors are redacted. */
export interface LogRetryItem {
  id: string; store: 'job' | 'webhook'; type: string; state: 'waiting' | 'retrying' | 'running' | 'dead';
  attempt: number; maxAttempts: number; nextAttemptAt: string | null; lagSeconds: number | null; lastError: string | null;
  correlationId: string | null; createdAt: string | null; updatedAt: string | null;
}
export interface LogRetryStoreSummary { waiting: number; retrying: number; running: number; dead: number; oldestDueLagSeconds: number | null }
export interface LogRetryQueueView {
  checkedAt: string; deadWindowDays: number; jobs: LogRetryStoreSummary; webhooks: LogRetryStoreSummary;
  items: LogRetryItem[]; total: number; page: number; pageSize: number; totalPages: number;
}
