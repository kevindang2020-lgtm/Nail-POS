import { SecurityEvents } from '@aipowersalon/security-center';
// booking-verification-webhook.controller.ts — Twilio's delivery/verification status callbacks.
//
// ══ THE SECURITY QUESTION THIS ENDPOINT LIVES OR DIES ON ══════════════════════════════════════════════════
//
//     "Which tenant is this callback for?"
//
// The obvious answer — read a tenant id from the body, or from a query parameter we put in the callback URL — is
// WRONG, and dangerously so. This endpoint is public (Twilio is the caller, so there is no session), which means
// anybody on the internet can POST to it. A tenant id taken from the request is a tenant id an attacker chooses:
// they could mark another salon's verification as `verified`, or poison their delivery stats, or flip a session
// to `failed` mid-booking.
//
// So the tenant is resolved from data WE stored:
//
//   1. verify the signature FIRST — with the candidate tenant's OWN auth token, because each tenant signs with
//      their own Twilio credentials. An unsigned or wrongly-signed request never reaches any logic.
//   2. resolve the session by the PROVIDER'S OWN identifier (the Verify SID / Message SID), which is unique per
//      tenant by `uq_bvs_provider_verification (tenant_id, provider, provider_verification_sid)`.
//
// The row we already wrote is the only thing that says which tenant a SID belongs to. Nothing in the request body
// is trusted to tell us.
//
// ══ AND IT IS IDEMPOTENT ══════════════════════════════════════════════════════════════════════════════════
// Twilio retries. A webhook that processes the same delivery event twice will double-count usage and can move a
// session backwards through its lifecycle. Every write here is conditional on the state it expects to find.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TWILIO_STATUS_CALLBACK_BODY } from '../request-schemas';
import { recordWebhook } from '@aipowersalon/observability';
import { Body, Controller, Headers, HttpCode, Post, Req, Optional, Injectable, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { Inject } from '@nestjs/common';
import { enqueueJob, registerJobHandler, jobHandlerFor } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyVerificationStore } from './booking-verification.kysely';
import { verifyTwilioSignature } from '@aipowersalon/notifications';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { DATABASE, canMoveToSql, type AppDatabase } from '@aipowersalon/database';
import { SMS_USAGE_RECORD } from '../booking-lifecycles';

/** Reconstruct the exact URL Twilio signed. Behind a proxy the framework's own URL is not it. */
function signedUrl(req: any): string {
  const proto = String(req?.headers?.['x-forwarded-proto'] ?? 'https').split(',')[0].trim();
  const host = String(req?.headers?.['x-forwarded-host'] ?? req?.headers?.host ?? '').split(',')[0].trim();
  const path = String(req?.originalUrl ?? req?.url ?? '');
  return `${proto}://${host}${path}`;
}

@Controller('webhooks/twilio/booking-verification')
export class BookingVerificationWebhookController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets, @Optional() private readonly securityEvents?: SecurityEvents) {}

  /**
   * Delivery / verification status.
   *
   * Always returns 204 — even when we reject the request. A webhook that returns 401 to an unsigned caller has
   * just told them their guess was wrong, and a 404 tells them a SID does not exist. Both are oracles. Twilio
   * does not care about the status code here, and an attacker learns nothing from silence.
   */
  @Post('status')
  @HttpCode(204)
  async status(@Req() req: any, @Body(ValidatedBody(TWILIO_STATUS_CALLBACK_BODY)) body: any, @Headers('x-twilio-signature') signature?: string): Promise<void> {
    if (!this.db) return;
    const P = 'twilio:booking_verification';   // Constitution 4 §173–175 counters
    recordWebhook(P, 'received');

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body ?? {})) params[k] = String(v ?? '');

    // The provider's own identifier for this verification/message. It is the ONLY thing in the payload we use to
    // find the row, and it is useless to an attacker who does not already know it.
    const sid = String(params.VerificationSid || params.MessageSid || params.SmsSid || '').trim();
    if (!sid) { recordWebhook(P, 'rejected'); return; }

    // Find the session by SID alone. `uq_bvs_provider_verification (tenant_id, provider, provider_verification_sid)`
    // makes a SID unique within a tenant; across tenants a collision is not possible in practice because SIDs are
    // globally unique to Twilio. Crucially: the TENANT comes from this row, never from the request.
    const found: any = await sql`
      SELECT s.id, s.tenant_id, s.status, s.branch_id
      FROM booking_verification_sessions s
      WHERE s.provider_verification_sid = ${sid}
      LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));

    const row = found.rows?.[0];
    if (!row) { recordWebhook(P, 'rejected'); return; }   // unknown SID → silence. No 404, no oracle.

    const tenantId = String(row.tenant_id);

    // ── verify the signature with THIS TENANT'S OWN auth token ──
    //
    // Each tenant signs with their own Twilio credentials, so there is no single platform secret to check
    // against. Resolving the tenant from the stored row FIRST, and only then verifying, is what makes that
    // possible — and it is why the tenant can never come from the body: we would be verifying a signature
    // against a key the caller chose.
    const cred: any = await sql`
      SELECT auth_token_enc FROM tenant_messaging_credentials
      WHERE tenant_id = ${tenantId} AND provider = 'twilio'
        AND (branch_id = ${row.branch_id} OR branch_id IS NULL)
      ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));

    const enc = cred.rows?.[0]?.auth_token_enc;
    if (!enc) { recordWebhook(P, 'rejected'); return; }

    let authToken: string;
    try { authToken = this.secrets.decrypt(enc); } catch { recordWebhook(P, 'rejected'); return; }

    if (!verifyTwilioSignature(authToken, signedUrl(req), params, signature)) {
      // Wrong or missing signature. Silence — and nothing was written to the verification state. It IS a security
      // event (Constitution 12 §189): the 204 hides the rejection from the caller, not from us.
      recordWebhook(P, 'rejected');
      void this.securityEvents?.record({ type: 'WEBHOOK_SIGNATURE_FAILED', actorType: 'provider', resourceType: 'twilio_booking_verification', reason: 'bad_signature', ip: req?.ip ?? null });
      return;
    }

    // ── the payload is now TRUSTED. Hand it to the job queue, once per (SID, status). ──
    // Phase 4 (audit): Twilio retries and delivers out of order. The (type, key) unique on the queue makes a retried
    // callback a no-op, and the work runs (and retries) off the request path. If the queue cannot take it, the change
    // is applied here instead — a status must never be lost to an infrastructure hiccup.
    recordWebhook(P, 'verified');
    const status = String(params.VerificationStatus || params.MessageStatus || '').toLowerCase();
    if (!TERMINAL.has(status)) { recordWebhook(P, 'processed'); return; }
    const job = { tenantId, sessionId: String(row.id), sid, status, errorCode: String(params.ErrorCode || '').slice(0, 40) || null };
    try {
      const q = await enqueueJob(this.db as any, { jobClass: 'critical', jobType: WEBHOOK_JOB, tenantId, payload: job, idempotencyKey: `${sid}:${status}`, maxAttempts: 8 });
      recordWebhook(P, q?.duplicate ? 'duplicate' : 'processed');
    } catch {
      await applyVerificationStatus(this.db, job).catch(() => undefined);
      recordWebhook(P, 'processed');
    }
  }
}

