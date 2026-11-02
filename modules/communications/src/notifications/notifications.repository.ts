// notifications.repository.ts — port + in-memory adapter (dev/tests). Logs every send attempt.
import type { NotificationLogRow } from './notifications.dto';

/** Facts about a send that go into the event, never into the ledger row (Phase 2). */
/** Customer Notifications guide (741): the branch, what produced the message and the attempt it re-sends — all optional */
export interface SendFacts { purpose?: string; simulated?: boolean; branchId?: string | null; source?: { type: string; id: string } | null; retryOf?: string | null }

export interface NotificationsRepositoryPort {
  log(row: Omit<NotificationLogRow, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, facts?: SendFacts): Promise<NotificationLogRow>;
  listForTenant(tenantId: string, limit: number): Promise<NotificationLogRow[]>;
  /** `tenantId` (security fix E2): when given, only that tenant's message moves — the webhook resolves it from the stored row. */
  /** optional (741): keep a verified non-terminal callback as freshness evidence */
  recordDeliveryEvent?(providerId: string, providerStatus: string, errorCode: string | null, tenantId: string | null): Promise<void>;
  updateDeliveryByProvider(providerId: string, status: 'sent' | 'failed' | 'delivered', failureReason: string | null, deliveredAt: string | null, provider?: DeliveryProviderFacts, tenantId?: string | null): Promise<{ updated: number }>;
  /** wave 3 PAYI §77 / §80: SMS segments this tenant sent in [from, to) — the billable quantity, by purpose-free totals. */
  segmentUsage?(tenantId: string, fromIso: string, toIso: string): Promise<SmsSegmentUsage>;
}
/** wave 3 PAYI §87: what the provider's status callback said (its own status word, error code, segment count). */
export interface DeliveryProviderFacts { providerStatus?: string | null; errorCode?: string | null; segments?: number | null }
export interface SmsSegmentUsage { messages: number; segments: number; delivered: number; failed: number; unknownSegments: number }

export class InMemoryNotificationsRepository implements NotificationsRepositoryPort {
  private rows: NotificationLogRow[] = [];
  private seq = 1000;

  async log(row: Omit<NotificationLogRow, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, _facts?: SendFacts): Promise<NotificationLogRow> {
    const rec: NotificationLogRow = {
      id: row.id || 'ntf_' + ++this.seq,
      createdAt: row.createdAt || new Date().toISOString(),
      tenantId: row.tenantId, channel: row.channel, toAddress: row.toAddress, subject: row.subject ?? null,
      body: row.body, customerId: row.customerId ?? null, status: row.status, providerId: row.providerId ?? null,
      failureReason: row.failureReason ?? null,
    };
    this.rows.unshift(rec);
    return rec;
  }

  async listForTenant(tenantId: string, limit: number): Promise<NotificationLogRow[]> {
    return this.rows.filter((r) => r.tenantId === tenantId).slice(0, Math.max(1, limit));
  }

  async segmentUsage(tenantId: string, fromIso: string, toIso: string): Promise<SmsSegmentUsage> {
    const rows = this.rows.filter((r) => r.tenantId === tenantId && r.channel === 'sms' && r.status !== 'simulated' && r.status !== 'blocked' && r.createdAt >= fromIso && r.createdAt < toIso);
    return { messages: rows.length, segments: rows.reduce((n, r) => n + (r.segmentCount ?? 0), 0), delivered: rows.filter((r) => r.status === 'delivered').length, failed: rows.filter((r) => r.status === 'failed').length, unknownSegments: rows.filter((r) => r.segmentCount == null).length };
  }
  async updateDeliveryByProvider(providerId: string, status: 'sent' | 'failed' | 'delivered', failureReason: string | null, _deliveredAt?: string | null, provider?: DeliveryProviderFacts, tenantId?: string | null): Promise<{ updated: number }> {
    let updated = 0;
    for (const r of this.rows) if (r.providerId === providerId && (!tenantId || r.tenantId === tenantId)) {
      r.status = status; r.failureReason = failureReason; updated++;
      if (provider?.providerStatus) r.providerStatus = provider.providerStatus;
      if (provider?.errorCode) r.providerErrorCode = provider.errorCode;
      if (provider?.segments != null) r.segmentCount = provider.segments;
    }
    return { updated };
  }
}
