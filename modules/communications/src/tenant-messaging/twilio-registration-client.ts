// twilio-registration-client.ts — PM-03 / PM-04 (Four-Module Completion Guide §7, Oct 30 2026): READ-ONLY provider
// reads of a salon's carrier registration, for the account the salon's registration lives on:
//   • 10DLC brand            GET messaging.twilio.com/v1/a2p/BrandRegistrations/{BN…}
//   • A2P campaign           GET messaging.twilio.com/v1/Services/{MG…}/Compliance/Usa2p   (us_app_to_person)
//   • Messaging Service      GET messaging.twilio.com/v1/Services/{MG…}
//   • number association     GET messaging.twilio.com/v1/Services/{MG…}/PhoneNumbers
//   • toll-free verification GET messaging.twilio.com/v1/Tollfree/Verifications?TollfreePhoneNumberSid={PN…}
//   • the sender's PN sid    GET api.twilio.com/2010-04-01/Accounts/{AC…}/IncomingPhoneNumbers.json?PhoneNumber=
// Nothing here submits, resubmits, edits or pays for anything. The HTTP client is a PARAMETER (the sync service holds it
// as an injectable property; tests pass a fake), so a test never reaches Twilio.
//
// Every answer is reduced to a SAFE shape: provider ids, the provider's status token (A-Z/_ only, ≤ 40 chars), a
// timestamp, and — for failures — an error CLASS (auth / not_found / rate_limited / provider_unavailable / network /
// unexpected). Provider message text is never kept (it can carry anything); a rejection reason is kept only as its
// numeric error code and a short, digit-scrubbed phrase.
export type RegHttp = typeof fetch;
export interface RegAuth { accountSid: string; user: string; pass: string }
export type ErrorClass = 'auth' | 'not_found' | 'rate_limited' | 'provider_unavailable' | 'network' | 'unexpected';
export type ReadResult<T> = { ok: true; value: T } | { ok: false; errorClass: ErrorClass; httpStatus: number };

const MSG = 'https://messaging.twilio.com/v1';
const API = 'https://api.twilio.com/2010-04-01';
const basic = (a: RegAuth) => 'Basic ' + Buffer.from(`${a.user}:${a.pass}`).toString('base64');
/** one structured line, no payload (the URL holds provider ids; an error text may hold anything) */
const noteNetwork = (e: unknown): void => { process.stderr.write(JSON.stringify({ level: 'warn', msg: 'twilio registration read unreachable', code: (e as { code?: unknown } | null)?.code ?? null }) + '\n'); };

export function classOf(status: number): ErrorClass {
  if (status === 0) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'unexpected';
}

async function read(http: RegHttp, url: string, a: RegAuth): Promise<ReadResult<any>> {
  let res: Response;
  try { res = await http(url, { method: 'GET', headers: { Authorization: basic(a) } }); }
  catch (e) { noteNetwork(e); return { ok: false, errorClass: 'network', httpStatus: 0 }; }
  if (res.status !== 200) return { ok: false, errorClass: classOf(res.status), httpStatus: res.status };
  try { return { ok: true, value: await res.json() }; }
  catch (e) { noteNetwork(e); return { ok: false, errorClass: 'unexpected', httpStatus: res.status }; }
}

