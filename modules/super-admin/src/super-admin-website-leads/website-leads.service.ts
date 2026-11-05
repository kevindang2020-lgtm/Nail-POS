// website-leads.service.ts — orchestrates the Website Leads surface over the repo + pure core. Builds the one-shot
// `state` payload (KPIs, filtered/paginated leads, analytics, recent activity, permissions), handles every lead action,
// and writes audit rows for the meaningful ones. Super-admin-only (the controller guards it).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { WebsiteLeadsRepo, NewLead } from './website-leads.repository';
import {
  computeLeadKpis, computeLeadScore, filterLeads, paginate, analyticsBySource, analyticsByStatus, topSources,
  LEAD_STATUSES, LEAD_SOURCES, type LeadRow, type LeadFilter,
} from './website-leads-core';

export class WebsiteLeadsError extends Error { constructor(public code: 'not_found' | 'bad_request', message: string) { super(message); } }
export interface AdminCtx { userId?: string; ip?: string }
export interface LeadsQuery extends LeadFilter { page?: number; limit?: number }

const PERMS = {
  view: true, create: true, edit: true, delete: true, export: true, assign: true, convert: true, archive: true, markSpam: true,
};

export class WebsiteLeadsService {
  constructor(private readonly repo: WebsiteLeadsRepo, private readonly db: AppDatabase = null) {}

