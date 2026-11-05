// retention-sms.service.ts — Customer Retention mandate (Oct 29 2026) §09–§12: select → preview → confirm → queue →
// results. One confirmed batch; every eligible customer gets their OWN text with the same approved body (never a group
// thread). Nothing is sent from the request thread: confirming writes one `retention.sms.send` job per recipient (the
// durable job queue, idempotency key = recipient id) in the same transaction that queues the recipients.
//
// Safety, in order: the tenant is the session's; customer ids are verdicted against this salon only (another salon's id
// is "not_found"); consent / opt-out / phone / recent-contact are checked at preview, AGAIN at confirm (an audience that
// shrank asks for a second confirmation) and AGAIN by the worker just before the provider call; a confirmation replayed
// with the same idempotency key returns the first campaign; a draft expires after 20 minutes; quiet hours defer the
// first send; sends are spread at SENDS_PER_MINUTE.
import { sql, type Kysely } from 'kysely';
import { enqueueJob, canMoveToSql } from '@aipowersalon/database';
import { RETENTION_SMS_CAMPAIGN, RETENTION_SMS_RECIPIENT } from '../customer-lifecycles';
import { logException } from '@aipowersalon/observability';
import type { AuditRecorder } from '../loyalty/loyalty-program.repository';
import { RetentionPricingRepository, estimateSms } from './retention-pricing';
import { RetentionRepository, RetentionError, composeRetentionSms, smsSegments, isUuid, MAX_SELECTION, SENDS_PER_MINUTE, type RetentionContext, type ListFilters } from './retention.repository';

export const RETENTION_SMS_JOB = 'retention.sms.send';

/** `selection` = the list's filters as they are now (segment, search, period + date basis, priority band, SMS, visits) — the
 *  server resolves "Select all matching" itself, then snapshots the audience into the 20-minute draft (spec §10) */
export interface PreviewInput { customerIds?: string[]; selection?: ListFilters & { excludeIds?: string[] }; body: string; label?: string }

export class RetentionSmsService {
  private readonly pricing: RetentionPricingRepository;
  constructor(private readonly db: Kysely<any>, private readonly repo: RetentionRepository, private readonly auditor: AuditRecorder | null = null) { this.pricing = new RetentionPricingRepository(db); }

  private async salonName(ctx: RetentionContext): Promise<string | null> {
    if (ctx.salonName) return ctx.salonName;
    const r = (await sql<any>`select coalesce(display_name, legal_name) as n from tenants where id = ${ctx.tenantId}`.execute(this.db)).rows[0];
    return r?.n ? String(r.n) : null;
  }

