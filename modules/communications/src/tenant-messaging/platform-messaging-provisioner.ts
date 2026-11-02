// platform-messaging-provisioner.ts — B-16 (Oct 20 2026): Super Admin provisions a PLATFORM-MANAGED salon's texting
// (account_mode 'platform_managed', migration 639 §185). It was reserved only: the column existed, nothing wrote it.
//
//   1. subaccount        the salon's own Twilio subaccount under the AIPowerSalon master account (found by name first — a
//                        retry never opens a second one); its auth token sealed through ProviderSecrets, never returned
//   2. messaging_service the salon's Messaging Service in that subaccount, inbound webhook → the app (A2P attaches here)
//   3. number            a number bought IN the subaccount (the one asked for, else the first in the area code), registered
//                        to this salon only (a number another salon holds is never taken over) and attached to the service
//   4. done              status configured: the send path (KyselyTenantSmsSenderResolver) now uses the subaccount + service,
//                        and inbound replies verify with the subaccount's token (twilio-inbound resolves it by AccountSid)
//
// Resumable: provisioning_step records the last step completed; a failure stops with the step and the reason
// (provisioning_error), and the next run continues from there. One run per salon at a time (provisioning_claimed_at; a
// claim older than 5 minutes is stale). A salon that brought its OWN account (tenant_owned) is refused. Without the master
// credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) the answer is an honest not_configured — no row, no call.
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase, canMoveToSql } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { PROVIDER_SECRETS, secretLast4, type ProviderSecrets } from '@aipowersalon/security';
import { TENANT_MESSAGING_CREDENTIALS, TENANT_MESSAGING_NUMBER } from '../communications-lifecycles';
import { TwilioSubaccountClient, type TwilioCreds } from './twilio-subaccount-client';
import { TwilioNumbersClient } from './twilio-numbers-client';

