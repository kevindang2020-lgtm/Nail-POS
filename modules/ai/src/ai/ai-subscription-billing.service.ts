// ai-subscription-billing.service.ts — orchestrates a normalized billing event into a status change and audits it.
// The provider-specific webhook adapter (signature verification + raw→normalized mapping) is environment-specific and
// lives outside this file; it calls applyEvent() with a normalized event.
import { requireServiceCaller, ServiceAuthError, type ServiceScope } from '@aipowersalon/auth';
import { AutomationEngineService } from '@aipowersalon/platform';
import { Controller, Post, Body, Req, HttpException, HttpStatus, Module } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AiSubscriptionBillingRepo, InMemoryAiSubscriptionBillingRepo, KyselyAiSubscriptionBillingRepo, type NormalizedBillingEvent, type BillingApplyResult } from './ai-subscription-billing.repository';
import { verifyWebhookSignature, mapRawBillingEvent } from './ai-billing-webhook-verify';
import { AiTrialSweepJob, AiTrialSweepScheduler } from './ai-trial-sweep';
import { cardpointeChargeToBillingEvent, type CardPointeChargeResult, type CardPointeChargeContext } from './ai-cardpointe-billing';
import { AiInvoiceLedger, mapStripeInvoiceEvent } from './ai-billing-invoices';
import { logException } from '@aipowersalon/observability';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_BILLING_CARDPOINTE_BODY, AI_BILLING_EVENT_BODY } from '../request-schemas';
export class AiSubscriptionBillingService {
  constructor(private readonly repo: AiSubscriptionBillingRepo, private readonly db: AppDatabase = null) {}

  async applyEvent(ev: NormalizedBillingEvent): Promise<BillingApplyResult> {
    if (!ev?.eventId || !ev?.tenantId || !ev?.packageCode || !ev?.eventType) {
      return { applied: false, reason: 'invalid_event' };
    }
    const result = await this.repo.apply(ev);
    if (result.applied && this.db) {
      await sql`insert into audit_logs (id, tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        values (gen_random_uuid(), ${ev.tenantId}, null, 'system', 'ai_subscription_billing_event', 'tenant_ai_subscription', ${ev.packageCode},
        ${JSON.stringify({ eventId: ev.eventId, eventType: ev.eventType, from: result.fromStatus, to: result.toStatus, provider: ev.provider ?? null })})`
        .execute(this.db).catch(() => undefined);
      // Emit TENANT_PAYMENT_FAILED into the automation engine on an applied payment failure. Fire-and-forget + guarded:
      // billing must never break because of automation. Idempotent per provider event (eventId).
      if (ev.eventType === 'payment_failed') {
        const engine = new AutomationEngineService(this.db);
        engine.ingestEvent({ eventId: `billing|${ev.eventId}`, type: 'TENANT_PAYMENT_FAILED', tenantId: ev.tenantId, entityId: ev.packageCode, entityType: 'tenant_ai_subscription', triggeredBy: 'webhook', payload: { packageCode: ev.packageCode, provider: ev.provider ?? null, fromStatus: result.fromStatus, toStatus: result.toStatus } })
          .catch(() => { /* automation is best-effort; billing state already committed */ });
      }
    }
    return result;
  }

  /** Verify a raw provider webhook (HMAC signature) → map to a normalized event → apply. Returns a reason on any reject
   * so the caller can 200-ack-and-ignore vs 4xx as appropriate. Signature scheme/secret come from env. */
  async ingestRawWebhook(rawBody: string, signatureHeader: string): Promise<BillingApplyResult> {
    const secret = process.env.AI_BILLING_WEBHOOK_SECRET || '';
    const scheme = (process.env.AI_BILLING_WEBHOOK_SCHEME as 'stripe' | 'hmac-hex') || 'stripe';
    const verified = verifyWebhookSignature({ payload: rawBody, header: signatureHeader, secret, scheme });
    if (!verified.ok) return { applied: false, reason: `signature_${verified.reason}` };
    let parsed: unknown = null; try { parsed = JSON.parse(rawBody); } catch { return { applied: false, reason: 'invalid_json' }; }
    // Four-Module guide §11 (AI-01): an `invoice.*` event also records the provider's invoice snapshot (amounts, tax,
    // prorations, paid, due) — deduplicated on the provider event id, never charging. A failure is logged, not hidden.
    const inv = mapStripeInvoiceEvent(parsed);
    let invoiceRecorded = false;
    if (inv && inv.ok && this.db) {
      invoiceRecorded = await new AiInvoiceLedger(this.db).ingest(inv.value).then(() => true)
        .catch((e: unknown) => { logException(e, { where: 'ai-billing.invoice_snapshot', tenantId: inv.value.tenantId }); return false; });
    }
    const mapped = mapRawBillingEvent(parsed);
    if (!mapped.ok || !mapped.value) return { applied: false, reason: invoiceRecorded ? 'invoice_snapshot_recorded' : mapped.reason };
    return this.applyEvent(mapped.value);
  }

  /** Self-reconcile path: map a Fiserv CardPointe charge/refund result to a status change and apply it (idempotent on
   * the transaction retref). Call this from your reconcile code after each CardPointe charge or refund. */
  async applyCardpointeCharge(charge: CardPointeChargeResult, ctx: CardPointeChargeContext): Promise<BillingApplyResult> {
    const mapped = cardpointeChargeToBillingEvent(charge, ctx);
    if (!mapped.ok) return { applied: false, reason: mapped.reason };
    return this.applyEvent(mapped.value);
  }
}

