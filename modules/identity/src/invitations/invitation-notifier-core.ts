// invitation-notifier-core.ts — pure shaping for outbound invitation delivery. When a notifier URL is configured the
// service POSTs this envelope to it; the operator's mailer/SMS relay performs the actual send. Vendor-agnostic on
// purpose (no SDK lock-in) and pure, so the payload + status mapping are unit-tested without any network.
export interface InvitationDeliveryContext {
  email: string; channel: string; acceptUrl: string; tokenPrefix: string;
  role: string | null; tenantId: string | null; expiresAt: string | null;
}

/** The JSON envelope POSTed to INVITE_NOTIFIER_URL. Carries the raw accept link (the point of delivery); the token
 *  itself is never included separately. */
export function buildInvitationDeliveryPayload(c: InvitationDeliveryContext) {
  return {
    type: 'user_invitation',
    channel: c.channel,
    to: c.email,
    acceptUrl: c.acceptUrl,
    tokenPrefix: c.tokenPrefix,
    role: c.role ?? null,
    tenantId: c.tenantId ?? null,
    expiresAt: c.expiresAt ?? null,
  };
}

export function deliveryStatusFor(ok: boolean): 'delivered' | 'failed' {
  return ok ? 'delivered' : 'failed';
}
