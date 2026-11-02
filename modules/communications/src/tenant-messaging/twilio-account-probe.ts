// twilio-account-probe.ts — the authenticated provider checks behind "Twilio Connection", "Assigned Number" and the
// number purchase quote (Phone & Messaging guide §5/§6/§12). Read-only GETs: nothing here sends, buys or registers.
//
// Every function takes the HTTP client as a parameter — the services hold it as an injectable property and tests pass a
// fake, so a test never reaches Twilio. Results carry SAFE reason codes only: no provider exception text, no SID/token
// pair, no phone number other than the salon's own sender.
//
// API keys: a Standard API key may not read the Accounts resource itself, so an API key is proven against the account's
// IncomingPhoneNumbers list (PageSize=1) — a read the key needs anyway to send from this account's numbers.

export type ProbeHttp = typeof fetch;
export interface ProbeAuth { accountSid: string; user: string; pass: string }
export type AccountProbeState = 'connected' | 'invalid' | 'unreachable' | 'error';
/** OPS-01: an API key that authenticated but may not read this resource (a Restricted key without that permission) */
export type ApiKeyProbeState = AccountProbeState | 'limited';
export interface AccountProbe { state: AccountProbeState; reasonCode: string | null; accountStatus: string | null; accountType: string | null }
export interface Capabilities { sms: boolean; voice: boolean; mms: boolean }
export interface NumberProbe { state: 'assigned' | 'not_owned' | 'unknown'; reasonCode: string | null; capabilities: Capabilities | null; smsUrl: string | null; statusCallback: string | null; sid?: string | null }

const API = 'https://api.twilio.com/2010-04-01';
const basic = (a: ProbeAuth) => 'Basic ' + Buffer.from(`${a.user}:${a.pass}`).toString('base64');

async function get(http: ProbeHttp, url: string, a: ProbeAuth): Promise<{ status: number; body: any } | { status: 0; body: null }> {
  try {
    const res = await http(url, { method: 'GET', headers: { Authorization: basic(a) } });
    let body: any = null;
    try { body = await res.json(); } catch (e) { body = { unparsed: (e as Error)?.name ?? 'parse' }; }   // a non-JSON body is judged by its status alone
    return { status: res.status, body };
  } catch (e) {
    noteNetwork(e);
    return { status: 0, body: null };
  }
}
/** one structured line, no payload (the URL holds an account SID; the error text may hold anything) */
function noteNetwork(e: unknown): void { process.stderr.write(JSON.stringify({ level: 'warn', msg: 'twilio probe unreachable', code: (e as { code?: unknown } | null)?.code ?? null }) + '\n'); }

/** the provider's answer → a safe state + code (never the provider's message) */
function failure(status: number, apiKey: boolean): { state: AccountProbeState; reasonCode: string } {
  if (status === 0) return { state: 'unreachable', reasonCode: 'PROVIDER_UNREACHABLE' };
  if (status === 401 || status === 403) return { state: 'invalid', reasonCode: apiKey ? 'TWILIO_API_KEY_REJECTED' : 'TWILIO_AUTH_FAILED' };
  if (status === 404) return { state: 'invalid', reasonCode: 'TWILIO_ACCOUNT_NOT_FOUND' };
  if (status === 429) return { state: 'unreachable', reasonCode: 'PROVIDER_RATE_LIMITED' };
  if (status >= 500) return { state: 'unreachable', reasonCode: 'PROVIDER_ERROR' };
  return { state: 'error', reasonCode: 'PROVIDER_UNEXPECTED_RESPONSE' };
}

/** Is this Account SID + auth token a working, active account? (GET /Accounts/{sid}.json) */
export async function probeAccount(http: ProbeHttp, a: ProbeAuth): Promise<AccountProbe> {
  const r = await get(http, `${API}/Accounts/${encodeURIComponent(a.accountSid)}.json`, a);
  if (r.status === 200) {
    const st = String(r.body?.status ?? '').toLowerCase() || null;
    const type = r.body?.type ? String(r.body.type).slice(0, 20) : null;
    if (st === 'suspended') return { state: 'invalid', reasonCode: 'TWILIO_ACCOUNT_SUSPENDED', accountStatus: st, accountType: type };
    if (st === 'closed') return { state: 'invalid', reasonCode: 'TWILIO_ACCOUNT_CLOSED', accountStatus: st, accountType: type };
    if (r.body?.sid && String(r.body.sid) !== a.accountSid) return { state: 'invalid', reasonCode: 'TWILIO_WRONG_ACCOUNT', accountStatus: st, accountType: type };
    return { state: 'connected', reasonCode: type === 'Trial' ? 'TWILIO_TRIAL_ACCOUNT' : null, accountStatus: st, accountType: type };
  }
  return { ...failure(r.status, false), accountStatus: null, accountType: null };
}

/**
 * Does this API key SID + secret authenticate against THIS account? OPS-01 (guide §7.3 / §16): Standard OR Restricted
 * keys may work. 401 = the key/secret pair is rejected. 403 (or Twilio error 70051/20403) = the key AUTHENTICATED but is
 * not permitted to read the account's numbers — a Restricted key without that scope. That is reported as "limited"
 * (insufficient scope for this check; sending may still be permitted), never as a rejected key.
 */
