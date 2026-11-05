// tenant-warning-dispatch-core.ts — PURE delivery-status resolution + message formatting for tenant warnings.
// The job performs the actual sends; this file decides the honest terminal status and builds the channel bodies, so
// both are unit-testable with no senders or DB.

export type ChannelResult = 'sent' | 'skipped' | 'failed';

/** Collapse per-channel outcomes into the tenant_warnings.delivery_status terminal value.
 *  failed (something errored, surfaces for retry/inspection) > sent (at least one channel delivered) >
 *  skipped (requested but no provider/recipient) ; recorded only when no external channel was requested. */
export function resolveDeliveryStatus(results: { email?: ChannelResult; sms?: ChannelResult }): 'sent' | 'skipped' | 'failed' | 'recorded' {
  const vals = [results.email, results.sms].filter(Boolean) as ChannelResult[];
  if (!vals.length) return 'recorded';
  if (vals.includes('failed')) return 'failed';
  if (vals.includes('sent')) return 'sent';
  return 'skipped';
}

export function warningEmail(subject: string, message: string): { subject: string; body: string } {
  return {
    subject: `AIPowerSalon: ${subject}`,
    body: `${message}\n\n— This is an official notice from the AIPowerSalon platform team. If you have questions, reply to this email or contact support.`,
  };
}

export function warningSmsBody(subject: string, message: string): string {
  const full = `AIPowerSalon notice — ${subject}: ${message}`;
  return full.length <= 320 ? full : full.slice(0, 317) + '...';
}
