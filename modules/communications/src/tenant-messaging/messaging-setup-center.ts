// messaging-setup-center.ts — Text Messaging Setup & SMS Readiness guide (Oct 31 2026), the owner's three priorities on
// top of the EXISTING model (no second credential store, no second sender, no second test path):
//   tenant_messaging_credentials (311+, the ONE store; secrets never read here), tenant_messaging_health_checks (721),
//   sms_test_events (721), tenant_messaging_webhook_activity (721, SIGNATURE-VERIFIED webhooks only),
//   tenant_messaging_registration_sync_runs (725), tenant_number_purchase_quotes (721), notifications (delivery evidence),
//   and TenantMessagingReadinessService (the shared readiness both Communications pages read).
//
//   overview   §11 "Check SMS System": SIX independent parts — Account · Sender · Registration · Inbound · Delivery ·
//              Booking Verify — each Ready / Attention Required / Pending / Failed / Unknown (Booking Verify may be Off),
//              with its evidence, source, timestamp and the exact next action. A green "Connected" is NEVER readiness:
//              account authentication, sender, carrier registration, inbound routing and delivery are judged separately.
//              Plus §12 the guided wizard's seven steps (resume at the first unfinished step; a skipped approval or
//              registration is never "done") and the scheduled-run status.
//   branches   §13 every branch the actor may act for: inherited vs own sender, masked account, sender type,
//              registration and the six parts — so the effective sender is visible before a branch test.
//   activity   §14–§16 searchable history of the setup's REAL records — test texts, health checks, registration
//              checks, number quotes/purchases — server search (sender, last 4 of the masked recipient, provider id,
//              error code, record id), kind / state / branch filters, an explicit date basis on salon-local inclusive
//              days (DST-safe, computed by Postgres in the zone), newest first with an id tie-break, pages of 10/20/50
//              and an exact total. Stored secrets are never selected, so they can never be searched.
//   detail     one record with its attribution (branch, actor), masked identifiers only.
//   nightly    the controlled, env-gated (MESSAGING_HEALTH_SCHEDULE_ENABLED, OFF by default) read-only health run:
//              one job per salon per salon-local night on the ONE job queue; it records a 'scheduled' check and opens /
//              updates ONE de-duplicated owner alert per failing part (owner_alerts category messaging_failure — the
//              Customer Notifications incidents list acknowledges / resolves it). It never sends, buys, registers or
//              changes a credential.
import { HttpException, HttpStatus } from '@nestjs/common';
import { consentBoundary } from '../notifications/consent-boundary';
import { sql, type Kysely } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { enqueueJob, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import type { TenantMessagingReadinessService, ReadinessView } from './tenant-messaging-readiness.service';

export interface SetupCtx { tenantId: string; userId: string; branchId: string | null }
export type PartState = 'ready' | 'attention_required' | 'pending' | 'failed' | 'unknown' | 'off';
export type PartKey = 'account' | 'sender' | 'registration' | 'inbound' | 'delivery' | 'booking_verify';
export interface ReadinessPart { key: PartKey; state: PartState; summary: string; evidence: string; source: string; checkedAt: string | null; nextAction: string | null; fixLink: string }
export interface DeliveryEvidence { statusCallbackUrl: boolean; lastStatusEventAt: string | null; waitingOver2h: number; failedTests24h: number; failedSms24h: number; awaitingReports: number }
export type WizardKey = 'scope' | 'connect' | 'number' | 'registration' | 'webhooks' | 'test' | 'summary';
export type WizardState = 'done' | 'action' | 'pending' | 'blocked';
export interface WizardStep { key: WizardKey; state: WizardState; summary: string; fixLink: string }

export const ACTIVITY_KINDS = ['test_sms', 'health_check', 'registration_check', 'number_purchase'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_STATES = ['ok', 'pending', 'failed'] as const;
export const ACTIVITY_BASES = ['created', 'updated', 'delivered'] as const;
export type ActivityBasis = (typeof ACTIVITY_BASES)[number];
const PRESETS = ['today', 'week', 'month', 'year', 'custom', 'all'] as const;
export interface ActivityFilters { q?: string; kind?: string; state?: string; branchId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): string | null => (v instanceof Date || typeof v === 'string' || typeof v === 'number' ? new Date(v as string | number | Date).toISOString() : null);
const N = (v: unknown) => Number(v ?? 0) || 0;
const like = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const SETUP = '/tenant/communications/messaging-setup';
function bad(message: string): never { throw withCode(new HttpException({ code: 'MESSAGING_SETUP_INVALID_FILTER', message }, HttpStatus.BAD_REQUEST), 'MESSAGING_SETUP_INVALID_FILTER'); }
function notFound(): never { throw withCode(new HttpException({ code: 'MESSAGING_ACTIVITY_NOT_FOUND', message: 'That messaging record could not be found.' }, HttpStatus.NOT_FOUND), 'MESSAGING_ACTIVITY_NOT_FOUND'); }
/** a sender / quoted number shows its last 4 only in lists (the salon's own number is not customer data, but the
 *  recipient side always arrives masked from sms_test_events and is never unmasked) */
const last4 = (v: unknown) => { const s = String(v ?? ''); return s ? `…${s.slice(-4)}` : null; };

// ── §11 the six independent parts (pure: the readiness view + the delivery evidence → the panel) ─────────────────────
export function sixParts(r: ReadinessView, d: DeliveryEvidence): ReadinessPart[] {
  const parts: ReadinessPart[] = [];
  const P = (key: PartKey, state: PartState, summary: string, evidence: string, source: string, checkedAt: string | null, nextAction: string | null, fixLink: string) =>
    parts.push({ key, state, summary, evidence, source, checkedAt, nextAction, fixLink });

  // Account — authentication only (never "SMS works")
  const a = r.account;
  const acctEvidence = `${a.mode === 'tenant_owned' ? "the salon's own Twilio" : a.mode === 'shared_platform' ? 'shared platform account' : a.mode === 'platform_managed' ? 'platform-managed subaccount' : 'no account'}${a.accountSidMasked ? ` ${a.accountSidMasked}` : ''}${a.authMode ? ` · ${a.authMode === 'api_key' ? 'API key' : 'auth token'}` : ''}`;
  if (a.state === 'connected') P('account', 'ready', 'Twilio accepted these credentials at the last check.', acctEvidence, 'provider check', a.lastCheckedAt, null, a.fixLink);
  else if (a.state === 'invalid') P('account', 'failed', 'Twilio refused these credentials at the last check.', `${acctEvidence} · ${a.reasonCode ?? 'refused'}`, 'provider check', a.lastCheckedAt, 'Re-enter the Auth Token (or API key) in Credentials, then Check SMS System.', a.fixLink);
  else if (a.state === 'not_configured') P('account', 'attention_required', a.reasonCode === 'USING_PLATFORM_SHARED_ACCOUNT' ? "No salon Twilio account — texts would use the shared platform account." : 'No Twilio account is connected.', acctEvidence, 'saved settings', null, "Connect the salon's own Twilio account (Setup Wizard step 2).", a.fixLink);
  else P('account', 'unknown', a.state === 'stale' ? 'The last check is too old to trust.' : 'This configuration has not been checked with Twilio since it changed.', `${acctEvidence} · ${a.reasonCode ?? 'not checked'}`, 'saved settings', a.lastCheckedAt, 'Press Check SMS System.', a.fixLink);

  // Sender — the number (or its absence), its ownership and SMS capability
  const s = r.sender;
  const sendEvidence = `${s.number ?? 'no number'}${s.senderType ? ` · ${s.senderType === 'toll_free' ? 'toll-free' : s.senderType === '10dlc' ? 'US long code (10DLC)' : s.senderType}` : ''}${s.smsCapable === false ? ' · not SMS-capable' : s.smsCapable ? ' · SMS-capable' : ''} · ${r.source === 'branch_override' ? "this branch's own setting" : r.source === 'tenant_default' ? 'salon default' : 'not configured'}`;
  if (s.state === 'assigned' && s.smsCapable !== false) P('sender', 'ready', 'The sending number is on this Twilio account.', sendEvidence, 'provider check', s.lastCheckedAt, null, s.fixLink);
  else if (s.state === 'assigned') P('sender', 'failed', 'The sending number cannot send texts.', sendEvidence, 'provider check', s.lastCheckedAt, 'Choose an SMS-capable number.', s.fixLink);
  else if (s.state === 'not_owned') P('sender', 'failed', 'The sending number is NOT on this Twilio account.', sendEvidence, 'provider check', s.lastCheckedAt, 'Register a number this account owns, or fix the From number.', s.fixLink);
  else if (s.state === 'missing') P('sender', 'attention_required', 'No sending number is set.', sendEvidence, 'saved settings', null, 'Search for a number or enter one you already own (Setup Wizard step 3).', s.fixLink);
  else P('sender', 'unknown', 'The sending number has not been checked with Twilio.', sendEvidence, 'saved settings', s.lastCheckedAt, 'Press Check SMS System.', s.fixLink);

  // Registration — 10DLC brand + campaign for a US long code, toll-free verification for a toll-free sender; never both
  const tf = r.tollFree; const reg = r.a2p;
  const regOf = (state: string, label: string, evidence: string, checkedAt: string | null, fixLink: string) => {
    if (state === 'approved') P('registration', 'ready', `${label}: approved by the provider.`, evidence, 'provider status', checkedAt, null, fixLink);
    else if (state === 'pending') P('registration', 'pending', `${label}: submitted, waiting for the carriers — not approved yet.`, evidence, 'provider status', checkedAt, 'Nothing to do but wait; press Refresh Status to read the latest.', fixLink);
    else if (state === 'rejected' || state === 'suspended') P('registration', 'failed', `${label}: ${state}.`, evidence, 'provider status', checkedAt, 'Open the registration details for the reason; resubmission is done in the provider workflow (it may cost a fee — owner approval).', fixLink);
    else if (state === 'not_started') P('registration', 'attention_required', `${label}: not started — texts to US numbers may be filtered.`, evidence, 'provider status', checkedAt, 'Start registration with AI PowerSalon support (paid carrier registration needs owner approval).', fixLink);
    else if (state === 'not_applicable') P('registration', 'ready', 'No carrier registration applies to this sender.', evidence, 'sender type', checkedAt, null, fixLink);
    else P('registration', 'unknown', `${label}: could not be verified with the provider.`, evidence, 'provider status', checkedAt, 'Press Refresh Status in Registration.', fixLink);
  };
  if (s.senderType === 'toll_free') regOf(tf.state, 'Toll-free verification', `toll-free · ${tf.providerStatus ?? 'no provider status'}${tf.stale ? ' · stale' : ''}`, tf.checkedAt, `${SETUP}#registration`);
  else if (reg.applicable) regOf(reg.state, '10DLC brand & campaign', `brand ${reg.brand.providerStatus ?? reg.brand.state} · campaign ${reg.campaign.providerStatus ?? reg.campaign.state}${reg.stale ? ' · stale' : ''}${reg.providerVerified ? '' : ' · not verified with the provider'}`, reg.lastProviderCheckAt, reg.fixLink);
  else if (!s.number) P('registration', 'unknown', 'No sender yet — registration depends on the number type.', 'no sender', 'saved settings', null, 'Set a sending number first.', `${SETUP}#number`);
  else regOf('not_applicable', '', `sender type ${s.senderType ?? 'unknown'}`, reg.lastProviderCheckAt, reg.fixLink);

  // Inbound — proven only by a signature-verified inbound webhook
  const i = r.inbound;
  const inEvidence = `${i.webhookUrl ? 'webhook URL set' : 'no webhook URL'} · last verified inbound ${i.lastVerifiedEventAt ?? 'never'}`;
  if (i.state === 'verified') P('inbound', 'ready', 'A signature-verified inbound text reached this salon.', inEvidence, 'verified webhook', i.lastVerifiedEventAt, null, i.fixLink);
  else if (i.state === 'configured') P('inbound', 'pending', 'The inbound webhook is set, but no signature-verified inbound text has arrived yet.', inEvidence, 'provider check', i.lastCheckedAt, 'Text the salon number from any phone to prove inbound routing.', i.fixLink);
  else if (i.state === 'failed') P('inbound', 'failed', "The number's inbound webhook does not point at AI PowerSalon.", inEvidence, 'provider check', i.lastCheckedAt, 'Set the number\'s messaging webhook to the AI PowerSalon inbound URL (shown in Webhooks).', i.fixLink);
  else P('inbound', 'unknown', 'Inbound routing has not been checked.', inEvidence, 'saved settings', i.lastCheckedAt, 'Press Check SMS System.', i.fixLink);

  // Delivery — callbacks configured AND arriving, recent failures, texts waiting too long for a report
  const sc = i.statusCallback;
  const dEvidence = `${d.statusCallbackUrl ? 'status callback URL set' : 'no status callback URL'} · last verified report ${d.lastStatusEventAt ?? 'never'} · ${d.failedTests24h + d.failedSms24h} failed in 24 h · ${d.waitingOver2h} waiting > 2 h`;
  if (!d.statusCallbackUrl) P('delivery', 'attention_required', 'Delivery reports are not configured — "Delivered" can never be confirmed.', dEvidence, 'environment', null, 'Set TWILIO_STATUS_CALLBACK_URL in the API environment (operator task).', sc.fixLink);
  else if (d.failedTests24h + d.failedSms24h > 0) P('delivery', 'attention_required', `${d.failedTests24h + d.failedSms24h} text(s) failed in the last 24 hours.`, dEvidence, 'delivery reports', d.lastStatusEventAt, 'Open Customer Notifications → Failed for the provider error codes.', '/tenant/communications/notifications');
  else if (d.waitingOver2h >= 3) P('delivery', 'unknown', `${d.waitingOver2h} accepted text(s) have waited over 2 hours for a delivery report — reports may have stopped.`, dEvidence, 'delivery reports', d.lastStatusEventAt, 'Check the status callback URL and the API host; delivered counts are on hold.', sc.fixLink);
  else if (sc.state === 'verified' || d.lastStatusEventAt) P('delivery', 'ready', 'Signed delivery reports are arriving.', dEvidence, 'verified webhook', d.lastStatusEventAt, null, sc.fixLink);
  else P('delivery', 'pending', 'Delivery reports are configured, but none has arrived yet.', dEvidence, 'environment', null, 'Send a test text — its delivery report proves the callback.', `${SETUP}#test`);

  // Booking Verify — separate from texting (a sender can work while Verify is not configured)
  const v = r.verify;
  const vEvidence = `${v.channel === 'verify_service' ? `Verify Service ${v.serviceSidLast4 ? '…' + v.serviceSidLast4 : ''}` : v.channel === 'sms_code' ? 'codes sent as texts from the salon number' : 'no channel'} · ${v.requiredByPlatform ? 'required by the platform' : v.tenantEnabled ? 'on (salon setting)' : 'off (salon setting)'}${v.platformBlocked ? ' · blocked by the platform' : ''}`;
  if (v.platformBlocked) P('booking_verify', 'failed', 'AI PowerSalon has blocked booking phone verification for this salon.', vEvidence, 'platform policy', v.lastCheckedAt, 'Contact AI PowerSalon support.', v.fixLink);
  else if (v.state === 'ready') P('booking_verify', 'ready', 'Booking codes can be sent and checked.', vEvidence, 'provider check', v.lastCheckedAt, null, v.fixLink);
  else if (v.state === 'misconfigured') P('booking_verify', 'attention_required', 'Booking verification is on but its sending path is not ready.', `${vEvidence} · ${v.reasonCode ?? 'misconfigured'}`, 'provider check', v.lastCheckedAt, 'Open Booking Phone Verification → Check Verification System.', v.fixLink);
  else if (v.requiredByPlatform) P('booking_verify', 'attention_required', 'Required by the platform but not ready.', vEvidence, 'platform policy', v.lastCheckedAt, 'Open Booking Phone Verification.', v.fixLink);
  else P('booking_verify', 'off', 'Off — remote bookings are not asked for a code (a salon choice, not an error).', vEvidence, 'salon setting', v.lastCheckedAt, null, v.fixLink);
  return parts;
}

// ── §12 the guided wizard: derived from the same evidence; resumes at the first unfinished step ────────────────────────
export function wizardSteps(r: ReadinessView, parts: ReadinessPart[]): { steps: WizardStep[]; resumeAt: WizardKey } {
  const p = (k: PartKey) => parts.find((x) => x.key === k)!;
  const steps: WizardStep[] = [];
  const S = (key: WizardKey, state: WizardState, summary: string, fixLink: string) => steps.push({ key, state, summary, fixLink });
  S('scope', 'done', r.scope.branchId ? `Configuring ${r.scope.branchName ?? 'a branch'} (${r.source === 'branch_override' ? 'its own Twilio' : 'inherits the salon default'}).` : `Configuring the salon default every branch inherits${r.scope.branchOverrides.length ? ` (${r.scope.branchOverrides.length} branch override(s))` : ''}.`, `${SETUP}#pm-summary`);
  const acc = p('account');
  S('connect', acc.state === 'ready' ? 'done' : 'action', acc.summary, `${SETUP}#credentials`);
  const snd = p('sender');
  S('number', snd.state === 'ready' ? 'done' : 'action', snd.state === 'ready' ? snd.summary : `${snd.summary} Searching never buys; a purchase needs its own quoted confirmation and your password.`, `${SETUP}#search`);
  const reg = p('registration');
  S('registration', reg.state === 'ready' ? 'done' : reg.state === 'pending' ? 'pending' : 'action', reg.summary, `${SETUP}#registration`);
  const inb = p('inbound'), del = p('delivery');
  S('webhooks', inb.state === 'ready' && del.state === 'ready' ? 'done' : inb.state === 'failed' || del.state === 'attention_required' && !del.checkedAt ? 'action' : 'pending',
    `Inbound: ${inb.summary} Delivery: ${del.summary}`, `${SETUP}#webhooks`);
  const vf = p('booking_verify'); const lt = r.lastTest;
  const tested = lt?.displayState === 'delivered';
  const testWaiting = lt && ['requested', 'accepted', 'sent'].includes(lt.displayState);
  S('test', tested && (vf.state === 'ready' || vf.state === 'off') ? 'done' : testWaiting ? 'pending' : 'action',
    `${tested ? 'The last test text was delivered.' : testWaiting ? 'The last test text was accepted and is waiting for its delivery report — accepted is not delivered.' : lt ? `The last test text ended ${lt.displayState}.` : 'No test text yet.'} Booking verify: ${vf.summary}`, `${SETUP}#test`);
  const open = steps.filter((x) => x.state !== 'done');
  S('summary', open.length === 0 ? 'done' : 'blocked', open.length === 0 ? 'Every step is verified for this scope.' : `Unresolved: ${open.map((x) => x.key).join(', ')}. A skipped approval or registration is never shown as completed.`, `${SETUP}#pm-summary`);
  const first = steps.find((x) => x.state !== 'done');
  return { steps, resumeAt: first ? first.key : 'summary' };
}

export class MessagingSetupCenter {
  constructor(private readonly db: NonNullable<AppDatabase>, private readonly readiness: Pick<TenantMessagingReadinessService, 'readiness' | 'healthCheck'>) {}

  private async tz(tenantId: string, branchId: string | null): Promise<string> {
    const r: any = (await sql`select coalesce(
        (select timezone from branches where tenant_id = ${tenantId} and id = ${branchId && UUID.test(branchId) ? branchId : null}::uuid),
        (select timezone from branches where tenant_id = ${tenantId} order by created_at, id limit 1), 'America/New_York') as tz`.execute(this.db)).rows[0];
    return String(r?.tz || 'America/New_York');
  }

  /** delivery evidence for the scope (the tenant's tests + customer texts; a branch scope narrows to that branch's rows) */
  async deliveryEvidence(tenantId: string, branchId: string | null): Promise<DeliveryEvidence> {
    const br = branchId && UUID.test(branchId) ? branchId : null;
    const t: any = (await sql`select
        (select last_verified_at from tenant_messaging_webhook_activity w where w.tenant_id = ${tenantId} and w.webhook_kind = 'status') as status_last,
        (select count(*)::int from sms_test_events e where e.tenant_id = ${tenantId} and (${br}::uuid is null or e.branch_id = ${br}::uuid)
           and e.status in ('sending','accepted','sent') and e.created_at < now() - interval '2 hours' and e.created_at > now() - interval '7 days') as tests_waiting,
        (select count(*)::int from sms_test_events e where e.tenant_id = ${tenantId} and (${br}::uuid is null or e.branch_id = ${br}::uuid)
           and e.status in ('failed','undelivered','rejected') and e.status_updated_at > now() - interval '24 hours') as tests_failed,
        (select count(*)::int from notifications n where n.tenant_id = ${tenantId} and n.channel = 'sms' and (${br}::uuid is null or n.branch_id = ${br}::uuid)
           and n.status = 'failed' and n.created_at > now() - interval '24 hours') as sms_failed,
        (select count(*)::int from notifications n where n.tenant_id = ${tenantId} and n.channel = 'sms' and (${br}::uuid is null or n.branch_id = ${br}::uuid)
           and n.status = 'sent' and n.created_at < now() - interval '2 hours' and n.created_at > now() - interval '7 days') as sms_waiting`.execute(this.db)).rows[0] ?? {};
    return { statusCallbackUrl: !!String(process.env.TWILIO_STATUS_CALLBACK_URL ?? '').trim(), lastStatusEventAt: iso(t.status_last),
      waitingOver2h: N(t.tests_waiting) + N(t.sms_waiting), failedTests24h: N(t.tests_failed), failedSms24h: N(t.sms_failed), awaitingReports: N(t.sms_waiting) };
  }

  /** the last scheduled (nightly) check of this salon + whether the schedule is on */
  private async schedule(tenantId: string) {
    const r: any = (await sql`select max(h.checked_at) filter (where h.trigger_kind = 'scheduled') as last_scheduled, max(h.checked_at) as last_any
      from tenant_messaging_health_checks h where h.tenant_id = ${tenantId}`.execute(this.db)).rows[0] ?? {};
    return { enabled: healthScheduleEnabled(), lastScheduledAt: iso(r.last_scheduled), lastCheckAt: iso(r.last_any), runsAt: 'nightly, 02:00–05:00 salon time', mode: 'read-only (never sends, buys, registers or changes credentials)' };
  }

  async overview(ctx: SetupCtx, branchId: string | null, allowed: string[] | null) {
    // Nov 4 2026 (live IDOR run): another salon's branch id crashed the readiness read (500) — it is simply not found here
    if (branchId && !(await sql<any>`select 1 from branches where tenant_id = ${ctx.tenantId} and id = ${branchId}::uuid`.execute(this.db)).rows.length) {
      throw withCode(new HttpException({ code: 'BRANCH_NOT_FOUND', message: 'Unknown branch.' }, HttpStatus.NOT_FOUND), 'BRANCH_NOT_FOUND');
    }
    const r = await this.readiness.readiness(ctx.tenantId, branchId, allowed);
    const d = await this.deliveryEvidence(ctx.tenantId, branchId);
    const parts = sixParts(r, d);
    const wizard = wizardSteps(r, parts);
    const worst = (['failed', 'attention_required', 'unknown', 'pending'] as PartState[]).find((s) => parts.some((p) => p.state === s)) ?? 'ready';
    return { generatedAt: new Date().toISOString(), scope: { branchId: r.scope.branchId, branchName: r.scope.branchName, source: r.source }, overall: worst, parts, delivery: d, wizard,
      schedule: await this.schedule(ctx.tenantId), lastTest: r.lastTest,
      // Phone & Messaging 12: what STOP / unsubscribe does to each message type, with this salon's 30-day evidence (salon-wide)
      consentBoundary: await consentBoundary(this.db, ctx.tenantId),
      note: 'Each part is judged on its own evidence. A Connected account does not prove carrier approval, inbound routing or delivery.' };
  }

  /** §13: every branch the actor may act for, with the sender it would actually use */
  async branches(ctx: SetupCtx, allowed: string[] | null) {
    const base = await this.readiness.readiness(ctx.tenantId, null, allowed);
    const out = [];
    for (const b of base.scope.authorizedBranches.slice(0, 50)) {
      const r = await this.readiness.readiness(ctx.tenantId, b.branchId, allowed);
      const parts = sixParts(r, await this.deliveryEvidence(ctx.tenantId, b.branchId));
      out.push({ branchId: b.branchId, name: b.name, source: b.source, inherits: b.source !== 'branch_override', accountSidMasked: r.account.accountSidMasked,
        sender: r.sender.number, senderType: r.sender.senderType, registration: parts.find((p) => p.key === 'registration')!.state,
        parts: parts.map((p) => ({ key: p.key, state: p.state })), lastCheckedAt: r.account.lastCheckedAt });
    }
    return { salonDefault: { accountSidMasked: base.account.accountSidMasked, sender: base.sender.number, senderType: base.sender.senderType, source: base.source },
      branches: out, rule: 'Platform prohibition > salon setting > a branch\'s own Twilio > the salon default > Setup Required. A branch without its own Twilio inherits the salon default; changing it never rewrites past messages.' };
  }

  // ── §14–§16 activity ───────────────────────────────────────────────────────────────────────────────────────────────
  private window(tz: string, f: ActivityFilters) {
    const preset = (f.preset || 'all') as (typeof PRESETS)[number];
    if (!PRESETS.includes(preset)) bad('Unknown date preset.');
    if (preset === 'all') return null;
    const today = sql`(now() at time zone ${tz})::date`;
    if (preset === 'custom') {
      if (!f.from || !f.to || !DAY.test(f.from) || !DAY.test(f.to)) bad('Choose both a From and a To date.');
      if (f.from! > f.to!) bad('The From date must be on or before the To date.');
      return { start: sql`(${f.from}::date)::timestamp at time zone ${tz}`, end: sql`((${f.to}::date) + 1)::timestamp at time zone ${tz}` };
    }
    const startDay = preset === 'today' ? today : preset === 'week' ? sql`date_trunc('week', ${today})::date` : preset === 'month' ? sql`date_trunc('month', ${today})::date` : sql`date_trunc('year', ${today})::date`;
    return { start: sql`(${startDay})::timestamp at time zone ${tz}`, end: sql`((${today}) + 1)::timestamp at time zone ${tz}` };
  }
  private async period(tz: string, f: ActivityFilters) {
    const preset = (f.preset || 'all') as (typeof PRESETS)[number];
    const r: any = (await sql`select to_char(d, 'YYYY-MM-DD') as today, to_char(date_trunc('week', d), 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', d), 'YYYY-MM-DD') as mo, to_char(date_trunc('year', d), 'YYYY-MM-DD') as yr from (select (now() at time zone ${tz})::date as d) x`.execute(this.db)).rows[0];
    const from = preset === 'custom' ? f.from! : preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : preset === 'year' ? r.yr : null;
    return { preset, from, to: preset === 'custom' ? f.to! : preset === 'all' ? null : r.today, tz, today: String(r.today) };
  }

  /** one union of the four real record types, tenant-scoped in EVERY branch; no secret column is selected */
  private union(tenantId: string, allowed: string[] | null) {
    const scopeOk = (col: ReturnType<typeof sql.ref>) => allowed ? sql`(${col} is null or ${col} = any(${allowed}::uuid[]))` : sql`true`;
    return sql`(
      select 'test_sms'::text as kind, e.id, e.branch_id, e.created_at, e.status_updated_at as updated_at, e.delivered_at,
        case when e.status = 'delivered' then 'ok' when e.status in ('failed','undelivered','rejected') then 'failed' else 'pending' end as state,
        e.status as raw_status, e.sender as number, e.destination_masked as recipient, right(coalesce(e.provider_message_sid, ''), 6) as provider_ref,
        e.error_code as reason, e.created_by_user_id as actor_id, coalesce(e.config_source, '') as config_source, coalesce(e.account_sid_last4, '') as account_last4
      from sms_test_events e where e.tenant_id = ${tenantId} and ${scopeOk(sql.ref('e.branch_id'))}
      union all
      select 'health_check', h.id, h.branch_id, h.checked_at, h.checked_at, null::timestamptz,
        case when h.account_state = 'connected' and coalesce(h.sender_state, 'assigned') = 'assigned' then 'ok' when h.account_state = 'not_configured' then 'pending' else 'failed' end,
        h.account_state, h.sender_number, null::text, null::text, coalesce(h.account_reason_code, h.verify_reason_code), h.checked_by_user_id, h.config_source, h.trigger_kind
      from tenant_messaging_health_checks h where h.tenant_id = ${tenantId} and ${scopeOk(sql.ref('h.branch_id'))}
      union all
      select 'registration_check', s.id, null::uuid, s.started_at, coalesce(s.finished_at, s.started_at), null::timestamptz,
        case when s.outcome = 'ok' then 'ok' when s.outcome = 'running' then 'pending' else 'failed' end,
        s.outcome, null::text, null::text, null::text, s.error_class, s.requested_by_user_id, coalesce(s.account_source, ''), s.trigger_kind
      from tenant_messaging_registration_sync_runs s where s.tenant_id = ${tenantId}
      union all
      select 'number_purchase', q.id, null::uuid, q.created_at, coalesce(q.consumed_at, q.created_at), null::timestamptz,
        case when q.result_status = 'purchased' then 'ok' when q.result_status = 'failed' or (q.result_status is null and q.expires_at < now()) then 'failed' else 'pending' end,
        coalesce(q.result_status, case when q.expires_at < now() then 'expired' else 'quoted' end), q.phone_number, null::text, null::text, q.result_error_code, q.created_by_user_id,
        case when q.own_account then 'own_account' else 'platform' end, coalesce(q.price_amount || ' ' || coalesce(q.price_unit, ''), '')
      from tenant_number_purchase_quotes q where q.tenant_id = ${tenantId}
    ) a`;
  }

  async activity(ctx: SetupCtx, f: ActivityFilters, allowed: string[] | null) {
    const page = Math.max(1, Math.floor(Number(f.page ?? 1)) || 1);
    const ps = Number(f.pageSize ?? 10); const pageSize = [10, 20, 50].includes(ps) ? ps : 10;
    const basis = (f.basis || 'created') as ActivityBasis;
    if (!(ACTIVITY_BASES as readonly string[]).includes(basis)) bad('Unknown date basis.');
    const tz = await this.tz(ctx.tenantId, ctx.branchId);
    const win = this.window(tz, f);
    const parts = [sql`true`];
    const q = (f.q ?? '').trim().slice(0, 100);
    if (q) {
      const ors = [sql`coalesce(a.number, '') ilike ${like(q)}`, sql`coalesce(a.reason, '') ilike ${like(q)}`, sql`a.raw_status ilike ${like(q)}`];
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 4) ors.push(sql`coalesce(a.recipient, '') like ${'%' + digits.slice(-4)}`, sql`regexp_replace(coalesce(a.number, ''), '[^0-9]', '', 'g') like ${like(digits)}`);
      if (/^(SM|MM)?[0-9a-f]{4,34}$/i.test(q)) ors.push(sql`a.provider_ref <> '' and ${q.toLowerCase()} like '%' || lower(a.provider_ref)`);
      if (UUID.test(q)) ors.push(sql`a.id = ${q.toLowerCase()}::uuid`);
      else if (/^[0-9a-f]{6,}$/i.test(q)) ors.push(sql`a.id::text like ${q.toLowerCase() + '%'}`);
      parts.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    if (f.kind) { if (!(ACTIVITY_KINDS as readonly string[]).includes(f.kind)) bad('Unknown record type.'); parts.push(sql`a.kind = ${f.kind}`); }
    if (f.state) { if (!(ACTIVITY_STATES as readonly string[]).includes(f.state)) bad('Unknown status filter.'); parts.push(sql`a.state = ${f.state}`); }
    if (f.branchId) {
      if (!UUID.test(f.branchId)) bad('Unknown location.');
      if (allowed && !allowed.includes(f.branchId)) throw withCode(new HttpException({ code: 'BRANCH_ACCESS_DENIED', message: 'You do not have access to this location.' }, HttpStatus.FORBIDDEN), 'BRANCH_ACCESS_DENIED');
      parts.push(sql`a.branch_id = ${f.branchId}::uuid`);
    }
    const col = basis === 'updated' ? sql`a.updated_at` : basis === 'delivered' ? sql`a.delivered_at` : sql`a.created_at`;
    if (win) parts.push(sql`${col} >= ${win.start} and ${col} < ${win.end}`);
    const where = sql.join(parts, sql` and `);
    const base = this.union(ctx.tenantId, allowed);
    const total = N((await sql<any>`select count(*)::int as n from ${base} where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select a.*, b.name as branch_name from ${base} left join branches b on b.id = a.branch_id and b.tenant_id = ${ctx.tenantId}
      where ${where} order by a.created_at desc, a.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r) => this.row(r)), page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)), basis, period: await this.period(tz, f), order: 'newest_first' };
  }

  private row(r: any) {
    return { kind: String(r.kind) as ActivityKind, id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deliveredAt: iso(r.delivered_at), state: String(r.state), rawStatus: String(r.raw_status ?? ''),
      number: r.kind === 'number_purchase' || r.kind === 'test_sms' || r.kind === 'health_check' ? (r.number ?? null) : null,
      recipient: r.recipient ?? null, providerRef: r.provider_ref ? `…${r.provider_ref}` : null, reason: r.reason ? String(r.reason).slice(0, 80) : null,
      detail: r.kind === 'number_purchase' ? (r.account_last4 || null) : r.kind === 'health_check' || r.kind === 'registration_check' ? (r.account_last4 || null) : null };
  }

  async detail(ctx: SetupCtx, kind: string, id: string, allowed: string[] | null) {
    if (!(ACTIVITY_KINDS as readonly string[]).includes(kind)) bad('Unknown record type.');
    if (!UUID.test(id)) notFound();
    const base = this.union(ctx.tenantId, allowed);
    const r = (await sql<any>`select a.*, b.name as branch_name, coalesce(u.full_name, nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')) as actor_name
      from ${base} left join branches b on b.id = a.branch_id and b.tenant_id = ${ctx.tenantId}
      left join users u on u.id = a.actor_id and u.tenant_id = ${ctx.tenantId}
      where a.kind = ${kind} and a.id = ${id}::uuid limit 1`.execute(this.db)).rows[0];
    if (!r) notFound();
    const view = this.row(r);
    const extra: Record<string, unknown> = { actor: r.actor_name ?? (r.actor_id ? 'staff member' : 'system'), configSource: r.config_source || null };
    if (kind === 'test_sms') {
      const t = (await sql<any>`select warning_codes, sender_kind from sms_test_events where tenant_id = ${ctx.tenantId} and id = ${id}::uuid`.execute(this.db)).rows[0];
      Object.assign(extra, { warnings: t?.warning_codes ?? [], senderKind: t?.sender_kind ?? null, accountLast4: r.account_last4 || null,
        meaning: view.rawStatus === 'delivered' ? 'The carrier reported delivery (signed callback).' : ['accepted', 'sent', 'sending'].includes(view.rawStatus) ? 'Twilio accepted the text — accepted is not delivered; waiting for the signed delivery report.' : 'The text was not delivered; see the reason code.' });
    } else if (kind === 'health_check') {
      const h = (await sql<any>`select account_state, account_reason_code, account_type, auth_mode, api_key_state, sender_state, sender_capabilities, inbound_url_state, verify_state, verify_reason_code, duration_ms
        from tenant_messaging_health_checks where tenant_id = ${ctx.tenantId} and id = ${id}::uuid`.execute(this.db)).rows[0];
      Object.assign(extra, { trigger: r.account_last4 || null, checks: h ? { account: h.account_state, accountReason: h.account_reason_code, accountType: h.account_type, authMode: h.auth_mode, apiKey: h.api_key_state,
        sender: h.sender_state, capabilities: h.sender_capabilities, inboundUrl: h.inbound_url_state, verify: h.verify_state, verifyReason: h.verify_reason_code, durationMs: h.duration_ms } : null });
    } else if (kind === 'registration_check') {
      const s = (await sql<any>`select item_kind, normalized_state, raw_status, verified, error_class, checked_at from tenant_messaging_registration_snapshots
        where tenant_id = ${ctx.tenantId} and run_id = ${id}::uuid order by item_kind`.execute(this.db)).rows;
      Object.assign(extra, { trigger: r.account_last4 || null, items: s.map((x) => ({ item: String(x.item_kind), state: String(x.normalized_state), providerStatus: x.raw_status ?? null, verified: !!x.verified, errorClass: x.error_class ?? null, checkedAt: iso(x.checked_at) })) });
    } else {
      const qq = (await sql<any>`select price_amount, price_unit, capabilities, own_account, expires_at, consumed_at, result_status, result_number from tenant_number_purchase_quotes
        where tenant_id = ${ctx.tenantId} and id = ${id}::uuid`.execute(this.db)).rows[0];
      Object.assign(extra, { quotedPrice: qq?.price_amount ? `${qq.price_amount} ${qq.price_unit ?? ''}`.trim() : null, capabilities: qq?.capabilities ?? null, ownAccount: !!qq?.own_account,
        expiresAt: iso(qq?.expires_at), consumedAt: iso(qq?.consumed_at), resultNumber: qq?.result_number ? last4(qq.result_number) : null,
        meaning: 'A quote is only a review; a number is bought only with its confirmation and a password step-up.' });
    }
    return { ...view, ...extra };
  }
}

// ── §11 the controlled nightly run ──────────────────────────────────────────────────────────────────────────────────
export const MESSAGING_HEALTH_JOB = 'messaging.health.scheduled';
export function healthScheduleEnabled(): boolean { return /^(1|true|on|yes)$/i.test(String(process.env.MESSAGING_HEALTH_SCHEDULE_ENABLED ?? '')); }

/**
 * CROSS-TENANT BY DESIGN (a platform sweep that enqueues one job PER salon, each carrying its own tenant id): active
 * salons with a configured Twilio whose salon-local time is 02:00–05:00 and whose last scheduled check is older than
 * 20 hours. The idempotency key is salon + salon-local date, so the nightly run happens at most once per salon per night.
 */
export async function dispatchScheduledHealth(db: Kysely<any>, limit = 500): Promise<{ enqueued: number; duplicates: number }> {
  const due: any = await sql`
    select c.tenant_id::text as tenant_id, to_char((now() at time zone z.tz)::date, 'YYYY-MM-DD') as local_day
      from (select distinct tenant_id from tenant_messaging_credentials where provider = 'twilio' and status = 'configured' and branch_id is null) c
      join tenants t on t.id = c.tenant_id and t.status = 'active'
      cross join lateral (select coalesce((select timezone from branches b where b.tenant_id = c.tenant_id order by b.created_at, b.id limit 1), 'America/New_York') as tz) z
     where extract(hour from (now() at time zone z.tz)) between 2 and 4
       and not exists (select 1 from tenant_messaging_health_checks h where h.tenant_id = c.tenant_id and h.trigger_kind = 'scheduled' and h.checked_at > now() - interval '20 hours')
     limit ${limit}`.execute(db);
  let enqueued = 0, duplicates = 0;
  for (const r of due.rows ?? []) {
    const key = `${r.tenant_id}:${r.local_day}`;
    const j = await enqueueJob(db, { jobClass: 'standard', jobType: MESSAGING_HEALTH_JOB, tenantId: String(r.tenant_id), payload: { night: key }, priority: 3, maxAttempts: 3, idempotencyKey: `msghealth:${key}` });
    if (j.duplicate) duplicates++; else enqueued++;
  }
  return { enqueued, duplicates };
}

/** the job: one salon's read-only check, then de-duplicated owner alerts for the parts that failed */
export async function runScheduledHealthJob(db: Kysely<any>, svc: Pick<TenantMessagingReadinessService, 'readiness' | 'healthCheck'>, tenantId: string | null, payload: Record<string, unknown>) {
  if (!tenantId || !UUID.test(tenantId)) throw withCode(new PermanentJobError('a messaging health job needs its tenant'), 'VALIDATION_FAILED');
  if (!String(payload.night ?? '').startsWith(`${tenantId}:`)) throw withCode(new PermanentJobError('a messaging health job belongs to its own tenant'), 'VALIDATION_FAILED');
  const r = await svc.healthCheck({ userId: '', tenantId }, null, null, { trigger: 'scheduled' });
  const center = new MessagingSetupCenter(db as NonNullable<AppDatabase>, svc);
  const parts = sixParts(r, await center.deliveryEvidence(tenantId, null));
  return raiseSetupAlerts(db, tenantId, parts);
}

/** ONE open alert per failing part (dedupeKey sms_setup:<part>); a repeat updates it; a 'ready' part opens nothing.
 *  Never sends anything: the alert lives in the owner's in-app incidents list. */
export async function raiseSetupAlerts(db: Kysely<any>, tenantId: string, parts: ReadinessPart[]): Promise<{ opened: number; updated: number }> {
  let opened = 0, updated = 0;
  for (const p of parts) {
    if (p.state !== 'failed' && p.state !== 'attention_required') continue;
    const dedupeKey = `sms_setup:${p.key}`;
    const severity = p.state === 'failed' ? 'critical' : 'warning';
    const title = `Text messaging setup: ${p.key.replace('_', ' ')} needs attention`;
    const body = `${p.summary}${p.nextAction ? ` Next: ${p.nextAction}` : ''}`;
    const open = (await sql<any>`select id, metadata from owner_alerts where tenant_id = ${tenantId} and category = 'messaging_failure' and metadata->>'dedupeKey' = ${dedupeKey}
      and status in ('new', 'acknowledged', 'in_progress') limit 1`.execute(db)).rows[0];
    if (open) {
      const m = open.metadata ?? {};
      await sql`update owner_alerts set metadata = ${JSON.stringify({ ...m, detections: N(m.detections) + 1, lastDetectedAt: new Date().toISOString(), state: p.state })}::jsonb, body = ${body}, updated_at = now()
        where id = ${open.id} and tenant_id = ${tenantId}`.execute(db);
      updated++; continue;
    }
    const meta = { dedupeKey, rule: 'sms_setup', part: p.key, state: p.state, detections: 1, source: 'messaging_setup', fixLink: p.fixLink };
    const ins = await sql<any>`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
      values (${tenantId}, null, 'messaging_failure', ${severity}, 'new', ${title}, ${body}, ${JSON.stringify(meta)}::jsonb, 'all')
      on conflict (tenant_id, (metadata->>'dedupeKey')) where category = 'messaging_failure' and status in ('new', 'acknowledged', 'in_progress') do nothing returning id`.execute(db);
    if (ins.rows.length) opened++; else updated++;
  }
  return { opened, updated };
}
