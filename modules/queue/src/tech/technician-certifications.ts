// technician-certifications.ts — portable technician certifications (migration 584; the other chat's 467, workforce
// audit P2 #28). Merged Oct 12 2026.
//
// A technician records her own certifications from the app (name / issuer / dates / a PRIVATE document key from the
// existing /tech/skills/upload-document path). A manager VERIFIES or REVOKES one from the POS. A service may require a
// certification by name (services.required_certification, 583); the eligibility library (@aipowersalon/workforce
// eligibility) denies the technician for that service while the matching certification is expired or revoked. The
// expiry sweep (certification-expiry.scheduler.ts) reminds at 30/14/7 days and flips VERIFIED/UNVERIFIED → EXPIRED.
//
// Adapted to our tree: the document key must be one of HER OWN uploads at THIS salon (`tenants/<tenant>/skill-docs/
// <user>/…` — uploadObjectKey's layout), not merely any key in the namespace (theirs accepted any `skilldoc/` key, so a
// technician could attach another person's private document).
import { sql, type Kysely } from 'kysely';
import { assertTransition, canMoveToSql } from '@aipowersalon/database';
import { utcDate } from '@aipowersalon/date-time';
import { TECHNICIAN_CERTIFICATION } from '../queue-lifecycles';
import { TechError } from './tech-errors';
import type { TechContext, TechDataPort } from './tech.repository';

import type { TechCertificationStatus as CertificationStatus, TechCertificationView as CertificationView, TechCertificationBody as CertificationBody } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
export type { CertificationStatus, CertificationView, CertificationBody };   // owned by packages/api-contracts (Constitution 13 §13)
export interface CertificationDue { certificationId: string; tenantId: string | null; technicianId: string | null; globalTechProfileId: string | null; name: string; expiresAt: string; daysBefore: number }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The columns a certification view is built from (never selectAll — check:response-exposure). */
const CERT_COLS = ['id', 'technician_id', 'global_tech_profile_id', 'name', 'issuer', 'issued_at', 'expires_at', 'document_key', 'verification_status', 'verified_at', 'verified_by_user_id', 'revoked_reason', 'created_at', 'updated_at'] as const;
const dstr = (v: any): string | null => (v == null ? null : v instanceof Date ? utcDate(v) : String(v).slice(0, 10));
const iso = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/** Pure: UNVERIFIED/VERIFIED become EXPIRED once expires_at < today; REVOKED stays REVOKED. */
export function effectiveCertificationStatus(stored: string, expiresAt: string | null, today: string): CertificationStatus {
  if (stored === 'REVOKED') return 'REVOKED';
  if (expiresAt && expiresAt < today) return 'EXPIRED';
  if (stored === 'EXPIRED') return 'UNVERIFIED'; // the date was extended after an expiry — needs a fresh verification
  return stored === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
}
/** Calendar-day arithmetic (UTC civil dates — no DST drift). */
export function daysUntil(expiresAt: string | null, today: string): number | null {
  if (!expiresAt) return null;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((at(expiresAt) - at(today)) / 86_400_000);
}
/** Pure: the TIGHTEST reminder window containing `days` that has not been sent yet (10 days out → the 14-day window; a
 *  certification added 10 days before expiry never gets a late 30-day reminder on top). */
export function dueReminderWindow(days: number, windows: number[], alreadySent: Set<number>): number | null {
  if (days < 0) return null;
  const w = windows.filter((d) => days <= d).sort((a, b) => a - b)[0];
  return w == null || alreadySent.has(w) ? null : w;
}
/** Pure: a document key the technician may attach — one of her own skill-document uploads at this salon. */
export function ownSkillDocumentKey(key: string, tenantId: string, userId: string): boolean {
  return !!tenantId && !!userId && key.startsWith(`tenants/${tenantId}/skill-docs/${userId}/`) && !key.includes('..');
}

export class TechnicianCertificationsService {
  constructor(private readonly db: Kysely<any> | null, private readonly tech: TechDataPort, private readonly today: () => string = () => utcDate()) {}   // certification dates are civil DATEs, compared UTC-keyed (a portable certificate has no one salon's zone)
  /** No database bound (in-memory dev) → honest 'no data source', never a crash. */
  private d(): Kysely<any> { if (!this.db) throw new TechError('not_found', 'No data source.'); return this.db; }

