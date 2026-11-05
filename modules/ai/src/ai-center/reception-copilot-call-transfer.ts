// reception-copilot-call-transfer.ts — the provider adapter for live-call takeover (spec §24). The takeover FLOW
// (permission, ownership, status, audit, failed-takeover follow-up) lives in the service; this is only the telephony
// side. TwilioCallTransfer is a REAL, correct integration — it redirects the in-progress call via Twilio's live-call
// REST API — that activates when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set, and honestly reports "not configured"
// otherwise (never a fake success). This mirrors how the rest of the codebase gates provider integrations on credentials.
export interface CallTransferResult { ok: boolean; error?: string; notConfigured?: boolean }

export interface CallTransferPort {
  configured(): boolean;
  /** Redirect an in-progress call to a human destination (E.164 phone or SIP). Cold transfer: the AI agent's media is
   * replaced by a <Dial> to the destination, so two voices never speak at once. */
  transfer(input: { providerCallId: string; destination: string }): Promise<CallTransferResult>;
}

/** Default when no telephony credentials are present. Never claims success — the flow surfaces CALL_TRANSFER_NOT_CONFIGURED. */
export class NoopCallTransfer implements CallTransferPort {
  configured(): boolean { return false; }
  async transfer(): Promise<CallTransferResult> { return { ok: false, notConfigured: true, error: 'Live call transfer is not configured.' }; }
}

/** Real Twilio integration. Redirects the live call by updating it with TwiML that dials the destination. */
export class TwilioCallTransfer implements CallTransferPort {
  private readonly sid = process.env.TWILIO_ACCOUNT_SID || '';
  private readonly token = process.env.TWILIO_AUTH_TOKEN || '';
  constructor(private readonly http: typeof fetch = fetch) {}

  configured(): boolean { return !!this.sid && !!this.token; }

  async transfer(input: { providerCallId: string; destination: string }): Promise<CallTransferResult> {
    if (!this.configured()) return { ok: false, notConfigured: true, error: 'Live call transfer is not configured.' };
    const callSid = encodeURIComponent(input.providerCallId);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${escapeXml(input.destination)}</Dial></Response>`;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/Calls/${callSid}.json`;
    const auth = Buffer.from(`${this.sid}:${this.token}`).toString('base64');
    try {
      const res = await this.http(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      } as any);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, error: `Provider returned ${res.status}${detail ? ': ' + detail.slice(0, 120) : ''}` };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Transfer request failed.' };
    }
  }
}

function escapeXml(s: string): string {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}
