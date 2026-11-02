// retell-voice.adapter.ts — Retell AI implementation of VoiceProviderPort.
//
// Webhook auth follows Retell's documented scheme (docs.retellai.com/features/secure-webhook):
//   - Header `X-Retell-Signature` in the form  v=<unix_ms_timestamp>,d=<hex_hmac_sha256>
//   - The signed message is  rawBody + timestamp  (the raw request bytes concatenated with the timestamp string)
//   - Keyed by the Retell API key (the one bearing the "webhook" badge)
//   - Reject if the timestamp is more than 5 minutes from now (replay protection)
//   - Constant-time digest comparison
// Custom-function (tool) calls POST JSON; Retell expects a fast (<2s) JSON response that it reads back to the agent.
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VoiceProviderPort, VoiceToolCall, VoiceToolResult, VoiceAuthResult } from './voice-provider.port';

const SIGNATURE_HEADER = 'x-retell-signature';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const SIGNATURE_RE = /^v=(\d+),d=([0-9a-f]+)$/i;

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  // Header lookup is case-insensitive; providers may send either casing.
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name) { const v = headers[k]; return Array.isArray(v) ? (v[0] ?? null) : (v ?? null); }
  }
  return null;
}

@Injectable()
export class RetellVoiceAdapter implements VoiceProviderPort {
  readonly provider = 'retell';

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, signingKey: string, nowMs = Date.now()): VoiceAuthResult {
    try {
      if (!signingKey) return { ok: false, reason: 'no signing key configured' };
      const sig = headerValue(headers, SIGNATURE_HEADER);
      if (!sig) return { ok: false, reason: 'missing signature header' };
      const m = SIGNATURE_RE.exec(sig.trim());
      if (!m) return { ok: false, reason: 'malformed signature' };
      const timestamp = m[1];
      const digestHex = m[2].toLowerCase();

      // Replay protection: the signed timestamp must be recent.
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > REPLAY_WINDOW_MS) return { ok: false, reason: 'stale or invalid timestamp' };

      // HMAC-SHA256 over (rawBody + timestamp), keyed by the Retell API key.
      const expected = createHmac('sha256', signingKey).update(rawBody + timestamp).digest();
      let provided: Buffer;
      try { provided = Buffer.from(digestHex, 'hex'); } catch { return { ok: false, reason: 'bad digest encoding' }; }
      if (provided.length !== expected.length) return { ok: false, reason: 'digest length mismatch' };
      if (!timingSafeEqual(provided, expected)) return { ok: false, reason: 'signature mismatch' };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: `verify error: ${e?.message ?? e}` };
    }
  }

  parseToolCall(rawBody: string): VoiceToolCall | null {
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return null; }
    // Retell custom-function payloads carry the function name + args plus call context. Field names vary slightly by
    // Retell version, so accept the common shapes rather than hard-binding to one.
    const name = body?.name ?? body?.function_name ?? body?.tool_name ?? body?.function?.name;
    if (!name || typeof name !== 'string') return null;
    const rawArgs = body?.args ?? body?.arguments ?? body?.parameters ?? body?.function?.arguments ?? {};
    let args: Record<string, unknown> = {};
    if (typeof rawArgs === 'string') { try { args = JSON.parse(rawArgs); } catch { args = {}; } }
    else if (rawArgs && typeof rawArgs === 'object') { args = rawArgs as Record<string, unknown>; }
    const callId = body?.call?.call_id ?? body?.call_id ?? null;
    // Constitution 12 M12: the number the call comes FROM, as Retell's platform reports it in the call object — not a
    // tool argument, so neither the caller's words nor the model can set it. Only for inbound calls.
    const direction = String(body?.call?.direction ?? 'inbound').toLowerCase();
    const callerId = direction === 'inbound' && typeof body?.call?.from_number === 'string' ? body.call.from_number : null;
    const invocationId = body?.invocation_id ?? body?.tool_call_id ?? body?.id ?? null;
    return { name, args, callId, invocationId , callerId };
  }

  formatToolResult(call: VoiceToolCall, result: VoiceToolResult): unknown {
    // Retell reads the returned JSON back into the conversation. Keep it small and fast. On error we return a
    // relay-friendly message rather than an exception, so the agent can tell the caller honestly.
    if (result.error) return { invocation_id: call.invocationId, success: false, message: result.error };
    return {
      invocation_id: call.invocationId,
      success: true,
      ...(result.say ? { message: result.say } : {}),
      data: result.data,
    };
  }
}