export class ProvisioningConflict extends Error {
  constructor(readonly code: 'TENANT_OWNED_ACCOUNT' | 'PROVISIONING_IN_PROGRESS', message: string) { super(message); }
  readonly status = 409;
}
export type ProvisionResult =
  | { ok: true; alreadyProvisioned?: boolean; accountSid: string; messagingServiceSid: string; number: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; step: string | null; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{6,15}$/;
const STALE_CLAIM = "interval '5 minutes'";

@Injectable()
export class PlatformMessagingProvisioner {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase | null,
    private readonly audit: AuditService,
    @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets,
    /** tests inject a fake Twilio; production uses each client's instrumented fetch */
    private readonly http?: typeof fetch,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  private master(): TwilioCreds | null {
    const accountSid = (this.env.TWILIO_ACCOUNT_SID || '').trim(), authToken = (this.env.TWILIO_AUTH_TOKEN || '').trim();
    return accountSid && authToken ? { accountSid, authToken } : null;
  }
  private inboundUrl(): string | undefined {
    const base = (this.env.PUBLIC_API_BASE_URL || this.env.APS_API_BASE || '').replace(/\/+$/, '');
    return base ? `${base}/webhooks/twilio/sms/inbound` : undefined;
  }
  private need(): any { if (!this.db) throw new Error('Messaging provisioning requires a database.'); return this.db; }
  private async row(tenantId: string): Promise<any | null> {
    return ((await sql`SELECT id, tenant_id, account_mode, status, account_sid, auth_token_enc, messaging_service_sid, from_number, provisioning_step, provisioning_claimed_at FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND branch_id IS NULL`.execute(this.need())).rows[0] as any) ?? null;
  }

  async provision(actorUserId: string, tenantId: string, opts: { reason: string; areaCode?: string; phoneNumber?: string }): Promise<ProvisionResult> {
    const master = this.master();
    if (!master) return { ok: false, reason: 'not_configured' };
    const db = this.need();
    const actor = UUID.test(actorUserId) ? actorUserId : null;

    // a number asked for by name must be free BEFORE anything is created at Twilio (never a subaccount for a doomed request)
    const asked = (opts.phoneNumber || '').trim();
    if (asked && !E164.test(asked)) return { ok: false, step: null, error: 'phoneNumber must be E.164 (e.g. +18565551234).' };
    if (asked && (await this.heldByAnotherSalon(tenantId, asked))) return { ok: false, step: null, error: 'That number is already registered to another salon.' };

    const existing = await this.row(tenantId);
    if (existing && existing.account_mode === 'tenant_owned') throw new ProvisioningConflict('TENANT_OWNED_ACCOUNT', 'This salon uses its own Twilio account — disconnect it first to switch to a platform-managed account.');
    if (existing?.provisioning_step === 'done' && existing.status === 'configured') {
      return { ok: true, alreadyProvisioned: true, accountSid: existing.account_sid, messagingServiceSid: existing.messaging_service_sid, number: existing.from_number };
    }

    // claim: one run per salon (insert the row, or take an unclaimed / stale-claimed platform-managed row)
    const claimed = (await sql`
      INSERT INTO tenant_messaging_credentials (tenant_id, provider, status, account_mode, provisioning_claimed_at, updated_by_user_id)
      VALUES (${tenantId}, 'twilio', 'not_configured', 'platform_managed', now(), ${actor})
      ON CONFLICT (tenant_id, provider) WHERE branch_id IS NULL DO UPDATE SET provisioning_claimed_at = now(), updated_at = now()
        WHERE tenant_messaging_credentials.account_mode = 'platform_managed'
          AND (tenant_messaging_credentials.provisioning_claimed_at IS NULL OR tenant_messaging_credentials.provisioning_claimed_at < now() - ${sql.raw(STALE_CLAIM)})
      RETURNING id, tenant_id, account_mode, status, account_sid, auth_token_enc, messaging_service_sid, from_number, provisioning_step, provisioning_claimed_at`.execute(db)).rows[0] as any;
    if (!claimed) {
      const now = await this.row(tenantId);
      if (now?.account_mode === 'tenant_owned') throw new ProvisioningConflict('TENANT_OWNED_ACCOUNT', 'This salon uses its own Twilio account — disconnect it first to switch to a platform-managed account.');
      throw new ProvisioningConflict('PROVISIONING_IN_PROGRESS', 'Provisioning for this salon is already running — wait a minute and refresh.');
    }

    const save = (set: ReturnType<typeof sql>) => sql`UPDATE tenant_messaging_credentials SET ${set}, updated_at = now(), updated_by_user_id = ${actor} WHERE id = ${claimed.id}`.execute(db);
    // §149: a salon offboarded earlier (number released, subaccount closed) that comes back starts from the beginning
    if (claimed.provisioning_step === 'offboarded') {
      await save(sql`account_sid = NULL, auth_token_enc = NULL, auth_token_last4 = NULL, messaging_service_sid = NULL, from_number = NULL, provisioning_step = NULL, provisioning_error = NULL, offboarded_at = NULL, offboarding_error = NULL`);
      Object.assign(claimed, { account_sid: null, auth_token_enc: null, messaging_service_sid: null, from_number: null, provisioning_step: null });
    }
    let step: string | null = claimed.provisioning_step ?? null;
    try {
      // 1. subaccount
      let sub: TwilioCreds;
      if (claimed.account_sid && claimed.auth_token_enc) sub = { accountSid: claimed.account_sid, authToken: this.secrets.decrypt(claimed.auth_token_enc) };
      else {
        const made = await new TwilioSubaccountClient(master, this.http).findOrCreateSubaccount(`AIPowerSalon ${tenantId}`);
        sub = { accountSid: made.accountSid, authToken: made.authToken };
        await save(sql`account_sid = ${made.accountSid}, auth_token_enc = ${this.secrets.encrypt(made.authToken)}, auth_token_last4 = ${secretLast4(made.authToken)}, provisioning_step = 'subaccount', provisioning_error = NULL`);
        step = 'subaccount';
        await this.note(tenantId, actorUserId, 'messaging.platform_subaccount_ready', { accountSid: made.accountSid, created: made.created, reason: opts.reason });
      }
      // 2. Messaging Service
      let mg: string = claimed.messaging_service_sid;
      if (!mg) {
        const name = ((await sql`SELECT display_name FROM tenants WHERE id = ${tenantId}`.execute(db)).rows[0] as any)?.display_name ?? tenantId;
        mg = await new TwilioSubaccountClient(sub, this.http).createMessagingService(`AIPowerSalon ${name}`.slice(0, 64), this.inboundUrl());
        await save(sql`messaging_service_sid = ${mg}, provisioning_step = 'messaging_service', provisioning_error = NULL`);
        step = 'messaging_service';
      }
      // 3. number — bought in the subaccount, registered to this salon only, attached to the service
      let number: string = claimed.from_number;
      let pnSid: string | null = null;
      if (!number) {
        const want = (opts.phoneNumber || '').trim();
        if (want && !E164.test(want)) throw new Error('phoneNumber must be E.164 (e.g. +18565551234).');
        if (want && (await this.heldByAnotherSalon(tenantId, want))) throw new Error('That number is already registered to another salon.');
        const numbers = new TwilioNumbersClient(sub, this.http);
        const pick = want || (await numbers.searchLocal({ areaCode: opts.areaCode, limit: 1 }))[0]?.phoneNumber;
        if (!pick) throw new Error(`Twilio has no SMS number available${opts.areaCode ? ` in area code ${opts.areaCode}` : ''} — try another area code.`);
        if (await this.heldByAnotherSalon(tenantId, pick)) throw new Error('That number is already registered to another salon.');
        const bought = await numbers.purchase(pick, { smsUrl: this.inboundUrl() });
        number = bought.phoneNumber; pnSid = bought.sid;
        await sql`INSERT INTO tenant_messaging_numbers (tenant_id, phone_number, channel, provider, provider_phone_number_sid, purpose, status, updated_by)
                  VALUES (${tenantId}, ${number}, 'sms', 'twilio', ${pnSid}, 'general_sms', 'active', ${actor})
                  ON CONFLICT (phone_number) DO UPDATE SET provider_phone_number_sid = EXCLUDED.provider_phone_number_sid, status = 'active', released_at = NULL, updated_at = now()
                  WHERE tenant_messaging_numbers.tenant_id = ${tenantId} AND ${canMoveToSql(TENANT_MESSAGING_NUMBER, 'active', 'tenant_messaging_numbers')}`.execute(db);
        await save(sql`from_number = ${number}, provisioning_step = 'number', provisioning_error = NULL`);
        step = 'number';
      } else {
        pnSid = ((await sql`SELECT provider_phone_number_sid FROM tenant_messaging_numbers WHERE phone_number = ${number} AND tenant_id = ${tenantId}`.execute(db)).rows[0] as any)?.provider_phone_number_sid ?? null;
      }
      if (!pnSid) throw new Error(`The number ${number} has no Twilio number SID on record — register it again.`);
      await new TwilioSubaccountClient(sub, this.http).attachNumber(mg, pnSid);
      // 4. live
      await sql`UPDATE tenant_messaging_credentials SET status = 'configured', provisioning_step = 'done', provisioning_error = NULL, provisioning_claimed_at = NULL,
                  provisioned_at = now(), config_version = config_version + 1, last_validated_at = NULL, updated_at = now(), updated_by_user_id = ${actor}
                WHERE id = ${claimed.id} AND ${canMoveToSql(TENANT_MESSAGING_CREDENTIALS, 'configured')}`.execute(db);
      await this.note(tenantId, actorUserId, 'messaging.platform_provisioned', { accountSid: sub.accountSid, messagingServiceSid: mg, number, reason: opts.reason });
      return { ok: true, accountSid: sub.accountSid, messagingServiceSid: mg, number };
    } catch (e: any) {
      const error = String(e?.message || 'provisioning failed').replace(/^(twilio_failed|numbers_failed):/, 'Twilio: ').slice(0, 500);
      await sql`UPDATE tenant_messaging_credentials SET provisioning_error = ${error}, provisioning_claimed_at = NULL, updated_at = now() WHERE id = ${claimed.id}`.execute(db).catch(() => undefined);
      await this.note(tenantId, actorUserId, 'messaging.platform_provisioning_failed', { step, error, reason: opts.reason });
      return { ok: false, step, error };
    }
  }

  /**
   * §149 (Kevin's decision, Oct 28 2026): a cancelled salon's PLATFORM-MANAGED texting is shut down — every Twilio number
   * bought for it is RELEASED (irreversible: the number goes back to Twilio) and its subaccount CLOSED, so the platform stops
   * paying for them. Only for a salon whose access status is 'cancelled' (lifecycle CLOSED / ARCHIVED); a salon that brought
   * its OWN Twilio account is never touched (it is theirs). Resumable: each released number is recorded at once; a failure
   * stops with the reason (offboarding_error) and the next run continues. One run per salon (the provisioning claim).
   */
  async offboard(actorUserId: string, tenantId: string, opts: { reason: string }): Promise<{ ok: true; alreadyOffboarded?: boolean; releasedNumbers: string[]; subaccountClosed: boolean } | { ok: false; reason: 'not_configured' | 'not_platform_managed' | 'salon_not_cancelled' | 'nothing_to_offboard' } | { ok: false; error: string }> {
    const master = this.master();
    if (!master) return { ok: false, reason: 'not_configured' };
    const db = this.need();
    const actor = UUID.test(actorUserId) ? actorUserId : null;
    const t = (await sql<{ status: string }>`SELECT status FROM tenants WHERE id = ${tenantId}`.execute(db)).rows[0];
    if (!t || String(t.status) !== 'cancelled') return { ok: false, reason: 'salon_not_cancelled' };
    const existing = await this.row(tenantId);
    if (!existing) return { ok: false, reason: 'nothing_to_offboard' };
    if (existing.account_mode !== 'platform_managed') return { ok: false, reason: 'not_platform_managed' };
    if (existing.provisioning_step === 'offboarded') return { ok: true, alreadyOffboarded: true, releasedNumbers: [], subaccountClosed: true };
    const claimed = (await sql<{ id: string; account_sid: string | null; auth_token_enc: string | null }>`UPDATE tenant_messaging_credentials SET provisioning_claimed_at = now(), updated_at = now()
        WHERE id = ${existing.id} AND account_mode = 'platform_managed' AND (provisioning_claimed_at IS NULL OR provisioning_claimed_at < now() - interval '5 minutes')
        RETURNING id, account_sid, auth_token_enc`.execute(db)).rows[0];
    if (!claimed) throw new ProvisioningConflict('PROVISIONING_IN_PROGRESS', 'A texting change for this salon is already running — wait a minute and refresh.');
    const released: string[] = [];
    try {
      // 1. every live number of the salon that Twilio sold into its subaccount
      const numbers = (await sql<{ id: string; phone_number: string; provider_phone_number_sid: string }>`SELECT id, phone_number, provider_phone_number_sid FROM tenant_messaging_numbers
          WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND status <> 'released' AND provider_phone_number_sid IS NOT NULL`.execute(db)).rows;
      if (numbers.length && !(claimed.account_sid && claimed.auth_token_enc)) throw new Error('The salon\'s subaccount credentials are missing — release its numbers in the Twilio console.');
      const sub: TwilioCreds | null = claimed.account_sid && claimed.auth_token_enc ? { accountSid: claimed.account_sid, authToken: this.secrets.decrypt(claimed.auth_token_enc) } : null;
      for (const n of numbers) {
        await new TwilioSubaccountClient(sub!, this.http).releaseNumber(String(n.provider_phone_number_sid));
        await sql`UPDATE tenant_messaging_numbers SET status = 'released', released_at = now(), updated_at = now(), updated_by = ${actor}
                  WHERE id = ${n.id} AND tenant_id = ${tenantId} AND ${canMoveToSql(TENANT_MESSAGING_NUMBER, 'released', 'tenant_messaging_numbers')}`.execute(db);
        released.push(String(n.phone_number));
      }
      // 2. the subaccount (with the master credentials)
      let closed = false;
      if (claimed.account_sid) { await new TwilioSubaccountClient(master, this.http).closeSubaccount(String(claimed.account_sid)); closed = true; }
      // 3. the salon has no texting any more (sends fall back to "not configured", never to another salon's sender)
      await sql`UPDATE tenant_messaging_credentials SET status = 'not_configured', provisioning_step = 'offboarded', offboarded_at = now(), offboarding_error = NULL,
                  provisioning_claimed_at = NULL, auth_token_enc = NULL, from_number = NULL, config_version = config_version + 1, updated_at = now(), updated_by_user_id = ${actor}
                WHERE id = ${claimed.id} AND ${canMoveToSql(TENANT_MESSAGING_CREDENTIALS, 'not_configured')}`.execute(db);
      await this.note(tenantId, actorUserId, 'messaging.platform_offboarded', { accountSid: claimed.account_sid ?? null, releasedNumbers: released, subaccountClosed: closed, reason: opts.reason });
      return { ok: true, releasedNumbers: released, subaccountClosed: closed };
    } catch (e: any) {
      const error = String(e?.message || 'offboarding failed').replace(/^(twilio_failed|numbers_failed):/, 'Twilio: ').slice(0, 500);
      await sql`UPDATE tenant_messaging_credentials SET offboarding_error = ${error}, provisioning_claimed_at = NULL, updated_at = now() WHERE id = ${claimed.id}`.execute(db).catch((w) => console.warn('[messaging-offboard] could not record the stop reason', (w as Error)?.message ?? w));
      await this.note(tenantId, actorUserId, 'messaging.platform_offboarding_failed', { releasedNumbers: released, error, reason: opts.reason });
      return { ok: false, error };
    }
  }

  /** §149 sweep: every platform-managed salon CANCELLED longer than the grace period (MESSAGING_OFFBOARD_GRACE_DAYS, default
   *  30 — a salon that comes back inside it keeps its number) and not offboarded yet. Bounded per run. */
  async offboardClosedSalons(now: Date = new Date(), limit = 20): Promise<{ checked: number; offboarded: number; failed: number }> {
    if (!this.master() || !this.db) return { checked: 0, offboarded: 0, failed: 0 };
    const grace = Math.max(1, Math.min(365, Number(this.env.MESSAGING_OFFBOARD_GRACE_DAYS) || 30));
    const due = (await sql<{ tenant_id: string }>`SELECT c.tenant_id FROM tenant_messaging_credentials c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.provider = 'twilio' AND c.branch_id IS NULL AND c.account_mode = 'platform_managed' AND COALESCE(c.provisioning_step, '') <> 'offboarded'
          AND t.status = 'cancelled' AND COALESCE(t.closed_at, t.updated_at) < ${now} - make_interval(days => ${grace})
        ORDER BY COALESCE(t.closed_at, t.updated_at) LIMIT ${Math.max(1, Math.min(200, limit))}`.execute(this.db)).rows;
    let offboarded = 0, failed = 0;
    for (const d of due) {
      try { const r = await this.offboard('system', String(d.tenant_id), { reason: `salon cancelled more than ${grace} days ago` }); if (r.ok) offboarded++; else if ('error' in r) failed++; }
      catch (e) { failed++; console.warn('[messaging-offboard] salon skipped this run (another run holds it?)', (e as Error)?.message ?? e); }   // the next sweep takes it
    }
    return { checked: due.length, offboarded, failed };
  }

  private async heldByAnotherSalon(tenantId: string, phoneNumber: string): Promise<boolean> {
    const r: any = await sql`SELECT tenant_id::text AS t FROM tenant_messaging_numbers WHERE phone_number = ${phoneNumber} LIMIT 1`.execute(this.need());
    return !!r.rows?.[0] && String(r.rows[0].t) !== String(tenantId);
  }
  private async note(tenantId: string, actorUserId: string, action: string, metadata: Record<string, unknown>) {
    await this.audit.record({ tenantId, userId: actorUserId } as any, {
      module: 'messaging', action, resourceType: 'tenant_messaging_credentials', resourceId: tenantId,
      summary: action === 'messaging.platform_provisioned' ? 'Platform-managed texting provisioned' : action === 'messaging.platform_subaccount_ready' ? 'Platform Twilio subaccount ready' : action === 'messaging.platform_offboarded' ? 'Platform texting shut down: number released, subaccount closed' : action === 'messaging.platform_offboarding_failed' ? 'Platform texting shutdown stopped' : 'Platform texting provisioning stopped',
      metadata,
    }).catch(() => undefined);
  }
}
