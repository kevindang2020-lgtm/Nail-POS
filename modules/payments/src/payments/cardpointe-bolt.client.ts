// cardpointe-bolt.client.ts — Fiserv / CardPointe **Integrated Terminal API ("Bolt")** client.
//
// This drives a PHYSICAL terminal: the customer taps Pay on the iPad, the backend tells the paired terminal to prompt
// for a card and authorize. It is a SEPARATE product from the CardPointe Gateway (cardpointe.client.ts):
//
//   Gateway (card-not-present)                Bolt / Integrated Terminal (card-present)
//   host  https://<site>.cardconnect.com      https://<site>.bolt.cardpointe.com
//   verbs PUT/GET                             POST (JSON)
//   auth  HTTP Basic user:pass                Authorization: <api key> (raw key issued by integrated payments)
//   keys  merchid (lowercase)                 merchantId (camelCase) + hsn (terminal hardware serial number)
//   sess  none                                POST /api/v2/connect -> X-CardConnect-SessionKey header, echoed on calls
//
// Documented flow implemented here:
//   POST {base}/api/v2/connect   { merchantId, hsn, force:false }     -> session key in X-CardConnect-SessionKey header
//   POST {base}/api/v3/authCard  { merchantId, hsn, amount:"11098",   -> gateway-style auth body (respstat/retref/...)
//                                  capture:"true", includeSignature:"true", includeAmountDisplay:"true",
//                                  beep:"true", orderId }                (blocks while the customer taps/inserts)
//   POST {base}/api/v2/disconnect{ merchantId, hsn }                  -> release the session
//   POST {base}/api/v2/ping      { merchantId, hsn }                  -> connectivity check
//   POST {base}/api/v2/display   { merchantId, hsn, text }            -> show a message on the terminal screen
// Fiserv master build §6 (Nov 4 2026): authCard amounts use Fiserv's documented implied-decimal format ("11098" = $110.98);
// the response amount must equal the request (TerminalCaptureService refuses "paid" otherwise). respstat "A" approved /
// "B" retry / "C" declined. connect never forces (no session stealing). cancel / disconnect / listTerminals added.
//
// ── CONFIRMED ON BOLT UAT (Sep 27 2026, https://bolt-uat.cardpointe.com/api, the UAT MID) ──
//   • Authorization header = the RAW key Fiserv issues (no prefix); the base is https://bolt-uat.cardpointe.com/api
//   • /api/v2 and /api/v3 both answer; listTerminals returned the two registered HSNs
//   • ping WITHOUT a session -> 400 {"errorCode":1,"errorMessage":"SessionKey header is required"} — so connect first,
//     exactly as this client does; error bodies are {errorCode, errorMessage}
//   • connect to a terminal that is not online -> 500 {"errorCode":6,"errorMessage":"No request queue registered for
//     hsn <hsn>"} — the Clover must be registered (order ID) and powered on before any session can open
// ── STILL TO CONFIRM WITH A DEVICE ONLINE ──
//   • the session-key header name casing on the connect RESPONSE, and authCard's blocking timeout while a customer taps
//   • terminal-side prompts (signature / amount confirm / beep) per device model, and the exact encoding of the
//     signature authCard returns — terminalSignatureDataUrl() accepts a gzip-compressed or plain bitmap / PNG / JPEG
// The transport is injected (FetchLike) so the request building + response parsing ARE fully verified here against a
// Bolt-shaped local server; only the physical-device leg needs a live terminal.
import { withCode } from '@aipowersalon/api-contracts';
import { gunzipSync } from 'node:zlib';
import { ProcessorError } from './payment-processor.port';
import type { FetchLike, FetchResponseLike } from './cardpointe.client';

export interface BoltConfig {
  /** e.g. "https://<site>.bolt.cardpointe.com" (no trailing slash). */
  baseUrl: string;
  /** Bolt Authorization api key (per-tenant, encrypted at rest in tenant_payment_config.bolt_api_key_enc). */
  apiKey: string;
  merchantId: string;
  /** authCard amount wire format. Fiserv's published Terminal API docs: "two implied decimal places (for example, enter
   *  "1000" to specify "$10.00")" → 'implied_decimal' (default). 'decimal' ("10.00") exists ONLY as an escape hatch if
   *  Fiserv UAT proves otherwise — WAITING_FOR_FISERV: confirm with Ryan using $1.00 / $9.00 / $1,000.12 on the Compact. */
  amountFormat?: 'implied_decimal' | 'decimal';
  /** authCard API version. Fiserv's public Terminal API docs show /api/v3/authCard (default). The Nov 4 2026 Postman
   *  starter uses /api/v4/authCard for the surcharge flow — switch only when Ryan confirms v4 for the Compact. */
  authCardVersion?: 'v3' | 'v4';
}

