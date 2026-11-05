// logs.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

export interface LogEntryView {
  id: string; category: string; severity: string; source: string; message: string;
  correlationId: string | null; relatedId: string | null; status: string | null; metadata: unknown; createdIso: string | null;
}