  private shape(r: any): CertificationView {
    const today = this.today(); const exp = dstr(r.expires_at);
    return {
      id: String(r.id), technicianId: r.technician_id ?? null, globalTechProfileId: r.global_tech_profile_id ?? null, name: String(r.name), issuer: r.issuer ?? null,
      issuedAt: dstr(r.issued_at), expiresAt: exp, hasDocument: !!r.document_key, verificationStatus: effectiveCertificationStatus(String(r.verification_status), exp, today),
      verifiedAt: iso(r.verified_at), verifiedByUserId: r.verified_by_user_id ?? null, revokedReason: r.revoked_reason ?? null, daysToExpiry: daysUntil(exp, today),
      createdAt: iso(r.created_at) || '', updatedAt: iso(r.updated_at) || '',
    };
  }
  private async techRow(tenantId: string, technicianId: string): Promise<{ id: string; global_tech_profile_id: string | null } | undefined> {
    return this.d().selectFrom('technicians').select(['id', 'global_tech_profile_id']).where('tenant_id', '=', tenantId).where('id', '=', technicianId).executeTakeFirst();
  }
  /** Her certifications: the portable ones (her global profile) plus any entered against this roster row. */
  private ownerFilter(q: any, technicianId: string, gtp: string | null) {
    return gtp ? q.where((eb: any) => eb.or([eb('global_tech_profile_id', '=', gtp), eb('technician_id', '=', technicianId)])) : q.where('technician_id', '=', technicianId);
  }
  private validate(ctx: TechContext, body: CertificationBody, partial = false) {
    const out: any = {};
    if (!partial || body.name !== undefined) { const name = String(body.name ?? '').trim().slice(0, 160); if (!name) throw withCode(new TechError('invalid_state', 'A certification name is required.'), 'CERTIFICATION_NAME_REQUIRED'); out.name = name; }
    if (body.issuer !== undefined) out.issuer = body.issuer == null ? null : String(body.issuer).trim().slice(0, 160) || null;
    for (const k of ['issuedAt', 'expiresAt'] as const) {
      if (body[k] !== undefined) { const v = body[k]; if (v != null && !DATE_RE.test(String(v))) throw withCode(new TechError('invalid_state', `${k} must be YYYY-MM-DD.`), 'DATE_INVALID'); out[k === 'issuedAt' ? 'issued_at' : 'expires_at'] = v ?? null; }
    }
    if (body.documentKey !== undefined) {
      const k = body.documentKey == null ? null : String(body.documentKey).trim();
      if (k && !ownSkillDocumentKey(k, ctx.tenantId, ctx.userId)) throw new TechError('invalid_state', 'documentKey must be one of your own uploads from skills/upload-document.');
      out.document_key = k || null;
    }
    return out;
  }