export interface TerminalAuthInput {
  hsn: string;
  amountCents: number;
  orderId?: string;
}

export interface TerminalAuthResult {
  approved: boolean;
  declined: boolean;
  retref?: string;
  authCode?: string;
  respstat: string;   // "A" | "B" | "C"
  respText: string;
  amountCents?: number;
  /** The cardholder's signature as the terminal returned it (base64; see terminalSignatureDataUrl), when it asked for one. */
  signature?: string;
}

/** The minimal terminal-device abstraction the capture flow depends on (so it can be driven by a simulator in tests). */
export interface TerminalDevicePort {
  readonly name: string;
  ping(hsn: string): Promise<boolean>;
  authCard(input: TerminalAuthInput): Promise<TerminalAuthResult>;
  display(hsn: string, text: string): Promise<void>;
  /** Oct 21 2026: call off the prompt the terminal is showing (the guest walked away / chose cash). The pending authCard
   *  then returns a non-approval. A cancel that arrives after the card was read changes nothing — approved wins. */
  cancel?(hsn: string): Promise<void>;
}

function toDollars(cents: number): string { return (cents / 100).toFixed(2); }

/** Integer cents → the authCard wire amount. Refuses anything that is not a positive whole number of cents. */
export function boltWireAmount(cents: number, format: 'implied_decimal' | 'decimal' = 'implied_decimal'): string {
  if (!Number.isInteger(cents) || cents <= 0) throw withCode(new ProcessorError(`Bolt amount must be a positive whole number of cents (got ${cents})`), 'VALIDATION_FAILED', { field: 'amountCents' });
  return format === 'decimal' ? toDollars(cents) : String(cents);
}

/** The authCard response amount → integer cents. A value with a decimal point is major units ("10.00", and declines
 *  answer "0.00"); a bare integer is implied-decimal cents ("1000" = $10.00). Anything else → undefined (never guessed). */
export function boltResponseAmountCents(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).trim();
  if (/^\d+\.\d{1,2}$/.test(s)) { const [a, b] = s.split('.'); return Number(a) * 100 + Number(b.padEnd(2, '0')); }
  if (/^\d+$/.test(s)) return Number(s);
  return undefined;
}

export class CardPointeBoltClient implements TerminalDevicePort {
  readonly name = 'cardpointe_bolt';
  private readonly base: string;
  private sessionKey: string | null = null;

