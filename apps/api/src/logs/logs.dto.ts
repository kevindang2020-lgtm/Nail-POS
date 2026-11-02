// logs.dto.ts — context, log entry input/view, and the LogSink interface that producer modules depend on (by type
// only, so there is no runtime module cycle — the concrete LogsService is injected via DI).
import type { LogCategory, LogSeverity } from './logs-core';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { LogEntryView } from '@aipowersalon/api-contracts/tenant';


export interface LogsContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }

export interface LogWriteCtx { tenantId: string; branchId?: string | null; userId?: string }
export interface LogEntryInput {
  category: LogCategory; severity: LogSeverity; source: string; message: string;
  correlationId?: string; relatedId?: string; status?: string; metadata?: Record<string, unknown>;
}
export interface LogSink { write(ctx: LogWriteCtx, entry: LogEntryInput): Promise<void> }

