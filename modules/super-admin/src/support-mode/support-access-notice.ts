// support-access-notice.ts — Constitution 7 §84: the salon owner is told when AI PowerSalon Support opens their account.
// Written in the SAME transaction as the support session, so a session cannot exist without its notice (accountability):
// if the notice cannot be written, the session is not created. Owner-only (audience = 'owner'), never staff-wide.
// The body names the reason, the scope and when access ends — not the individual agent (the audit trail keeps who).
import { sql } from 'kysely';

const SCOPE_TEXT: Record<string, string> = { READ_ONLY: 'read-only', STANDARD_SUPPORT: 'standard support', ELEVATED_SUPPORT: 'elevated (can make changes)' };

export async function writeSupportAccessNotice(trx: any, n: { tenantId: string; sessionId: string; reason: string; scope: string; expiresAt: Date | string }): Promise<void> {
  const ends = new Date(n.expiresAt);
  const title = 'AI PowerSalon Support accessed your account';
  const body = `Reason: ${n.reason}. Access is ${SCOPE_TEXT[n.scope] ?? n.scope} and ends at ${ends.toISOString().slice(11, 16)} UTC. Every action is recorded.`;
  await sql`insert into owner_alerts (tenant_id, category, severity, status, title, body, metadata, audience)
            values (${n.tenantId}, 'support_access', ${n.scope === 'ELEVATED_SUPPORT' ? 'high' : 'info'}, 'new', ${title}, ${body},
                    ${JSON.stringify({ supportSessionId: n.sessionId, scope: n.scope, expiresAt: ends.toISOString() })}::jsonb, 'owner')`.execute(trx);
}

/** §78 + §84: an extension is told to the owner too — same transaction as the extension. */
export async function writeSupportExtensionNotice(trx: any, n: { tenantId: string; sessionId: string; reason: string; expiresAt: Date | string }): Promise<void> {
  const ends = new Date(n.expiresAt);
  await sql`insert into owner_alerts (tenant_id, category, severity, status, title, body, metadata, audience)
            values (${n.tenantId}, 'support_access', 'info', 'new', 'AI PowerSalon Support extended its access',
                    ${`Reason: ${n.reason}. Access now ends at ${ends.toISOString().slice(11, 16)} UTC. Every action is recorded.`},
                    ${JSON.stringify({ supportSessionId: n.sessionId, extended: true, expiresAt: ends.toISOString() })}::jsonb, 'owner')`.execute(trx);
}

/** §78 — the extension rule, pure. At most MAX_EXTENSIONS, each 15–60 minutes, never beyond MAX_TOTAL_MINUTES from the start. */
export const MAX_EXTENSIONS = 2;
export const MAX_TOTAL_MINUTES = 120;
export function decideExtension(s: { startedAt: Date; expiresAt: Date; endedAt: Date | null; extensionCount: number }, minutes: number, reason: string, now: Date):
    { ok: true; newExpiresAt: Date } | { ok: false; error: string } {
  if (s.endedAt || s.expiresAt.getTime() <= now.getTime()) return { ok: false, error: 'That support session has already ended. Start a new one.' };
  if ((reason ?? '').trim().length < 10) return { ok: false, error: 'A reason of at least 10 characters is required to extend support access.' };
  if (!Number.isFinite(minutes) || minutes < 15 || minutes > 60) return { ok: false, error: 'Extend by 15–60 minutes.' };
  if (s.extensionCount >= MAX_EXTENSIONS) return { ok: false, error: `A session can be extended at most ${MAX_EXTENSIONS} times. Start a new session with a new reason.` };
  const newExpiresAt = new Date(s.expiresAt.getTime() + minutes * 60_000);
  if (newExpiresAt.getTime() - s.startedAt.getTime() > MAX_TOTAL_MINUTES * 60_000) return { ok: false, error: `Support sessions cannot run longer than ${MAX_TOTAL_MINUTES / 60} hours in total.` };
  return { ok: true, newExpiresAt };
}
