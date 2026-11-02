// reception-copilot-call-transfer.ts — the takeover's seam to telephony (spec §24). The takeover FLOW (permission,
// ownership, status, audit, failed-takeover follow-up) lives in the service; this file only maps the ONE telephony
// adapter (voice-booking/provider-ports: TelephonyProvisioningPort.transferCall — Twilio when TWILIO_ACCOUNT_SID +
// TWILIO_AUTH_TOKEN are set, the honest NotConnected default otherwise) onto the flow's result shape. B-14 (Oct 20
// 2026): this file used to carry its own Twilio REST request, credentials and auth — a second Twilio client outside
// the adapter (§106). It owns no HTTP now; "not configured" comes from the adapter's status, never from a fake success.
import { ProviderNotConnectedError, type TelephonyProvisioningPort } from '../voice-booking/provider-ports';

export interface CallTransferResult { ok: boolean; error?: string; notConfigured?: boolean }

export interface CallTransferPort {
  configured(): boolean;
  /** Redirect an in-progress call to a human destination (E.164 phone or SIP). Cold transfer: the AI agent's media is
   * replaced by a <Dial> to the destination, so two voices never speak at once. */
  transfer(input: { providerCallId: string; destination: string }): Promise<CallTransferResult>;
}

/** Test double / explicit "no telephony" — never claims success; the flow surfaces CALL_TRANSFER_NOT_CONFIGURED. */
export class NoopCallTransfer implements CallTransferPort {
  configured(): boolean { return false; }
  async transfer(): Promise<CallTransferResult> { return { ok: false, notConfigured: true, error: 'Live call transfer is not configured.' }; }
}

/** The production implementation: a caller of the telephony adapter. */
export class TelephonyCallTransfer implements CallTransferPort {
  constructor(private readonly telephony: TelephonyProvisioningPort) {}

  configured(): boolean { return this.telephony.status().state === 'connected'; }

  async transfer(input: { providerCallId: string; destination: string }): Promise<CallTransferResult> {
    if (!this.configured()) return { ok: false, notConfigured: true, error: 'Live call transfer is not configured.' };
    try {
      await this.telephony.transferCall(input);
      return { ok: true };
    } catch (e: any) {
      if (e instanceof ProviderNotConnectedError) return { ok: false, notConfigured: true, error: 'Live call transfer is not configured.' };
      if (typeof e?.status === 'number') return { ok: false, error: `Provider returned ${e.status}${e.message ? ': ' + String(e.message).slice(0, 120) : ''}` };
      return { ok: false, error: e?.message || 'Transfer request failed.' };
    }
  }
}