  async preview(ctx: RetentionContext, input: PreviewInput) {
    const raw = String(input.body ?? '').trim();
    if (raw.length < 5) throw new RetentionError('Write the message (at least 5 characters).', 'SMS_BODY_INVALID');
    // C5 audit (Nov 4 2026): a campaign sends the SAME text to everyone — a template placeholder ({first_name}, {{booking_link}})
    // would go out literally, so it is refused until it is replaced with real words
    if (/\{\{?\s*[a-z_][a-z0-9_.]*\s*\}?\}/i.test(raw)) throw new RetentionError('Replace the {placeholders} with real words — a campaign sends the same text to every customer.', 'SMS_BODY_INVALID');
    const body = composeRetentionSms(raw, await this.salonName(ctx));
    if (body.length > 640) throw new RetentionError('The message is too long (640 characters at most, including the salon name and STOP line).', 'SMS_BODY_INVALID');
    let ids: string[]; let audience: Record<string, unknown>;
    if (input.selection) {
      const exclude = new Set((input.selection.excludeIds ?? []).filter(isUuid));
      ids = (await this.repo.matchingIds(ctx, input.selection)).filter((id) => !exclude.has(id));
      const { excludeIds: _x, ...flt } = input.selection; void _x;
      audience = { mode: 'all_matching', segment: input.selection.segment ?? 'at_risk', q: input.selection.q ?? null, excluded: exclude.size,
        filters: Object.fromEntries(Object.entries(flt).filter(([kk, v]) => kk !== 'segment' && kk !== 'q' && v != null && v !== '')) };
    } else {
      ids = [...new Set((input.customerIds ?? []).map(String))];
      audience = { mode: 'selected', count: ids.length };
    }
    if (!ids.length) throw new RetentionError('Select at least one customer.', 'SMS_NO_RECIPIENTS');
    if (ids.length > MAX_SELECTION) throw new RetentionError(`Select at most ${MAX_SELECTION} customers per campaign.`, 'SMS_SELECTION_TOO_LARGE');
    const verdicts = await this.repo.verdicts(this.db, ctx, ids);
    // one text per destination: a second profile with the same phone is excluded (the first selected wins)
    const seen = new Set<string>();
    const list = ids.map((id) => {
      const v = verdicts.get(id)!; let status = v.status;
      if (status === 'eligible' && v.phone) { if (seen.has(v.phone)) status = 'duplicate_destination'; else seen.add(v.phone); }
      return { customerId: id, status, destination: v.phone };
    }).filter((v) => isUuid(v.customerId));
    const seg = smsSegments(body);
    const campaignId = await this.repo.createDraft(ctx, { body, segments: seg.segments, audience, verdicts: list });
    const sender = await this.repo.sender(ctx);
    const quiet = await this.repo.quietUntil(ctx);
    const excluded: Record<string, number> = {};
    for (const v of list) if (v.status !== 'eligible') excluded[v.status] = (excluded[v.status] || 0) + 1;
    const eligible = list.filter((v) => v.status === 'eligible').length;
    // CR-03: the estimate counts ONLY eligible recipients (opted-out, duplicate phones, no consent … are excluded above);
    // no tenant price in force → status 'price_unknown' and costEstimateCents null (never $0)
    const estimate = estimateSms({ recipients: eligible, segmentsPerMessage: seg.segments, encoding: seg.encoding }, await this.pricing.pricingAt(ctx));
    return {
      previewId: campaignId, finalBody: body, segments: seg, selected: list.length, eligible, excluded: list.length - eligible, excludedReasons: excluded,
      sender, canSend: eligible > 0 && sender.route !== 'not_configured',
      blockedReason: sender.route === 'not_configured' ? 'SMS_NOT_CONFIGURED' : eligible === 0 ? 'SMS_NO_ELIGIBLE' : null,
      quietHours: quiet.until ? { deferredUntil: quiet.until.toISOString(), start: quiet.start, end: quiet.end } : null,
      estimatedSegments: eligible * seg.segments, costEstimateCents: estimate.totalCents, estimate,
      roster: await this.repo.draftRoster(ctx, campaignId, 100),
      expiresInMinutes: 20,
    };
  }

