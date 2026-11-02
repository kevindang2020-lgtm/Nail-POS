// email-events.ts — provider email events → the ledger (Email guide §05 / §12, Oct 31 2026). "Sent" means the provider
// accepted the email; "Delivered" exists ONLY when a SIGNED provider event says so. Nothing here is ever trusted unsigned.
//
// SendGrid Signed Event Webhook: ECDSA P-256 over (timestamp + raw body), public key in SENDGRID_WEBHOOK_VERIFICATION_KEY
// (base64 DER, the value SendGrid shows — never logged). Each event names sg_message_id = "<x-message-id>.<suffix>"; the
// ledger row is found by its provider_id (the x-message-id the send recorded) and its tenant comes from THAT row, so a
// forged id can only ever touch nothing.
//   delivered            → notifications.status delivered (the 741 state guard: never back from delivered / failed)
//   bounce / dropped     → failed (sanitized reason); a hard bounce also suppresses the address for ALL email
//   spamreport           → suppression for ALL email (provider_complaint) — the row's status is not rewritten
//   unsubscribe          → marketing-only suppression (email_unsubscribe) — receipts still go out
//   processed / deferred / open / click → kept as evidence only (applied = false); opens are never shown as "read"
// Every event is appended to notification_delivery_events, deduped per (tenant, message id, provider status), so a
// repeated or out-of-order event is kept as evidence and never regresses a row.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { NOTIFICATION } from '../communications-lifecycles';
import { sanitizeProviderText } from '../notifications/notification-failures';
import { logException } from '@aipowersalon/observability';

export interface EmailEventSummary { received: number; applied: number; evidenceOnly: number; duplicates: number; unknownMessage: number; suppressed: number }

/** the signed-webhook check (pure; tested with a generated key pair) */
export function verifySendgridSignature(publicKeyB64: string, signatureB64: string, timestamp: string, rawBody: Buffer | string): boolean {
  if (!publicKeyB64 || !signatureB64 || !timestamp) return false;
  let ok = false;   // fail closed: a malformed key or signature is a refusal, logged (never the key or the body)
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    const data = Buffer.concat([Buffer.from(String(timestamp), 'utf8'), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8')]);
    ok = cryptoVerify('sha256', data, key, Buffer.from(signatureB64, 'base64'));
  } catch (e) { logException(e, { where: 'email-events.signature' }); }
  return ok;
}
/** a signature older / newer than 10 minutes is a replay, not an event */
export function freshTimestamp(ts: string, now = Date.now()): boolean {
  const n = Number(ts); return Number.isFinite(n) && Math.abs(now - n * 1000) <= 10 * 60_000;
}
const baseMessageId = (sg: unknown) => String(sg ?? '').split('.')[0].trim().slice(0, 120);
const HARD_BOUNCE = (ev: any) => String(ev?.event) === 'bounce' && String(ev?.type ?? 'bounce') !== 'blocked';

export async function applyEmailEvents(db: Kysely<any>, events: any[]): Promise<EmailEventSummary> {
  const out: EmailEventSummary = { received: 0, applied: 0, evidenceOnly: 0, duplicates: 0, unknownMessage: 0, suppressed: 0 };
  for (const ev of (Array.isArray(events) ? events : []).slice(0, 1000)) {
    out.received++;
    const sid = baseMessageId(ev?.sg_message_id); const event = String(ev?.event ?? '').toLowerCase().slice(0, 40);
    if (!sid || !event) { out.unknownMessage++; continue; }
    const row = (await sql<any>`select id, tenant_id, to_address, status from notifications where provider_id = ${sid} and channel = 'email' order by created_at desc limit 1`.execute(db)).rows[0];
    if (!row) { out.unknownMessage++; continue; }
    const T = String(row.tenant_id); const addr = String(row.to_address ?? '').trim().toLowerCase();
    const reason = sanitizeProviderText([ev?.reason, ev?.response, ev?.type].filter(Boolean).join(' · '), 200);
    await db.transaction().execute(async (trx) => {
      let moved = false;
      if (event === 'delivered' || event === 'bounce' || event === 'dropped') {
        const target = event === 'delivered' ? 'delivered' : 'failed';
        const failure = event === 'delivered' ? null : `${event === 'dropped' ? 'dropped' : HARD_BOUNCE(ev) ? 'bounced' : 'blocked'}${reason ? `: ${reason}` : ''}`.slice(0, 240);
        const at = Number.isFinite(Number(ev?.timestamp)) ? new Date(Number(ev.timestamp) * 1000).toISOString() : new Date().toISOString();
        const r = await sql<any>`update notifications n set status = ${target}, failure_reason = ${failure}, provider_status = ${event},
            delivered_at = ${target === 'delivered' ? at : null}::timestamptz
          where n.tenant_id = ${T}::uuid and n.id = ${row.id}::uuid and ${canMoveToSql(NOTIFICATION, target, 'n')} returning n.id`.execute(trx);
        moved = r.rows.length > 0;
      }
      const ins = await sql<any>`insert into notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, error_code, applied, signature_verified)
          values (${T}::uuid, ${row.id}::uuid, ${sid}, ${event}, ${ev?.status ? String(ev.status).slice(0, 20) : null}, ${moved}, true)
          on conflict (tenant_id, provider_message_sid, provider_status) do nothing returning id`.execute(trx);
      if (!ins.rows.length) { out.duplicates++; return; }
      if (moved) out.applied++; else out.evidenceOnly++;
      // suppression (current state + append-only consent history together)
      const scope = HARD_BOUNCE(ev) || event === 'spamreport' ? 'all' : event === 'unsubscribe' || event === 'group_unsubscribe' ? 'marketing' : null;
      if (scope && addr) {
        const source = event === 'spamreport' ? 'provider_complaint' : scope === 'all' ? 'provider_bounce' : 'email_unsubscribe';
        await sql`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values (${T}::uuid, 'email', ${addr}, ${source}, ${scope})
            on conflict (tenant_id, channel, address) do update set scope = 'all' where excluded.scope = 'all' and notification_opt_outs.scope <> 'all'`.execute(trx);
        await sql`insert into notification_consent_events (tenant_id, channel, address, action, source, purpose, reason)
            values (${T}::uuid, 'email', ${addr}, 'opt_out', ${source}, ${scope === 'marketing' ? 'marketing' : 'all'}, ${reason})`.execute(trx);
        out.suppressed++;
      }
    });
  }
  return out;
}

/** the public one-click unsubscribe (RFC 8058) — marketing only; idempotent; never reveals whether the address existed */
export async function applyUnsubscribe(db: Kysely<any>, tenantId: string, address: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const ins = await sql<any>`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values (${tenantId}::uuid, 'email', ${address}, 'email_unsubscribe', 'marketing')
        on conflict (tenant_id, channel, address) do nothing returning address`.execute(trx);
    if (ins.rows.length) await sql`insert into notification_consent_events (tenant_id, channel, address, action, source, purpose, reason)
        values (${tenantId}::uuid, 'email', ${address}, 'opt_out', 'email_unsubscribe', 'marketing', 'unsubscribe link')`.execute(trx);
    // the customer record's own marketing-email consent follows (any customer of THIS salon with that email)
    await sql`update customers set marketing_email_opt_in = false where tenant_id = ${tenantId}::uuid and lower(email) = ${address} and marketing_email_opt_in = true`.execute(trx);
  });
}
