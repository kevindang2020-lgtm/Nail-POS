// messaging-health.ts — ONE way an authenticated provider check is run and recorded, shared by the Health Check action
// (tenant-messaging-readiness.service.ts) and the validate-before-save path (tenant-messaging-credentials.service.ts).
// The HTTP client is a parameter (tests pass a fake); the stored row holds states and safe codes, never a secret.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { probeVerifyService } from '@aipowersalon/notifications';
import { probeAccount, probeApiKey, lookupOwnedNumber, type ProbeHttp, type AccountProbe, type NumberProbe, type ApiKeyProbeState } from './twilio-account-probe';

export interface CheckCreds { accountSid: string; authToken: string; apiKeySid?: string | null; apiKeySecret?: string | null; fromNumber?: string | null; verifyServiceSid?: string | null }
export interface CheckResult {
  account: AccountProbe;
  authMode: 'auth_token' | 'api_key';
  apiKey: { state: ApiKeyProbeState | 'not_used' | 'missing_secret'; reasonCode: string | null };
  sender: NumberProbe | null;
  inboundUrlState: 'matches' | 'mismatch' | 'not_set' | 'unknown' | null;
  /** OPS-01: every registered number of the salon (≤ 10), its own inbound webhook URL compared with ours */
  numbersInbound: NumberInbound[];
  verify: { state: 'ok' | 'failed' | 'not_configured' | 'unknown'; reasonCode: string | null };
  durationMs: number;
}

/** the URL Twilio must POST inbound texts to (the same one a purchase wires) — null when the API base is not configured */
export function expectedInboundUrl(env: Record<string, string | undefined> = process.env): string | null {
  const base = String(env.PUBLIC_API_BASE_URL || env.APS_API_BASE || '').replace(/\/+$/, '');
  return base ? `${base}/webhooks/twilio/sms/inbound` : null;
}

/** Verify probe errors (plain English from @aipowersalon/notifications) → safe codes */
function verifyCode(error: string): string {
  if (/refused/i.test(error)) return 'TWILIO_VERIFY_AUTH_FAILED';
  if (/No Verify Service/i.test(error)) return 'TWILIO_VERIFY_SERVICE_NOT_FOUND';
  if (/not a Verify Service SID/i.test(error)) return 'TWILIO_VERIFY_SID_INVALID';
  if (/reach/i.test(error)) return 'PROVIDER_UNREACHABLE';
  return 'TWILIO_VERIFY_CHECK_FAILED';
}

export interface NumberInbound { number: string; state: 'matches' | 'mismatch' | 'not_set' | 'not_on_account' | 'unknown'; reasonCode: string | null }
const inboundOf = (smsUrl: string | null, expected: string | null): 'matches' | 'mismatch' | 'not_set' | 'unknown' =>
  !expected ? 'unknown' : !smsUrl ? 'not_set' : smsUrl.replace(/\/+$/, '') === expected ? 'matches' : 'mismatch';
const INBOUND_REASON: Record<string, string | null> = { matches: null, mismatch: 'INBOUND_URL_MISMATCH', not_set: 'INBOUND_URL_NOT_SET', not_on_account: 'TWILIO_NUMBER_NOT_ON_ACCOUNT', unknown: 'PUBLIC_API_BASE_URL_NOT_SET' };