  /** Confirm a preview: revalidate, queue, enqueue — one transaction. Same idempotency key → the same campaign. */
  async confirm(ctx: RetentionContext, b: { previewId: string; idempotencyKey: string; acceptChanges?: boolean; label?: string }) {
    if (!isUuid(b.idempotencyKey)) throw new RetentionError('A request id is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (!isUuid(b.previewId)) throw new RetentionError('That preview was not found.', 'SMS_PREVIEW_NOT_FOUND', 404);
    const prior = (await sql<any>`select id from retention_sms_campaigns where tenant_id = ${ctx.tenantId} and idempotency_key = ${b.idempotencyKey}`.execute(this.db)).rows[0];
    if (prior) return { campaignId: String(prior.id), duplicate: true, ...(await this.counts(ctx.tenantId, String(prior.id))) };
    const sender = await this.repo.sender(ctx);
    if (sender.route === 'not_configured') throw new RetentionError('Text messaging is not set up for this salon.', 'SMS_NOT_CONFIGURED', 503);
    const quiet = await this.repo.quietUntil(ctx);
    const result = await this.db.transaction().execute(async (trx) => {
      const c = (await sql<any>`select id, status, expires_at > now() as fresh from retention_sms_campaigns where tenant_id = ${ctx.tenantId} and id = ${b.previewId} for update`.execute(trx)).rows[0];
      if (!c) throw new RetentionError('That preview was not found.', 'SMS_PREVIEW_NOT_FOUND', 404);
      if (c.status !== 'draft') {
        // confirmed already (another tap / another terminal with a different key): the campaign as it is
        return { campaignId: String(c.id), duplicate: true };
      }
      if (!c.fresh) { await sql`update retention_sms_campaigns set status = 'expired', updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${b.previewId} and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'expired')}`.execute(trx); throw new RetentionError('The preview expired. Preview again.', 'SMS_PREVIEW_EXPIRED', 409); }
      const recips = (await sql<any>`select id, customer_id, destination, eligibility from retention_sms_recipients where tenant_id = ${ctx.tenantId} and campaign_id = ${b.previewId} for update`.execute(trx)).rows;
      const eligibleBefore = recips.filter((r: any) => r.eligibility === 'eligible');
      const now = await this.repo.verdicts(trx, ctx, eligibleBefore.map((r: any) => String(r.customer_id)));
      const changed = eligibleBefore.filter((r: any) => { const v = now.get(String(r.customer_id)); return !v || v.status !== 'eligible' || v.phone !== r.destination; });
      if (changed.length && !b.acceptChanges) {
        const reasons: Record<string, number> = {};
        for (const r of changed) { const k = now.get(String(r.customer_id))?.status ?? 'not_found'; reasons[k === 'eligible' ? 'phone_changed' : k] = (reasons[k === 'eligible' ? 'phone_changed' : k] || 0) + 1; }
        throw new RetentionError(`${changed.length} recipient(s) are no longer eligible since the preview. Review and confirm again.`, 'SMS_AUDIENCE_CHANGED', 409,
          { noLongerEligible: changed.length, reasons, stillEligible: eligibleBefore.length - changed.length });
      }
      for (const r of changed) {
        const v = now.get(String(r.customer_id)); const why = !v ? 'not_found' : v.status === 'eligible' ? 'not_found' : v.status;
        await sql`update retention_sms_recipients set eligibility = ${why}, updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${r.id}`.execute(trx);
      }
      const go = eligibleBefore.filter((r: any) => !changed.includes(r));
      if (!go.length) throw new RetentionError('Nobody in this preview can be texted now.', 'SMS_NO_ELIGIBLE', 409);
      const start = quiet.until ?? new Date();
      let i = 0;
      for (const r of go) {
        const runAfter = new Date(start.getTime() + Math.floor(i / SENDS_PER_MINUTE) * 60_000); i++;
        await sql`update retention_sms_recipients set status = 'queued', queued_at = now(), updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${r.id} and ${canMoveToSql(RETENTION_SMS_RECIPIENT, 'queued')}`.execute(trx);
        await enqueueJob(trx, { jobClass: 'standard', jobType: RETENTION_SMS_JOB, tenantId: ctx.tenantId, payload: { tenantId: ctx.tenantId, recipientId: String(r.id), campaignId: b.previewId },
          idempotencyKey: String(r.id), runAfter, maxAttempts: 3, createdBy: isUuid(ctx.userId) ? ctx.userId : null });
      }
      await sql`update retention_sms_campaigns set status = 'queued', confirmed_by_user_id = ${isUuid(ctx.userId) ? ctx.userId : null}, confirmed_at = now(), idempotency_key = ${b.idempotencyKey},
          queued_count = ${go.length}, eligible_count = ${go.length}, excluded_count = selected_count - ${go.length}, sender_from = ${sender.from}, label = coalesce(${b.label ?? null}, label), updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${b.previewId} and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'queued')}`.execute(trx);
      return { campaignId: b.previewId, duplicate: false, deferredUntil: quiet.until?.toISOString() ?? null, queued: go.length, changed: changed.length };
    });
    if ('queued' in result) {
      await this.audit(ctx, result.campaignId, { queued: result.queued, changedSincePreview: result.changed, deferredUntil: result.deferredUntil, senderRoute: sender.route });
      return { campaignId: result.campaignId, duplicate: false, deferredUntil: result.deferredUntil, ...(await this.counts(ctx.tenantId, result.campaignId)) };
    }
    return { ...result, ...(await this.counts(ctx.tenantId, result.campaignId)) };
  }

  /** Who confirmed which campaign, through the ONE audit writer (modules/audit) once the queue committed; an audit failure
   *  is logged — it never un-queues a confirmed campaign. Body text and phone numbers are not copied into the audit row. */
  /** C5 audit (Nov 4 2026) — Cancel Campaign: a queued / sending campaign stops; every text not yet handed to the provider is
   *  blocked ('campaign_canceled'); texts already sent stay sent (nothing is recalled). `audit` runs in the same transaction. */
  async cancel(ctx: RetentionContext, campaignId: string, reason: string, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>) {
    if (!isUuid(campaignId)) throw new RetentionError('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
    const why = String(reason ?? '').trim();
    if (why.length < 3) throw new RetentionError('Say why the campaign is canceled.', 'REASON_REQUIRED', 400);
    return this.db.transaction().execute(async (trx) => {
      const c = (await sql<any>`select id, status from retention_sms_campaigns where tenant_id = ${ctx.tenantId} and id = ${campaignId} for update`.execute(trx)).rows[0];
      if (!c) throw new RetentionError('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404);
      const moved = (await sql<any>`update retention_sms_campaigns set status = 'canceled', updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${campaignId} and status in ('queued', 'sending') and ${canMoveToSql(RETENTION_SMS_CAMPAIGN, 'canceled')} returning id`.execute(trx)).rows[0];
      if (!moved) throw new RetentionError(`This campaign cannot be canceled (it is ${String(c.status)}).`, 'CAMPAIGN_NOT_CANCELABLE', 409, { status: String(c.status) });
      const stopped = (await sql<any>`update retention_sms_recipients set status = 'blocked', error = 'campaign_canceled', updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, updated_at = now()
        where tenant_id = ${ctx.tenantId} and campaign_id = ${campaignId} and status = 'queued' and ${canMoveToSql(RETENTION_SMS_RECIPIENT, 'blocked')} returning id`.execute(trx)).rows.length;
      await audit(trx, { campaignId, previousStatus: String(c.status), stoppedTexts: stopped, reason: why });
      return { campaignId, status: 'canceled' as const, stoppedTexts: stopped, ...(await this.countsIn(trx, ctx.tenantId, campaignId)) };
    });
  }
  private async countsIn(x: Kysely<any>, tenantId: string, campaignId: string) {
    const r = (await sql<any>`select count(*) filter (where status = 'sent')::int as sent from retention_sms_recipients where tenant_id = ${tenantId} and campaign_id = ${campaignId}`.execute(x)).rows[0] || {};
    return { sent: Number(r.sent || 0) };
  }

  private async audit(ctx: RetentionContext, campaignId: string, meta: Record<string, unknown>) {
    if (!this.auditor) return;
    try {
      await this.auditor.record({ tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, userId: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null },
        { module: 'retention', action: 'sms_campaign_confirmed', resourceType: 'retention_sms_campaign', resourceId: campaignId, metadata: meta });
    } catch (e) { logException(e, { where: 'retention-sms.audit', tenantId: ctx.tenantId, campaignId }); }
  }

  private async counts(tenantId: string, campaignId: string) {
    const r = (await sql<any>`select count(*) filter (where status in ('queued', 'submitting'))::int as queued, count(*) filter (where status = 'excluded')::int as excluded,
      count(*) filter (where status = 'sent')::int as sent from retention_sms_recipients where tenant_id = ${tenantId} and campaign_id = ${campaignId}`.execute(this.db)).rows[0] || {};
    return { queued: Number(r.queued || 0), excludedCount: Number(r.excluded || 0), sent: Number(r.sent || 0) };
  }
}