  constructor(private readonly cfg: BoltConfig, private readonly fetchImpl: FetchLike) {
    // Fiserv hands out the Bolt base as "https://bolt-uat.cardpointe.com/api/" — pasted as-is it doubled to
    // /api/api/v2/connect (HTTP 404, found by the live wiring check). The paths below carry /api themselves.
    this.base = cfg.baseUrl.replace(/\/+$/, '').replace(/\/api$/i, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: this.cfg.apiKey };
    if (this.sessionKey) h['X-CardConnect-SessionKey'] = this.sessionKey;
    return h;
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<{ body: any; res: FetchResponseLike }> {
    let res: FetchResponseLike;
    try {
      res = await this.fetchImpl(this.base + path, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) });
    } catch (e) {
      throw new ProcessorError(`Bolt request to ${path} failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Bolt UAT answers errors as {"errorCode": n, "errorMessage": "..."} — surface the message itself (e.g. "No request
      // queue registered for hsn …" = the terminal is not online), not only the HTTP status.
      let msg = body.slice(0, 200);
      try { const j = JSON.parse(body); if (j && typeof j.errorMessage === 'string') msg = `${j.errorMessage}${j.errorCode != null ? ` (code ${j.errorCode})` : ''}`; } catch { /* not JSON */ }
      throw new ProcessorError(`Bolt ${path} returned HTTP ${res.status}${msg ? ': ' + msg : ''}`, res.status);
    }
    const text = await res.text().catch(() => '');
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { body, res };
  }

  /** Establish a session with the physical terminal; Bolt returns the key in the X-CardConnect-SessionKey header.
   *  force:false (Fiserv master build §6 + Fiserv docs: force:true "destroys any existing sessions and cancels in-flight
   *  operations"). A terminal already in use by another register answers an error → the caller reports TERMINAL_BUSY;
   *  we never steal another register's session or cancel its in-flight charge. */
  private async connect(hsn: string): Promise<void> {
    const { res } = await this.post('/api/v2/connect', { merchantId: this.cfg.merchantId, hsn, force: false });
    const key = (res).headers?.get?.('x-cardconnect-sessionkey') || (res).headers?.get?.('X-CardConnect-SessionKey') || null;
    // Bolt returns the key with a ;ip suffix sometimes; keep only the key part.
    this.sessionKey = key ? String(key).split(';')[0] : null;
    if (!this.sessionKey) throw new ProcessorError('Bolt connect did not return a session key (X-CardConnect-SessionKey header missing).');
  }

  async ping(hsn: string): Promise<boolean> {
    try {
      if (!this.sessionKey) await this.connect(hsn);
      const { body } = await this.post('/api/v2/ping', { merchantId: this.cfg.merchantId, hsn });
      return body?.connected === true || body?.connected === 'true';
    } catch { return false; }
  }

  async display(hsn: string, text: string): Promise<void> {
    if (!this.sessionKey) await this.connect(hsn);
    await this.post('/api/v2/display', { merchantId: this.cfg.merchantId, hsn, text });
  }

  /** POST /api/v2/listTerminals — the HSNs Fiserv has provisioned for this merchant (use THESE, not a printed serial). */
  async listTerminals(): Promise<string[]> {
    const { body } = await this.post('/api/v2/listTerminals', { merchantId: this.cfg.merchantId });
    const list = Array.isArray(body?.terminals) ? body.terminals : Array.isArray(body) ? body : [];
    return list.map((x: unknown) => String(x)).filter(Boolean);
  }

  /** POST /api/v2/cancel — stop an in-flight terminal prompt. Fiserv: a cancel cannot stop an authorization the terminal
   *  service already sent to the Gateway, so the caller must still inquire by order id before any retry. */
  async cancel(hsn: string): Promise<void> {
    if (!this.sessionKey) return;   // nothing of ours is in flight
    await this.post('/api/v2/cancel', { merchantId: this.cfg.merchantId, hsn });
  }

  /** POST /api/v2/disconnect — release OUR session (does not cancel an in-flight transaction). */
  async disconnect(hsn: string): Promise<void> {
    if (!this.sessionKey) return;
    try { await this.post('/api/v2/disconnect', { merchantId: this.cfg.merchantId, hsn }); } finally { this.sessionKey = null; }
  }

  /** Prompt the terminal for a card and authorize+capture the amount. Blocks while the customer taps/inserts.
   *  POST /api/v3/authCard (the version Fiserv documents); amount in the configured wire format (implied decimals). */
  async authCard(input: TerminalAuthInput): Promise<TerminalAuthResult> {
    const amount = boltWireAmount(input.amountCents, this.cfg.amountFormat ?? 'implied_decimal');
    if (!this.sessionKey) await this.connect(input.hsn);
    const { body: r } = await this.post(`/api/${this.cfg.authCardVersion === 'v4' ? 'v4' : 'v3'}/authCard`, {
      merchantId: this.cfg.merchantId,
      hsn: input.hsn,
      amount,
      capture: 'true',
      // Kevin, Oct 6 2026: the cardholder signs ONCE, here on the Clover terminal (the customer display no longer asks).
      includeSignature: 'true',
      includeAmountDisplay: 'true',  // show the amount on the terminal while prompting
      beep: 'true',
      ...(input.orderId ? { orderId: input.orderId } : {}),
    });
    const respstat = String(r?.respstat ?? '');
    const amountCents = boltResponseAmountCents(r?.amount);
    return {
      approved: respstat === 'A',
      declined: respstat === 'C',
      retref: r?.retref ? String(r.retref) : undefined,
      authCode: r?.authcode ? String(r.authcode) : undefined,
      respstat,
      respText: String(r?.resptext ?? ''),
      amountCents,
      ...(typeof r?.signature === 'string' && r.signature ? { signature: r.signature } : {}),
    };
  }
}

/**
 * The terminal's signature as an image data URL the front desk can view, or null. CardPointe sends a signature as base64,
 * gzip-compressed bitmap (the gateway's signature format); a plain bitmap, PNG or JPEG is accepted too. Anything else —
 * or anything over 2 MB once decoded — is not an image we can show, and is not stored (the payment stands either way).
 */
export function terminalSignatureDataUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4_000_000) return null;
  let bytes: Buffer;
  try { bytes = Buffer.from(raw.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''), 'base64'); } catch { return null; }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { bytes = gunzipSync(bytes, { maxOutputLength: 2_000_000 }); } catch { return null; }
  }
  if (bytes.length < 8 || bytes.length > 2_000_000) return null;
  const type = bytes[0] === 0x42 && bytes[1] === 0x4d ? 'image/bmp'
    : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : null;
  return type ? `data:${type};base64,${bytes.toString('base64')}` : null;
}
