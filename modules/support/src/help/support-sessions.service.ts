// support-sessions.service.ts — "request a session" for human support (spec §21–22): live chat, remote support,
// callback. No live agent is wired in-app, so a request records intent and stays 'requested' until support
// follows up — we never fake an active agent. Remote support REQUIRES explicit recorded consent (enforced here,
// before any DB work, so the gate is unit-testable), and every request writes an audit event. Raw SQL, fail-soft.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { HelpCtx } from './help.service';
import { canSeeAllTenantTickets } from './support-tickets.service';

export const SESSION_KINDS = ['live_chat', 'remote_support', 'callback'] as const;
export type SessionKind = typeof SESSION_KINDS[number];

export function isValidSessionKind(k: string): k is SessionKind { return (SESSION_KINDS as readonly string[]).includes(k); }

/** Remote support can view/control the user's screen, so it requires explicit consent. Chat/callback do not. */
export function requiresConsent(kind: string): boolean { return kind === 'remote_support'; }

export interface SessionInput {
  kind?: string; topic?: string; ticketId?: string; consentGranted?: boolean; consentText?: string;
  contactMethod?: string; contactValue?: string;
}
type CleanSession = {
  kind: SessionKind; topic: string | null; ticketId: string | null; consentGranted: boolean; consentText: string | null;
  contactMethod: string | null; contactValue: string | null;
};
export function sanitizeSessionInput(raw: SessionInput): { ok: boolean; error?: string; value?: CleanSession } {
  const kind = String(raw.kind || '');
  if (!isValidSessionKind(kind)) return { ok: false, error: 'invalid_kind' };
  return {
    ok: true,
    value: {
      kind,
      topic: (raw.topic || '').trim().slice(0, 500) || null,
      ticketId: (raw.ticketId || '').trim() || null,
      consentGranted: !!raw.consentGranted,
      consentText: (raw.consentText || '').trim().slice(0, 1000) || null,
      contactMethod: (raw.contactMethod || '').trim().slice(0, 40) || null,
      contactValue: (raw.contactValue || '').trim().slice(0, 200) || null,
    },
  };
}

export type SessionSummary = {
  id: string; kind: string; topic: string | null; status: string; consentGranted: boolean;
  ticketId: string | null; createdAt: string | null;
};
function iso(v: any): string | null { return v ? new Date(v).toISOString() : null; }
function toSummary(x: any): SessionSummary {
  return { id: x.id, kind: x.kind, topic: x.topic ?? null, status: x.status, consentGranted: !!x.consent_granted, ticketId: x.ticket_id ?? null, createdAt: iso(x.created_at) };
}

export class SupportSessionsService {
  constructor(private readonly db: Kysely<DB> | null) {}

  private async query<T>(text: ReturnType<typeof sql>): Promise<T[]> {
    if (!this.db) return [];
    try { const r = await text.execute(this.db); return ((r as any).rows || []) as T[]; } catch { return []; }
  }

  async createSessionRequest(ctx: HelpCtx, raw: SessionInput): Promise<{ ok: boolean; error?: string; request?: SessionSummary }> {
    if (!ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    const s = sanitizeSessionInput(raw);
    if (!s.ok || !s.value) return { ok: false, error: s.error };
    const v = s.value;
    // Consent gate runs BEFORE any DB work — remote support cannot be requested without recorded consent.
    if (requiresConsent(v.kind) && !v.consentGranted) return { ok: false, error: 'consent_required' };
    if (!this.db) return { ok: false, error: 'unavailable' };
    try {
      const rows = await this.query<any>(sql`
        INSERT INTO support_session_requests (tenant_id, branch_id, requested_by_user_id, kind, topic, ticket_id,
          consent_granted, consent_text, contact_method, contact_value, status)
        VALUES (${ctx.tenantId}, ${ctx.branchId || null}, ${ctx.userId}, ${v.kind}, ${v.topic}, ${v.ticketId},
          ${v.consentGranted}, ${v.consentText}, ${v.contactMethod}, ${v.contactValue}, 'requested')
        RETURNING *`);
      const req = rows[0];
      if (!req) return { ok: false, error: 'create_failed' };
      await sql`INSERT INTO support_session_events (request_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${req.id}, ${ctx.tenantId}, 'requested', ${`kind=${v.kind}; consent=${v.consentGranted}`}, ${ctx.userId})`.execute(this.db);
      return { ok: true, request: toSummary(req) };
    } catch { return { ok: false, error: 'create_failed' }; }
  }

  /** Role-scoped: own requests, or the whole tenant for owners/managers. Never cross-tenant. */
  async listSessionRequests(ctx: HelpCtx): Promise<SessionSummary[]> {
    if (!ctx.tenantId) return [];
    const all = canSeeAllTenantTickets(ctx);
    const rows = await this.query<any>(sql`
      SELECT * FROM support_session_requests
      WHERE tenant_id = ${ctx.tenantId} ${all ? sql`` : sql`AND requested_by_user_id = ${ctx.userId ?? null}`}
      ORDER BY created_at DESC LIMIT 50`);
    return rows.map(toSummary);
  }
}