  // ───── technician (own) ─────
  private async myTechnician(ctx: TechContext) {
    if (!(await this.tech.technicianAppEnabled(ctx))) throw withCode(new TechError('forbidden', 'The Technician App is not enabled for this salon.'), 'TECH_APP_NOT_ENABLED');
    const id = await this.tech.resolveTechnicianId(ctx); if (!id) throw withCode(new TechError('not_technician', 'No technician profile is linked to this account.'), 'NO_TECHNICIAN_PROFILE');
    if (this.tech.technicianAppAccessEnabled && !(await this.tech.technicianAppAccessEnabled(ctx, id))) throw withCode(new TechError('forbidden', 'Your Technician App access is turned off at this salon.'), 'TECH_APP_TURNED_OFF');
    const row = await this.techRow(ctx.tenantId, id); if (!row) throw withCode(new TechError('not_technician', 'No technician profile is linked to this account.'), 'NO_TECHNICIAN_PROFILE');
    return row;
  }
  async listMine(ctx: TechContext): Promise<CertificationView[]> {
    const t = await this.myTechnician(ctx);
    const rows = await this.ownerFilter(this.d().selectFrom('technician_certifications').select([...CERT_COLS]), t.id, t.global_tech_profile_id).orderBy('expires_at', 'asc').execute();
    return (rows as any[]).map((r) => this.shape(r));
  }
  async createMine(ctx: TechContext, body: CertificationBody): Promise<CertificationView> {
    const t = await this.myTechnician(ctx); const v = this.validate(ctx, body);
    const row = await this.d().insertInto('technician_certifications').values({
      tenant_id: ctx.tenantId, global_tech_profile_id: t.global_tech_profile_id ?? null, technician_id: t.id, name: v.name, issuer: v.issuer ?? null,
      issued_at: v.issued_at ?? null, expires_at: v.expires_at ?? null, document_key: v.document_key ?? null, verification_status: 'UNVERIFIED', created_by_user_id: ctx.userId || null,
    }).returning([...CERT_COLS]).executeTakeFirstOrThrow();
    await this.tech.recordAudit(ctx, t.id, 'technician_certification_added', { data: { certificationId: row.id, name: v.name } }).catch(() => undefined);
    return this.shape(row);
  }
  async updateMine(ctx: TechContext, id: string, body: CertificationBody): Promise<CertificationView> {
    const t = await this.myTechnician(ctx); const v = this.validate(ctx, body, true);
    const cur: any = await this.ownerFilter(this.d().selectFrom('technician_certifications').select([...CERT_COLS]), t.id, t.global_tech_profile_id).where('id', '=', id).executeTakeFirst();
    if (!cur) throw withCode(new TechError('not_found', 'Certification not found.'), 'CERTIFICATION_NOT_FOUND');
    if (cur.verification_status === 'REVOKED') throw withCode(new TechError('invalid_state', 'A revoked certification cannot be edited — add a new one.'), 'CERTIFICATION_REVOKED');
    // Any change to the evidence or the dates invalidates a prior verification: the manager verified a DIFFERENT fact.
    const cmp = (x: any) => (x == null ? '' : x instanceof Date ? utcDate(x) : String(x));
    const touchesEvidence = ['name', 'issuer', 'issued_at', 'expires_at', 'document_key'].some((k) => k in v && cmp(v[k]) !== cmp(cur[k]));
    const set: any = { ...v, updated_at: sql`now()` };
    if (touchesEvidence && cur.verification_status !== 'UNVERIFIED') {
      assertTransition(TECHNICIAN_CERTIFICATION, String(cur.verification_status), 'UNVERIFIED');
      set.verification_status = 'UNVERIFIED'; set.verified_at = null; set.verified_by_user_id = null;
    }
    const row = await this.d().updateTable('technician_certifications').set(set).where('id', '=', id).returning([...CERT_COLS]).executeTakeFirstOrThrow();
    await this.tech.recordAudit(ctx, t.id, 'technician_certification_updated', { data: { certificationId: id, reverified: touchesEvidence } }).catch(() => undefined);
    return this.shape(row);
  }
  async deleteMine(ctx: TechContext, id: string): Promise<{ ok: true }> {
    const t = await this.myTechnician(ctx);
    const res: any = await this.ownerFilter(this.d().deleteFrom('technician_certifications'), t.id, t.global_tech_profile_id).where('id', '=', id).where('verification_status', '!=', 'VERIFIED').executeTakeFirst();
    if (Number(res?.numDeletedRows ?? 0) === 0) throw withCode(new TechError('not_found', 'Certification not found, or it is verified — ask a manager to revoke it.'), 'CERTIFICATION_NOT_FOUND');
    await this.tech.recordAudit(ctx, t.id, 'technician_certification_deleted', { data: { certificationId: id } }).catch(() => undefined);
    return { ok: true };
  }