export async function probeApiKey(http: ProbeHttp, accountSid: string, keySid: string, keySecret: string): Promise<{ state: ApiKeyProbeState; reasonCode: string | null }> {
  const a = { accountSid, user: keySid, pass: keySecret };
  const r = await get(http, `${API}/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=1`, a);
  if (r.status === 200) return { state: 'connected', reasonCode: null };
  const code = Number((r.body as { code?: unknown } | null)?.code ?? 0);
  if (r.status === 403 || code === 70051 || code === 20403) return { state: 'limited', reasonCode: 'API_KEY_SCOPE_INSUFFICIENT' };
  return failure(r.status, true);
}

/** Is this number on this account, and what can it do? (GET /IncomingPhoneNumbers.json?PhoneNumber=…) */
export async function lookupOwnedNumber(http: ProbeHttp, a: ProbeAuth, phoneNumber: string): Promise<NumberProbe> {
  const r = await get(http, `${API}/Accounts/${encodeURIComponent(a.accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, a);
  if (r.status !== 200) return { state: 'unknown', reasonCode: failure(r.status, a.user !== a.accountSid).reasonCode, capabilities: null, smsUrl: null, statusCallback: null };
  const n = (r.body?.incoming_phone_numbers ?? []).find((x: any) => String(x?.phone_number ?? '') === phoneNumber);
  if (!n) return { state: 'not_owned', reasonCode: 'TWILIO_NUMBER_NOT_ON_ACCOUNT', capabilities: null, smsUrl: null, statusCallback: null };
  return { state: 'assigned', reasonCode: null, capabilities: capabilitiesOf(n.capabilities), smsUrl: n.sms_url ? String(n.sms_url) : null, statusCallback: n.status_callback ? String(n.status_callback) : null,
    sid: /^PN[0-9a-fA-F]{32}$/.test(String(n.sid ?? '')) ? String(n.sid) : null };
}

export function capabilitiesOf(c: any): Capabilities {
  return { sms: !!(c?.sms ?? c?.SMS), voice: !!(c?.voice ?? c?.Voice), mms: !!(c?.mms ?? c?.MMS) };
}

/**
 * The monthly price Twilio QUOTES for a local number in this country (Pricing API). null when the provider does not
 * return one — the UI then says "price not returned by provider". Never estimated, never hardcoded.
 */
export async function quoteLocalNumberPrice(http: ProbeHttp, a: ProbeAuth, country: string): Promise<{ amount: string; unit: string } | null> {
  const r = await get(http, `https://pricing.twilio.com/v1/PhoneNumbers/Countries/${encodeURIComponent(country.toUpperCase())}`, a);
  if (r.status !== 200) return null;
  const local = (r.body?.phone_number_prices ?? []).find((p: any) => String(p?.number_type ?? '').toLowerCase() === 'local');
  const amount = local?.current_price ?? local?.base_price;
  if (amount == null || !/^[0-9]+(\.[0-9]+)?$/.test(String(amount))) return null;
  const unit = String(r.body?.price_unit ?? '').toUpperCase();
  return unit ? { amount: String(amount), unit: unit.slice(0, 8) } : null;
}

/** Is this exact number still available to buy? (AvailablePhoneNumbers …/Local.json?Contains=) */
export async function availableNumber(http: ProbeHttp, a: ProbeAuth, country: string, phoneNumber: string): Promise<{ available: boolean; capabilities: Capabilities | null; reachable: boolean }> {
  const digits = phoneNumber.replace(/[^0-9]/g, '');
  const qs = new URLSearchParams({ Contains: digits.length > 10 ? digits.slice(-10) : digits, PageSize: '5' });
  const r = await get(http, `${API}/Accounts/${encodeURIComponent(a.accountSid)}/AvailablePhoneNumbers/${encodeURIComponent(country.toUpperCase())}/Local.json?${qs.toString()}`, a);
  if (r.status !== 200) return { available: false, capabilities: null, reachable: false };
  const n = (r.body?.available_phone_numbers ?? []).find((x: any) => String(x?.phone_number ?? '') === phoneNumber);
  return { available: !!n, capabilities: n ? capabilitiesOf(n.capabilities) : null, reachable: true };
}

/** US/CA toll-free prefixes: A2P 10DLC does not apply (toll-free verification is a separate registration). */
export function senderTypeOf(n: string | null | undefined): '10dlc' | 'toll_free' | 'short_code' | 'messaging_service' | 'unknown' {
  const v = String(n ?? '');
  if (/^MG[0-9a-fA-F]{32}$/.test(v)) return 'messaging_service';
  if (/^[0-9]{5,6}$/.test(v)) return 'short_code';
  if (/^\+1(800|833|844|855|866|877|888)[0-9]{7}$/.test(v)) return 'toll_free';
  if (/^\+1[2-9][0-9]{9}$/.test(v)) return '10dlc';
  return 'unknown';
}
