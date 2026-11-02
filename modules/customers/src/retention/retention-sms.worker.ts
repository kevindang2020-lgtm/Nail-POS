// retention-sms.worker.ts — Customer Retention mandate (Oct 29 2026) §11: the `retention.sms.send` job — ONE recipient,
// ONE text, through the salon's sender (TenantMessenger: the tenant's own Twilio account, else the shared sender with the
// salon's number; opt-out, credits and the notifications ledger are enforced there).
//
// Exactly-once rules (a job can run twice — a retry, a reaped lease):
//   • only a 'queued' recipient is sent; anything else returns immediately (idempotent);
//   • the row moves queued → submitting and COMMITS before the provider call; a job that finds 'submitting' means a
//     previous run may have reached the provider, so it becomes 'unknown' and is NEVER re-sent (spec §11 / §15);
//   • consent, opt-out and phone are checked again here, from the database, at send time.
// Delivery (delivered / undelivered) is not written here: the signed Twilio status callback updates the notifications
// ledger row, and the campaign report reads it through provider_id — one source, never double counted.
import { sql, type Kysely } from 'kysely';
import { registerJobHandler, jobHandlerFor, PermanentJobError, tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { logException } from '@aipowersalon/observability';
import { RETENTION_SMS_CAMPAIGN, RETENTION_SMS_RECIPIENT } from '../customer-lifecycles';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { withCode } from '@aipowersalon/api-contracts';
import { RETENTION_SMS_JOB } from './retention-sms.service';

export async function runRetentionSmsJob(db: Kysely<any>, messenger: TenantMessenger | null, payload: Record<string, unknown>): Promise<{ outcome: string }> {
  const tenantId = String(payload.tenantId ?? ''), recipientId = String(payload.recipientId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(recipientId)) throw withCode(new PermanentJobError('bad retention sms payload'), 'VALIDATION_FAILED');
  const tz = await tenantTimeZone(db, tenantId).catch(() => 'America/New_York');   // "upcoming booking" is a salon-local date
  // 1. claim: queued → submitting (or submitting → unknown), committed before anything leaves the building
  const claim = await db.transaction().execute(async (trx) => {
    const r = (await sql<any>`select r.id, r.status, r.customer_id, r.destination, r.campaign_id, c.body, c.status as campaign_status
      from retention_sms_recipients r join retention_sms_campaigns c on c.id = r.campaign_id and c.tenant_id = r.tenant_id
      where r.tenant_id = ${tenantId} and r.id = ${recipientId} for update of r`.execute(trx)).rows[0];
    if (!r) return { skip: 'gone' as const };
    if (r.status === 'submitting') {
      await sql`update retention_sms_recipients set status = 'unknown', error = 'interrupted after hand-off; not re-sent', updated_at = now() where tenant_id = ${tenantId} and id = ${recipientId} and ${canMoveToSql(RETENTION_SMS_RECIPIENT, 'unknown')}`.execute(trx);
      return { skip: 'unknown' as const, campaignId: String(r.campaign_id) };
    }
    if (r.status !== 'queued') return { skip: 'done' as const };
    if (r.campaign_status === 'canceled') { await sql`update retention_sms_recipients set status = 'blocked', error = 'campaign_canceled', updated_at = now() where tenant_id = ${tenantId} and id = ${recipientId} and ${canMoveToSql(RETENTION_SMS_RECIPIENT, 'blocked')}`.execute(trx); return { skip: 'canceled' as const, campaignId: String(r.campaign_id) }; }
    // 2. send-time revalidation (the customer may have opted out / withdrawn consent since the confirmation)
    const v = (await sql<any>`select c.status, c.normalized_phone, coalesce(c.marketing_sms_opt_in, false) as consent,
        exists (select 1 from notification_opt_outs o where o.tenant_id = ${tenantId} and o.channel = 'sms' and regexp_replace(o.address, '\\D', '', 'g') = regexp_replace(c.normalized_phone, '\\D', '', 'g')) as opted_out,
        exists (select 1 from pos_tech_appointments a where a.tenant_id = ${tenantId} and a.customer_id = c.id and a.appt_date >= (now() at time zone ${tz})::date
                and a.status in ('booked', 'confirmed', 'arrived', 'checked_in', 'waiting')) as booked,
        -- Win-Back guide §16 release blocker: still a customer with ≥ 1 completed visit at SEND time (a void / removal since the
        -- confirmation can leave a zero-visit customer queued — never a "we miss you" text to someone who never visited)
        exists (select 1 from tickets t where t.tenant_id = ${tenantId} and t.customer_id = c.id and t.removed_at is null and t.status in ('closed', 'paid')) as visited
      from customers c where c.tenant_id = ${tenantId} and c.id = ${r.customer_id}`.execute(trx)).rows[0];
    const why = !v || v.status === 'archived' ? 'not_found' : !v.visited ? 'never_visited' : !v.consent ? 'no_consent' : v.opted_out ? 'opted_out' : v.booked ? 'upcoming_booking' : v.normalized_phone !== r.destination ? 'phone_changed' : null;
    if (why) { await sql`update retention_sms_recipients set status = 'blocked', error = ${why}, updated_at = now() where tenant_id = ${tenantId} and id = ${recipientId} and ${canMoveToSql(RETENTION_SMS_RECIPIENT, 'blocked')}`.execute(trx); return { skip: 'blocked' as const, campaignId: String(r.campaign_id) }; }
    await sql`update retention_sms_recipients set status = 'submitting', submitted_at = now(), updated_at = now() where tenant_id = ${tenantId} and id = ${recipientId} and ${canMoveToSql(RETENTION_SMS_RECIPIENT, 'submitting')}`.execute(trx);
    await sql`update retention_sms_campaigns set status = 'sending', updated_at = now() where tenant_id = ${tenantId} and id = ${r.campaign_id} and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'sending')}`.execute(trx);
    return { send: true as const, to: String(r.destination), body: String(r.body), customerId: String(r.customer_id), campaignId: String(r.campaign_id) };
  });
  if (!('send' in claim)) { if ('campaignId' in claim && claim.campaignId) await finishCampaign(db, tenantId, claim.campaignId); return { outcome: claim.skip }; }

  // 3. the ONE provider call
  let status: 'sent' | 'blocked' | 'failed'; let providerId: string | null = null; let error: string | null = null;
  if (!messenger) { status = 'blocked'; error = 'not_configured'; }
  else {
    try {
      const res = await messenger.sendSms({ tenantId, to: claim.to, body: claim.body, purpose: 'marketing', customerId: claim.customerId, meter: true });
      status = res.sent ? 'sent' : res.status === 'blocked' ? 'blocked' : 'failed';
      providerId = res.providerId ?? null; error = res.sent ? null : (res.reason ?? res.status);
    } catch (e: any) { status = 'failed'; error = String(e?.message ?? 'send_failed').slice(0, 200); }   // the messenger records its own failures; never retried (could double-send)
  }
  const notif = providerId ? (await sql<any>`select id from notifications where tenant_id = ${tenantId} and provider_id = ${providerId} order by created_at desc limit 1`.execute(db)).rows[0] : null;
  const recorded = (await sql<{ id: string }>`update retention_sms_recipients set status = ${status}, provider_id = ${providerId}, notification_id = ${notif?.id ?? null}, error = ${error},
      sent_at = case when ${status} = 'sent' then now() else sent_at end, updated_at = now() where tenant_id = ${tenantId} and id = ${recipientId} and ${canMoveToSql(RETENTION_SMS_RECIPIENT, status)}
      returning id`.execute(db)).rows[0];
  // the claim committed 'submitting'; only a concurrent run (which then marked it 'unknown') can make this miss — the
  // provider outcome is still in the notifications ledger, and the recipient is never re-sent either way
  if (!recorded) logException(new Error(`retention sms outcome '${status}' not recorded: recipient ${recipientId} is no longer submitting`), { where: 'retention-sms.worker.record', tenantId });
  await finishCampaign(db, tenantId, claim.campaignId);
  return { outcome: status };
}

/** A campaign is completed when nobody is left queued / submitting: completed if every queued text went, else partial. */
async function finishCampaign(db: Kysely<any>, tenantId: string, campaignId: string) {
  await sql`update retention_sms_campaigns c set status = case when x.bad = 0 then 'completed' when x.ok = 0 then 'failed' else 'partial' end, completed_at = now(), updated_at = now()
    from (select count(*) filter (where status in ('queued', 'submitting')) as open, count(*) filter (where status = 'sent') as ok,
                 count(*) filter (where status in ('blocked', 'failed', 'unknown')) as bad
          from retention_sms_recipients where tenant_id = ${tenantId} and campaign_id = ${campaignId}) x
    where c.id = ${campaignId} and c.tenant_id = ${tenantId} and x.open = 0
      and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'completed', 'c')} and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'partial', 'c')} and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'failed', 'c')}`.execute(db);
}

/** Registered once per process (onModuleInit of CustomersModule's provider). */
export class RetentionSmsWorker {
  constructor(private readonly db: Kysely<any> | null, private readonly messenger: TenantMessenger | null) {}
  onModuleInit() {
    if (!this.db || jobHandlerFor(RETENTION_SMS_JOB)) return;
    const db = this.db, messenger = this.messenger;
    registerJobHandler(RETENTION_SMS_JOB, (payload) => runRetentionSmsJob(db, messenger, payload));
  }
}