  private fillNames(rows: LeadRow[], users: { id: string; name: string }[]): LeadRow[] {
    const m = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, assignedToName: r.assignedToUserId ? m.get(r.assignedToUserId) ?? null : null }));
  }
  private async withNames(rows: LeadRow[]): Promise<LeadRow[]> {
    return this.fillNames(rows, await this.repo.listAssignableUsers().catch(() => []));
  }

  async state(q: LeadsQuery) {
    const all = await this.repo.all();
    const filtered = filterLeads(all, q);
    const { items, pagination } = paginate(filtered, q.page ?? 1, q.limit ?? 10);
    const [assignableUsers, recentActivity] = await Promise.all([this.repo.listAssignableUsers().catch(() => []), this.repo.recentActivity(12)]);
    return {
      kpis: computeLeadKpis(all),
      filters: { search: q.search ?? '', source: q.source ?? 'all', status: q.status ?? 'all', scoreRange: q.scoreRange ?? 'all', dateFrom: q.dateFrom ?? null, dateTo: q.dateTo ?? null },
      leads: this.fillNames(items, assignableUsers), pagination,
      analytics: { bySource: analyticsBySource(all), byStatus: analyticsByStatus(all), topSources: topSources(all) },
      recentActivity,
      permissions: PERMS,
      sources: LEAD_SOURCES, statuses: LEAD_STATUSES,
      assignableUsers,
    };
  }

  async list(q: LeadsQuery) {
    const all = await this.repo.all();
    const { items, pagination } = paginate(filterLeads(all, q), q.page ?? 1, q.limit ?? 10);
    return { leads: await this.withNames(items), pagination };
  }
  async kpis() { return computeLeadKpis(await this.repo.all()); }
  async bySource() { return analyticsBySource(await this.repo.all()); }
  async byStatus() { return analyticsByStatus(await this.repo.all()); }
  async topSources() { return topSources(await this.repo.all()); }
  async recentActivity(limit = 12) { return this.repo.recentActivity(limit); }

  async getLead(id: string) {
    const lead = await this.repo.getById(id);
    if (!lead) throw new WebsiteLeadsError('not_found', 'lead_not_found');
    const [withName] = await this.withNames([lead]);
    const [activities, followUps] = await Promise.all([this.repo.listActivities(id), this.repo.listFollowUps(id)]);
    return { lead: withName, activities, followUps };
  }

  async createLead(ctx: AdminCtx, body: any) {
    const input: NewLead = {
      salonName: body?.salonName ?? null, contactName: body?.contactName ?? null, phone: body?.phone ?? null, email: body?.email ?? null,
      city: body?.city ?? null, state: body?.state ?? null, source: this.coerceSource(body?.source), status: 'new', message: body?.message ?? null,
      currentPos: body?.currentPos ?? null, technicianCount: numOrNull(body?.technicianCount), monthlyCardVolumeCents: numOrNull(body?.monthlyCardVolumeCents),
      assignedToUserId: body?.assignedToUserId ?? null, nextFollowUpAt: body?.nextFollowUpAt ?? null,
    };
    // Auto-score if none supplied.
    input.leadScore = body?.leadScore != null ? clampScore(body.leadScore) : computeLeadScore(input as any);
    const id = await this.repo.insert(input);
    await this.repo.addActivity({ leadId: id, activityType: 'created', title: 'New lead received', message: input.salonName ?? null, createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_created', id, { salonName: input.salonName, source: input.source });
    return this.getLead(id);
  }

  async updateLead(ctx: AdminCtx, id: string, body: any) {
    await this.requireExists(id);
    await this.repo.update(id, {
      salonName: body?.salonName, contactName: body?.contactName, phone: body?.phone, email: body?.email, city: body?.city, state: body?.state,
      source: body?.source != null ? this.coerceSource(body.source) : undefined, message: body?.message, currentPos: body?.currentPos,
      technicianCount: numOrNull(body?.technicianCount), monthlyCardVolumeCents: numOrNull(body?.monthlyCardVolumeCents),
      leadScore: body?.leadScore != null ? clampScore(body.leadScore) : undefined,
    });
    await this.audit(ctx, 'super_admin_website_lead_updated', id, {});
    return this.getLead(id);
  }

  async setStatus(ctx: AdminCtx, id: string, status: string) {
    if (!LEAD_STATUSES.includes(status as any)) throw new WebsiteLeadsError('bad_request', 'invalid_status');
    await this.requireExists(id);
    const patch: any = { status };
    if (status === 'archived') patch.archivedAt = new Date().toISOString();
    await this.repo.update(id, patch);
    await this.repo.addActivity({ leadId: id, activityType: 'status_change', title: `Lead ${status}`, createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_status', id, { status });
    return this.getLead(id);
  }

  async assign(ctx: AdminCtx, id: string, assignedToUserId: string | null) {
    await this.requireExists(id);
    await this.repo.update(id, { assignedToUserId });
    await this.repo.addActivity({ leadId: id, activityType: 'assigned', title: 'Lead assigned', createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_assigned', id, { assignedToUserId });
    return this.getLead(id);
  }

  async addNote(ctx: AdminCtx, id: string, text: string) {
    if (!text?.trim()) throw new WebsiteLeadsError('bad_request', 'empty_note');
    await this.requireExists(id);
    await this.repo.addActivity({ leadId: id, activityType: 'note', title: 'Note added', message: text.trim(), createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_note', id, {});
    return this.getLead(id);
  }

  async scheduleFollowUp(ctx: AdminCtx, id: string, body: any) {
    await this.requireExists(id);
    await this.repo.addFollowUp({ leadId: id, assignedToUserId: body?.assignedToUserId ?? null, dueAt: body?.dueAt ?? null, notes: body?.notes ?? null });
    if (body?.dueAt) await this.repo.update(id, { nextFollowUpAt: body.dueAt });
    await this.repo.addActivity({ leadId: id, activityType: 'follow_up_scheduled', title: 'Follow-up scheduled', message: body?.dueAt ?? null, createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_follow_up', id, { dueAt: body?.dueAt ?? null });
    return this.getLead(id);
  }

  async convertToApplication(ctx: AdminCtx, id: string) {
    const lead = await this.repo.getById(id);
    if (!lead) throw new WebsiteLeadsError('not_found', 'lead_not_found');
    if (lead.convertedApplicationId) throw new WebsiteLeadsError('bad_request', 'already_converted');
    const applicationId = await this.repo.createApplicationFromLead(lead);
    await this.repo.update(id, { status: 'converted', convertedApplicationId: applicationId });
    await this.repo.addActivity({ leadId: id, activityType: 'converted', title: 'Lead converted to application', message: lead.salonName ?? null, createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_converted', id, { applicationId });
    return { ok: true as const, applicationId, ...(await this.getLead(id)) };
  }

  async recalculateScore(ctx: AdminCtx, id: string) {
    const lead = await this.repo.getById(id);
    if (!lead) throw new WebsiteLeadsError('not_found', 'lead_not_found');
    const leadScore = computeLeadScore(lead);
    await this.repo.update(id, { leadScore });
    await this.repo.addActivity({ leadId: id, activityType: 'score_changed', title: `Score recalculated: ${leadScore}`, createdByUserId: ctx.userId ?? null });
    await this.audit(ctx, 'super_admin_website_lead_score', id, { leadScore });
    return { ok: true as const, leadScore };
  }

  async exportCsv(q: LeadsQuery): Promise<string> {
    const rows = filterLeads(await this.repo.all(), q);
    const withNames = await this.withNames(rows);
    const cols = ['id', 'salonName', 'contactName', 'phone', 'email', 'city', 'state', 'source', 'leadScore', 'status', 'assignedToName', 'nextFollowUpAt', 'createdAt', 'convertedApplicationId'];
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...withNames.map((r: any) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  }

  // helpers
  private coerceSource(s: any): string { const v = String(s ?? '').toLowerCase(); return (LEAD_SOURCES as readonly string[]).includes(v) ? v : 'manual'; }
  private async requireExists(id: string) { if (!(await this.repo.getById(id))) throw new WebsiteLeadsError('not_found', 'lead_not_found'); }
  private async audit(ctx: AdminCtx, action: string, leadId: string, meta: any) {
    if (!this.db) return;
    await sql`insert into audit_logs (id, tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (gen_random_uuid(), null, ${ctx.userId ?? null}, 'super_admin', ${action}, 'website_lead', ${leadId}, ${JSON.stringify(meta)})`
      .execute(this.db as any).catch(() => undefined);
  }
}

const numOrNull = (v: any): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const clampScore = (v: any): number => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