const WEBHOOK_JOB = 'booking_verification.webhook';
const TERMINAL = new Set(['approved', 'delivered', 'failed', 'undelivered', 'canceled']);

/**
 * Apply one trusted status callback. Idempotent (the queue may run it twice):
 *   delivered / approved → `delivered_at` is stamped (Phase 4 audit: this used to set status 'sent' on a PENDING row —
 *                          which a delivered message's session never is — and never recorded the delivery);
 *   failed / undelivered / canceled → the verification FAILS and its held slot is released, but only while it is still
 *                          waiting (pending / sent): a late failure never undoes a proof the customer already gave.
 * The sms-packages ledger advances forward-only either way.
 */
export async function applyVerificationStatus(db: AppDatabase | null, j: { tenantId: string; sessionId: string; sid: string; status: string; errorCode?: string | null }): Promise<void> {
  if (!db) return;
  if (j.status === 'approved' || j.status === 'delivered') {
    await sql`UPDATE booking_verification_sessions SET delivered_at = coalesce(delivered_at, now()), updated_at = now()
      WHERE id = ${j.sessionId} AND tenant_id = ${j.tenantId}`.execute(db as any);
    await advanceUsageLedger(db, j.tenantId, j.sid, 'DELIVERED');
    return;
  }
  await new KyselyVerificationStore(db, new OutboxWriter()).markFailed(j.sessionId, String(j.errorCode || j.status));
  await advanceUsageLedger(db, j.tenantId, j.sid, j.status === 'undelivered' ? 'UNDELIVERED' : 'FAILED');
}

/** Registers the queue handler (every process: a worker anywhere may run it). */
@Injectable()
export class BookingVerificationWebhookJobs implements OnModuleInit {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}
  onModuleInit(): void {
    if (!this.db || jobHandlerFor(WEBHOOK_JOB)) return;
    const db = this.db;
    registerJobHandler(WEBHOOK_JOB, async (payload, ctx) => {
      await applyVerificationStatus(db, { tenantId: String(ctx.tenantId ?? payload.tenantId ?? ''), sessionId: String(payload.sessionId ?? ''), sid: String(payload.sid ?? ''), status: String(payload.status ?? ''), errorCode: (payload.errorCode as string) ?? null });
      return { applied: payload.status };
    });
  }
}

/**
 * §11 lifecycle on the sms-packages LEDGER (Jul 29, 2026). The billing decision was already made when the
 * provider ACCEPTED the submission — this only records what happened to that accepted message afterwards, so:
 *   · `billable` is never touched. A delivery failure after acceptance does not un-bill per our stated policy,
 *     and a late callback must never rewrite money.
 *   · terminal-only and FORWARD-only: the WHERE refuses to move a row out of a terminal state, so Twilio's
 *     retries (and out-of-order callbacks) are idempotent here exactly as they are for the session above.
 *   · failures swallowed: a ledger write must never break callback handling, which is what keeps the SESSION
 *     state correct for the customer.
 *   · TENANT-SCOPED: the SID alone is globally unique, but the session we just resolved carries the tenant, so
 *     the update is scoped to it — a caller-supplied SID can never reach another salon's ledger row.
 */
async function advanceUsageLedger(db: AppDatabase, tenantId: string, sid: string, next: 'DELIVERED' | 'UNDELIVERED' | 'FAILED'): Promise<void> {
  const stamp = next === 'DELIVERED' ? 'delivered_at' : 'failed_at';
  await sql`
    UPDATE sms_usage_records
    SET status = ${next}, ${sql.raw(stamp)} = now()
    WHERE tenant_id = ${tenantId}
      AND provider_message_id = ${sid}
      AND status NOT IN ('DELIVERED', 'UNDELIVERED', 'FAILED') AND ${canMoveToSql(SMS_USAGE_RECORD, next)}`.execute(db as any).catch(() => undefined);
}