/** the provider's status token, sanitized (never free text) */
export const token = (v: unknown): string | null => { const s = String(v ?? '').toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 40); return s || null; };
const sid = (v: unknown, prefix: string): string | null => { const s = String(v ?? ''); return new RegExp(`^${prefix}[0-9a-fA-F]{32}$`).test(s) ? s : null; };
const isoOf = (v: unknown): string | null => { if (!v) return null; const d = new Date(String(v)); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
/** a provider rejection phrase, kept short and with every digit run removed (never a phone number) */
export const safePhrase = (v: unknown): string | null => { const s = String(v ?? '').replace(/[0-9][0-9 ()+.-]{3,}/g, '').replace(/[^A-Za-z ,.'/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); return s || null; };

export interface BrandRead { sid: string | null; status: string | null; failureReason: string | null; createdAt: string | null }
export async function readBrand(http: RegHttp, a: RegAuth, brandSid: string): Promise<ReadResult<BrandRead>> {
  const r = await read(http, `${MSG}/a2p/BrandRegistrations/${encodeURIComponent(brandSid)}`, a);
  if (!r.ok) return r;
  const b = r.value ?? {};
  return { ok: true, value: { sid: sid(b.sid, 'BN'), status: token(b.status), failureReason: safePhrase(Array.isArray(b.errors) ? b.errors[0]?.description : b.failure_reason), createdAt: isoOf(b.date_created) } };
}

export interface CampaignRead { sid: string | null; status: string | null; createdAt: string | null; found: boolean }
export async function readCampaign(http: RegHttp, a: RegAuth, messagingServiceSid: string, campaignSid: string | null): Promise<ReadResult<CampaignRead>> {
  const r = await read(http, `${MSG}/Services/${encodeURIComponent(messagingServiceSid)}/Compliance/Usa2p`, a);
  if (!r.ok) return r;
  const list: any[] = Array.isArray(r.value?.compliance) ? r.value.compliance : r.value?.sid ? [r.value] : [];
  const c = (campaignSid ? list.find((x) => String(x?.sid ?? '') === campaignSid) : null) ?? list[0] ?? null;
  if (!c) return { ok: true, value: { sid: null, status: null, createdAt: null, found: false } };
  return { ok: true, value: { sid: sid(c.sid, 'QE'), status: token(c.campaign_status ?? c.status), createdAt: isoOf(c.date_created), found: true } };
}

export interface ServiceRead { sid: string | null; a2pRegistered: boolean | null }
export async function readMessagingService(http: RegHttp, a: RegAuth, messagingServiceSid: string): Promise<ReadResult<ServiceRead>> {
  const r = await read(http, `${MSG}/Services/${encodeURIComponent(messagingServiceSid)}`, a);
  if (!r.ok) return r;
  const v = r.value?.us_app_to_person_registered;
  return { ok: true, value: { sid: sid(r.value?.sid, 'MG'), a2pRegistered: typeof v === 'boolean' ? v : null } };
}

export async function readServiceNumbers(http: RegHttp, a: RegAuth, messagingServiceSid: string): Promise<ReadResult<{ numbers: string[] }>> {
  const r = await read(http, `${MSG}/Services/${encodeURIComponent(messagingServiceSid)}/PhoneNumbers?PageSize=100`, a);
  if (!r.ok) return r;
  const list: any[] = Array.isArray(r.value?.phone_numbers) ? r.value.phone_numbers : [];
  return { ok: true, value: { numbers: list.map((x) => String(x?.phone_number ?? '')).filter((n) => /^\+[1-9][0-9]{6,15}$/.test(n)) } };
}

/** the sender's IncomingPhoneNumber sid on this account (null = not on the account) */
export async function readNumberSid(http: RegHttp, a: RegAuth, phoneNumber: string): Promise<ReadResult<{ sid: string | null }>> {
  const r = await read(http, `${API}/Accounts/${encodeURIComponent(a.accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, a);
  if (!r.ok) return r;
  const n = (r.value?.incoming_phone_numbers ?? []).find((x: any) => String(x?.phone_number ?? '') === phoneNumber);
  return { ok: true, value: { sid: n ? sid(n.sid, 'PN') : null } };
}

export interface TollfreeRead { sid: string | null; status: string | null; submittedAt: string | null; updatedAt: string | null; rejectionCode: string | null; rejectionReason: string | null; editAllowed: boolean | null; found: boolean }
export async function readTollfreeVerification(http: RegHttp, a: RegAuth, numberSid: string): Promise<ReadResult<TollfreeRead>> {
  const r = await read(http, `${MSG}/Tollfree/Verifications?TollfreePhoneNumberSid=${encodeURIComponent(numberSid)}&PageSize=20`, a);
  if (!r.ok) return r;
  const list: any[] = Array.isArray(r.value?.verifications) ? r.value.verifications : [];
  // the newest verification for this number decides (a resubmission supersedes a rejection)
  const v = list.filter((x) => !x?.tollfree_phone_number_sid || String(x.tollfree_phone_number_sid) === numberSid)
    .sort((x, y) => String(y?.date_created ?? '').localeCompare(String(x?.date_created ?? '')))[0];
  if (!v) return { ok: true, value: { sid: null, status: null, submittedAt: null, updatedAt: null, rejectionCode: null, rejectionReason: null, editAllowed: null, found: false } };
  const code = v.error_code != null && /^[0-9]{3,6}$/.test(String(v.error_code)) ? String(v.error_code) : null;
  return { ok: true, value: { sid: sid(v.sid, 'HH'), status: token(v.status), submittedAt: isoOf(v.date_created), updatedAt: isoOf(v.date_updated), rejectionCode: code,
    rejectionReason: safePhrase(v.rejection_reason), editAllowed: typeof v.edit_allowed === 'boolean' ? v.edit_allowed : null, found: true } };
}