export async function runProviderChecks(http: ProbeHttp, c: CheckCreds, opts: { checkVerify: boolean; expectedInbound: string | null; otherNumbers?: string[] }): Promise<CheckResult> {
  const t0 = Date.now();
  const auth = { accountSid: c.accountSid, user: c.accountSid, pass: c.authToken };
  const account = await probeAccount(http, auth);
  const ok = account.state === 'connected';
  let apiKey: CheckResult['apiKey'] = { state: 'not_used', reasonCode: null };
  if (c.apiKeySid && !c.apiKeySecret) apiKey = { state: 'missing_secret', reasonCode: 'API_KEY_SECRET_MISSING' };
  else if (c.apiKeySid && c.apiKeySecret) apiKey = ok ? await probeApiKey(http, c.accountSid, c.apiKeySid, c.apiKeySecret) : { state: 'unreachable', reasonCode: 'ACCOUNT_CHECK_FAILED_FIRST' };
  const sender = c.fromNumber && ok ? await lookupOwnedNumber(http, auth, c.fromNumber) : null;
  let inboundUrlState: CheckResult['inboundUrlState'] = null;
  if (sender?.state === 'assigned') inboundUrlState = inboundOf(sender.smsUrl, opts.expectedInbound);
  // OPS-01: each registered number's OWN inbound webhook (a salon can hold more than its sender), read-only, ≤ 10
  const numbersInbound: NumberInbound[] = [];
  if (sender && c.fromNumber) numbersInbound.push({ number: c.fromNumber, state: sender.state === 'assigned' ? inboundUrlState! : sender.state === 'not_owned' ? 'not_on_account' : 'unknown', reasonCode: null });
  for (const n of (opts.otherNumbers ?? []).filter((x) => x && x !== c.fromNumber).slice(0, 9)) {
    if (!ok) break;
    const p = await lookupOwnedNumber(http, auth, n);
    numbersInbound.push({ number: n, state: p.state === 'assigned' ? inboundOf(p.smsUrl, opts.expectedInbound) : p.state === 'not_owned' ? 'not_on_account' : 'unknown', reasonCode: null });
  }
  for (const x of numbersInbound) x.reasonCode = x.state === 'unknown' && opts.expectedInbound ? 'SENDER_CHECK_FAILED' : INBOUND_REASON[x.state] ?? null;
  let verify: CheckResult['verify'] = { state: 'not_configured', reasonCode: null };
  if (c.verifyServiceSid && opts.checkVerify) {
    if (!ok) verify = { state: 'unknown', reasonCode: 'ACCOUNT_CHECK_FAILED_FIRST' };
    else {
      const p = await probeVerifyService({ accountSid: c.accountSid, authToken: c.authToken, apiKeySid: c.apiKeySid ?? null, apiKeySecret: c.apiKeySecret ?? null }, c.verifyServiceSid, http);
      verify = p.ok ? { state: 'ok', reasonCode: null } : { state: 'failed', reasonCode: verifyCode(p.error) };
    }
  }
  return { account, authMode: c.apiKeySid && c.apiKeySecret ? 'api_key' : 'auth_token', apiKey, sender, inboundUrlState, numbersInbound, verify, durationMs: Date.now() - t0 };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Append one check row (append-only table). `db` may be a transaction. */
export async function recordHealthCheck(db: NonNullable<AppDatabase>, a: { tenantId: string; branchId: string | null; source: string; fingerprint: string | null; actorUserId: string | null; trigger: 'manual' | 'save' | 'scheduled'; fromNumber: string | null; result: CheckResult | null; notConfigured?: boolean; errorCode?: string }): Promise<void> {
  const r = a.result;
  const accountState = a.notConfigured ? 'not_configured' : a.errorCode ? 'error' : r!.account.state;
  const accountReason = a.notConfigured ? 'NO_CREDENTIALS' : a.errorCode ? a.errorCode : r!.account.reasonCode;
  const actor = a.actorUserId && UUID.test(a.actorUserId) ? a.actorUserId : null;
  await sql`INSERT INTO tenant_messaging_health_checks (tenant_id, branch_id, config_source, config_fingerprint, trigger_kind, account_state, account_reason_code,
      account_status, account_type, auth_mode, api_key_state, sender_number, sender_state, sender_capabilities, inbound_url_state, verify_state, verify_reason_code,
      duration_ms, checked_by_user_id, numbers_inbound, api_key_scope)
    VALUES (${a.tenantId}, ${a.branchId}, ${a.source}, ${a.fingerprint}, ${a.trigger}, ${accountState}, ${accountReason},
      ${r?.account.accountStatus ?? null}, ${r?.account.accountType ?? null}, ${r?.authMode ?? null}, ${r?.apiKey.state ?? null}, ${a.fromNumber}, ${r?.sender?.state ?? (a.fromNumber && r ? 'unknown' : null)},
      ${r?.sender?.capabilities ? JSON.stringify(r.sender.capabilities) : null}::jsonb, ${r?.inboundUrlState ?? null}, ${r?.verify.state ?? null}, ${r?.verify.reasonCode ?? null},
      ${r?.durationMs ?? null}, ${actor}, ${r?.numbersInbound?.length ? JSON.stringify(r.numbersInbound) : null}::jsonb,
      ${r ? (r.apiKey.state === 'limited' ? 'insufficient' : r.apiKey.state === 'connected' ? 'sufficient' : r.apiKey.state === 'not_used' ? null : 'unknown') : null})`.execute(db);
}