// Secret-guarded ingress for a NORMALIZED billing event. The provider webhook (Fiserv/Stripe/etc.) must verify the
// signature and map its raw payload to NormalizedBillingEvent, then POST it here with header 'x-ai-billing-secret' equal
// to AI_BILLING_WEBHOOK_SECRET. 403 unless the env secret is set AND matches — disabled by default, never anonymous.
/** Constitution 3 Step 6: the shared service-caller check, mapped to this route's HTTP errors. */
function serviceCaller(r: any, scope: ServiceScope, legacy: { name: string; secret: string | undefined; header: string }) {
  try { return requireServiceCaller(r, scope, legacy); }
  catch (e) { if (e instanceof ServiceAuthError) throw new HttpException(e.status === 403 ? 'Forbidden' : e.message, e.status); throw e; }
}

@Controller('internal/ai-billing')
export class AiSubscriptionBillingController {
  constructor(private readonly svc: AiSubscriptionBillingService, private readonly sweep: AiTrialSweepJob) {}
  @Post('event')
  async event(@Req() r: any, @Body(ValidatedBody(AI_BILLING_EVENT_BODY, { strict: true })) b: any): Promise<BillingApplyResult> {
    serviceCaller(r, 'ai_billing.ingest', { name: 'AI_BILLING_WEBHOOK_SECRET', secret: process.env.AI_BILLING_WEBHOOK_SECRET, header: 'x-ai-billing-secret' });
    return this.svc.applyEvent({
      eventId: String(b?.eventId ?? ''), tenantId: String(b?.tenantId ?? ''), packageCode: String(b?.packageCode ?? ''), eventType: String(b?.eventType ?? ''),
      provider: b?.provider ?? null, paymentSubscriptionId: b?.paymentSubscriptionId ?? null, paymentCustomerId: b?.paymentCustomerId ?? null, paymentStatus: b?.paymentStatus ?? null, raw: b?.raw ?? null,
    });
  }

  // Direct provider webhook: HMAC-signature-verified over the RAW body. Requires the raw body to be available as
  // req.rawBody (enable an express.raw / rawBody capture for this path) — without it we can't verify the signature, so
  // we 400 rather than trust a re-serialized body. Header name defaults to 'x-signature'.
  @Post('webhook')
  async webhook(@Req() r: any): Promise<BillingApplyResult> {
    const raw: Buffer | string | undefined = r?.rawBody;
    if (!raw) throw new HttpException('raw_body_required', HttpStatus.BAD_REQUEST);
    const sig = r?.headers?.['x-signature'] || r?.headers?.['stripe-signature'] || '';
    return this.svc.ingestRawWebhook(typeof raw === 'string' ? raw : raw.toString('utf8'), String(sig));
  }

  // Ops / external-scheduler trigger to flip lapsed trials to 'expired'. Same shared-secret guard as the cron controllers.
  @Post('sweep-trials')
  async sweepTrials(@Req() r: any): Promise<{ scanned: number; swept: number }> {
    serviceCaller(r, 'ai_billing.ingest', { name: 'AI_BILLING_WEBHOOK_SECRET', secret: process.env.AI_BILLING_WEBHOOK_SECRET, header: 'x-ai-billing-secret' });
    return this.sweep.sweep();
  }

  // Self-reconcile (Fiserv CardPointe) one-call: POST the CardPointe charge/refund response + which tenant/package it was
  // for; the server maps it to a status change and applies it. Same shared-secret guard. Idempotent on the retref.
  @Post('cardpointe')
  async cardpointe(@Req() r: any, @Body(ValidatedBody(AI_BILLING_CARDPOINTE_BODY, { strict: true })) b: any): Promise<BillingApplyResult> {
    serviceCaller(r, 'ai_billing.ingest', { name: 'AI_BILLING_WEBHOOK_SECRET', secret: process.env.AI_BILLING_WEBHOOK_SECRET, header: 'x-ai-billing-secret' });
    return this.svc.applyCardpointeCharge(b?.charge ?? {}, { tenantId: String(b?.tenantId ?? ''), packageCode: String(b?.packageCode ?? ''), kind: b?.kind === 'refund' ? 'refund' : 'charge' });
  }
}

@Module({
  controllers: [AiSubscriptionBillingController],
  providers: [
    { provide: 'AiSubscriptionBillingRepo', useFactory: (db: AppDatabase): AiSubscriptionBillingRepo => (db ? new KyselyAiSubscriptionBillingRepo(db) : new InMemoryAiSubscriptionBillingRepo()), inject: [DATABASE] },
    { provide: AiSubscriptionBillingService, useFactory: (repo: AiSubscriptionBillingRepo, db: AppDatabase) => new AiSubscriptionBillingService(repo, db), inject: ['AiSubscriptionBillingRepo', DATABASE] },
    { provide: AiTrialSweepJob, useFactory: (repo: AiSubscriptionBillingRepo, svc: AiSubscriptionBillingService) => new AiTrialSweepJob(repo, svc), inject: ['AiSubscriptionBillingRepo', AiSubscriptionBillingService] },
    AiTrialSweepScheduler,
  ],
  exports: [AiSubscriptionBillingService],
})
export class AiSubscriptionBillingModule {}
