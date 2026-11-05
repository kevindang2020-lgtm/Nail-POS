// tenant-warning-dispatch.job.ts — delivers pending tenant_warnings over the channels the admin requested (email/SMS),
// using the platform's existing SendGrid/Twilio senders. Honest semantics: a channel with no configured provider or no
// recipient is 'skipped' (not faked as sent); an error is 'failed'; a real send is 'sent'. Idempotent — only touches
// rows still in 'pending' and flips them to a terminal status, so re-runs never double-send. The senders are passed in
// as real-or-null (null when creds absent), so dev/test/CI without creds honestly record 'skipped'.
import { type EmailSender, type SmsSender } from '@aipowersalon/notifications';
import { resolveDeliveryStatus, warningEmail, warningSmsBody, type ChannelResult } from './tenant-warning-dispatch-core';

export interface PendingWarning {
  id: string; tenantId: string; subject: string; message: string;
  sendEmail: boolean; sendSms: boolean; ownerEmail: string | null; ownerPhone: string | null;
}
export interface TenantWarningDispatchRepo {
  listPending(limit: number): Promise<PendingWarning[]>;
  markStatus(id: string, status: 'sent' | 'skipped' | 'failed' | 'recorded'): Promise<void>;
}
export interface DispatchSummary { processed: number; sent: number; skipped: number; failed: number; }

export class TenantWarningDispatchJob {
  constructor(
    private readonly repo: TenantWarningDispatchRepo,
    private readonly email: EmailSender | null,
    private readonly sms: SmsSender | null,
  ) {}

  async dispatchPending(limit = 50): Promise<DispatchSummary> {
    const rows = await this.repo.listPending(limit);
    const sum: DispatchSummary = { processed: 0, sent: 0, skipped: 0, failed: 0 };
    for (const w of rows) {
      const results: { email?: ChannelResult; sms?: ChannelResult } = {};
      if (w.sendEmail) results.email = await this.deliver('email', w);
      if (w.sendSms) results.sms = await this.deliver('sms', w);
      const status = resolveDeliveryStatus(results);
      await this.repo.markStatus(w.id, status);
      sum.processed++;
      if (status === 'sent') sum.sent++; else if (status === 'failed') sum.failed++; else if (status === 'skipped') sum.skipped++;
    }
    return sum;
  }

  private async deliver(channel: 'email' | 'sms', w: PendingWarning): Promise<ChannelResult> {
    try {
      if (channel === 'email') {
        if (!this.email || !w.ownerEmail) return 'skipped';
        const e = warningEmail(w.subject, w.message);
        await this.email.send(w.ownerEmail, e.subject, e.body);
        return 'sent';
      }
      if (!this.sms || !w.ownerPhone) return 'skipped';
      await this.sms.send(w.ownerPhone, warningSmsBody(w.subject, w.message));
      return 'sent';
    } catch {
      return 'failed';
    }
  }
}

/** Off unless explicitly enabled — keeps dev/test/CI from dispatching. */
export function tenantWarningDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.TENANT_WARNING_DISPATCH_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Pure tick body (unit-tested): dispatch + swallow/log errors so a bad tick never crashes the process. */
export async function warningDispatchTick(
  job: TenantWarningDispatchJob,
  log?: { log: (m: string) => void; error: (m: string) => void },
): Promise<DispatchSummary | null> {
  try {
    const s = await job.dispatchPending();
    if (s.processed) log?.log(`Tenant-warning dispatch: processed=${s.processed} sent=${s.sent} skipped=${s.skipped} failed=${s.failed}`);
    return s;
  } catch (e: any) {
    log?.error(`Tenant-warning dispatch failed: ${e?.message ?? e}`);
    return null;
  }
}

/** In-memory adapter for tests/offline boot (never fabricates rows). */
export class InMemoryTenantWarningDispatchRepo implements TenantWarningDispatchRepo {
  public marked: Record<string, string> = {};
  constructor(public rows: PendingWarning[] = []) {}
  async listPending(limit: number): Promise<PendingWarning[]> { return this.rows.slice(0, limit); }
  async markStatus(id: string, status: string): Promise<void> { this.marked[id] = status; }
}
