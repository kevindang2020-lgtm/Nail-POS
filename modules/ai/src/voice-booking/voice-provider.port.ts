// voice-provider.port.ts — provider-agnostic seam for the AI voice receptionist (Phase 3).
//
// AIPowerSalon must NOT be coupled to any single voice vendor (Retell/Vapi/Twilio/…). Every provider-specific detail —
// how an inbound webhook is authenticated, how a tool/function call is shaped, how a result is returned to the agent —
// lives behind this port. The Voice Booking Gateway and controllers depend only on these canonical types, so switching
// providers later is a new adapter, not a rewrite (the prompt+tool layer is portable; this keeps the code portable too).

/** A tool/function invocation from the voice agent, normalized across providers. */
export interface VoiceToolCall {
  /** Canonical tool name the agent invoked, e.g. "get_availability". */
  name: string;
  /** Arguments the agent supplied (already JSON-parsed). Never trusted for tenant identity — that comes from the key. */
  args: Record<string, unknown>;
  /** Provider call/session id, for correlation + idempotency + audit. */
  callId: string | null;
  /** Constitution 12 M12: the number the call comes FROM, per the telephony provider (never a tool argument). */
  callerId?: string | null;
  /** Provider-specific invocation id (if any), echoed back in the result so the provider can match request↔response. */
  invocationId: string | null;
}

/** The result of running a tool, to be shaped into whatever the provider expects on the wire. */
export interface VoiceToolResult {
  /** Machine payload the agent can read back (already safe-projected). */
  data: unknown;
  /** Optional short spoken-friendly summary the agent may read aloud. */
  say?: string;
  /** True when the tool failed in a way the agent should relay honestly ("I couldn't reach the schedule right now"). */
  error?: string;
}

/** Outcome of authenticating an inbound webhook/tool request. */
export interface VoiceAuthResult {
  ok: boolean;
  /** Why it failed (for logs only — never returned to the caller verbatim). */
  reason?: string;
}

/**
 * A voice provider adapter. Implementations are thin and swappable. `signingKey` is the provider's webhook/verify
 * secret, resolved per-tenant from the voice integration-key store (Phase 2) — never hard-coded.
 */
export interface VoiceProviderPort {
  /** Stable provider id, e.g. "retell". */
  readonly provider: string;

  /**
   * Verify an inbound request is genuinely from the provider. Given the RAW request body (exact bytes — never a
   * re-serialized object) and the request headers, return whether the signature/timestamp are valid. Must be
   * constant-time and replay-resistant. Never throws; returns { ok:false } on any problem.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, signingKey: string, nowMs?: number): VoiceAuthResult;

  /** Parse a verified request body into a canonical tool call. Returns null if the body isn't a tool/function call. */
  parseToolCall(rawBody: string): VoiceToolCall | null;

  /** Shape a tool result into the provider's expected wire response for a custom-function call. */
  formatToolResult(call: VoiceToolCall, result: VoiceToolResult): unknown;
}