  // ───── POS (manager) ─────
  async listForTechnician(tenantId: string, technicianId: string): Promise<CertificationView[]> {
    const t = await this.techRow(tenantId, technicianId); if (!t) throw withCode(new TechError('not_found', 'Technician not found.'), 'TECHNICIAN_NOT_FOUND');
    const rows = await this.ownerFilter(this.d().selectFrom('technician_certifications').select([...CERT_COLS]), t.id, t.global_tech_profile_id).orderBy('expires_at', 'asc').execute();
    return (rows as any[]).map((r) => this.shape(r));
  }
  /** VERIFY or REVOKE. Only for a technician on THIS salon's roster; the row records which salon verified, who and when. */
  async verify(ctx: { tenantId: string; branchId: string; userId: string }, technicianId: string, certificationId: string, body: { status?: string | null; reason?: string | null }): Promise<CertificationView> {
    const status = String(body?.status ?? '').toUpperCase();
    if (status !== 'VERIFIED' && status !== 'REVOKED') throw new TechError('invalid_state', 'status must be VERIFIED or REVOKED.');
    const t = await this.techRow(ctx.tenantId, technicianId); if (!t) throw withCode(new TechError('not_found', 'Technician not found.'), 'TECHNICIAN_NOT_FOUND');
    const cur: any = await this.ownerFilter(this.d().selectFrom('technician_certifications').select([...CERT_COLS]), t.id, t.global_tech_profile_id).where('id', '=', certificationId).executeTakeFirst();
    if (!cur) throw withCode(new TechError('not_found', 'Certification not found.'), 'CERTIFICATION_NOT_FOUND');
    const exp = dstr(cur.expires_at);
    if (status === 'VERIFIED' && exp && exp < this.today()) throw withCode(new TechError('invalid_state', 'This certification has expired — it cannot be verified.'), 'CERTIFICATION_EXPIRED');
    if (cur.verification_status === 'REVOKED') throw withCode(new TechError('invalid_state', 'This certification was revoked — the technician must add a new one.'), 'CERTIFICATION_REVOKED');
    assertTransition(TECHNICIAN_CERTIFICATION, String(cur.verification_status), status);
    const reason = body?.reason == null ? null : String(body.reason).trim().slice(0, 500) || null;
    if (status === 'REVOKED' && !reason) throw withCode(new TechError('invalid_state', 'A reason is required to revoke a certification.'), 'REVOKE_REASON_REQUIRED');
    const set: any = status === 'VERIFIED'
      ? { verification_status: 'VERIFIED', verified_at: sql`now()`, verified_by_user_id: ctx.userId, tenant_id: ctx.tenantId, revoked_reason: null, updated_at: sql`now()` }
      : { verification_status: 'REVOKED', verified_by_user_id: ctx.userId, revoked_reason: reason, updated_at: sql`now()` };
    const row = await this.d().updateTable('technician_certifications').set(set).where('id', '=', certificationId).returning([...CERT_COLS]).executeTakeFirstOrThrow();
    // The manager's decision is the audited fact — written, not swallowed.
    await this.d().insertInto('technician_audit_logs').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, technician_id: t.id, user_id: ctx.userId || null, action: status === 'VERIFIED' ? 'technician_certification_verified' : 'technician_certification_revoked', ticket_id: null, metadata: JSON.stringify({ certificationId, name: cur.name, reason }) }).execute();
    return this.shape(row);
  }

  // ───── expiry sweep ─────
  /** Flip past-date rows to EXPIRED and return the reminders due (one per certification per window, never repeated). */
  async sweep(reminderDays: number[] = [30, 14, 7]): Promise<{ expired: number; due: CertificationDue[] }> {
    const today = this.today();
    const exp: any = await this.d().updateTable('technician_certifications').set({ verification_status: 'EXPIRED', updated_at: sql`now()` } as any)
      .where('expires_at', 'is not', null).where('expires_at', '<', today as any).where(canMoveToSql(TECHNICIAN_CERTIFICATION, 'EXPIRED') as any).where('verification_status', '!=', 'EXPIRED').executeTakeFirst();
    const maxDays = Math.max(...reminderDays);
    const rows: any[] = await this.d().selectFrom('technician_certifications as c')
      .leftJoin('technician_certification_reminders as r', 'r.certification_id', 'c.id')
      .select(['c.id', 'c.tenant_id', 'c.technician_id', 'c.global_tech_profile_id', 'c.name', 'c.expires_at', sql<string>`coalesce(string_agg(r.days_before::text, ','), '')`.as('sent')])
      .where('c.expires_at', 'is not', null).where('c.verification_status', 'in', ['UNVERIFIED', 'VERIFIED'])
      .where('c.expires_at', '>=', today).where('c.expires_at', '<=', sql<any>`(${today}::date + ${maxDays}::int)`)
      .groupBy(['c.id', 'c.tenant_id', 'c.technician_id', 'c.global_tech_profile_id', 'c.name', 'c.expires_at']).execute();
    const due: CertificationDue[] = [];
    for (const r of rows) {
      const expiresAt = dstr(r.expires_at)!; const days = daysUntil(expiresAt, today)!;
      const sent = new Set(String(r.sent || '').split(',').filter(Boolean).map(Number));
      const window = dueReminderWindow(days, reminderDays, sent);
      if (window == null) continue;
      due.push({ certificationId: String(r.id), tenantId: r.tenant_id ?? null, technicianId: r.technician_id ?? null, globalTechProfileId: r.global_tech_profile_id ?? null, name: String(r.name), expiresAt, daysBefore: window });
    }
    return { expired: Number(exp?.numUpdatedRows ?? 0), due };
  }
  async markReminded(certificationId: string, daysBefore: number): Promise<void> {
    await this.d().insertInto('technician_certification_reminders').values({ certification_id: certificationId, days_before: daysBefore }).onConflict((oc: any) => oc.columns(['certification_id', 'days_before']).doNothing()).execute();
  }
}
