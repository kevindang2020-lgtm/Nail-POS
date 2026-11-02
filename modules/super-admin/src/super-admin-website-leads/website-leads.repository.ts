// website-leads.repository.ts — data access for Website Leads over the (extended) website_leads table + lead_activities
// + lead_follow_ups, with tenant_applications as the convert target. InMemory starts empty (no fabricated data); Kysely
// reads/writes real rows with guarded raw sql.
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import type { LeadRow } from './website-leads-core';

export interface LeadActivity { id: string; leadId: string; activityType: string; title: string | null; message: string | null; createdByUserId: string | null; createdAt: string; leadName?: string | null }
export interface LeadFollowUp { id: string; leadId: string; assignedToUserId: string | null; dueAt: string | null; completedAt: string | null; status: string; notes: string | null; createdAt: string }
export interface AssignableUser { id: string; name: string }
export interface NewLead {
  salonName?: string | null; contactName?: string | null; phone?: string | null; email?: string | null; city?: string | null; state?: string | null;
  source?: string | null; leadScore?: number | null; status?: string; message?: string | null; currentPos?: string | null;
  technicianCount?: number | null; monthlyCardVolumeCents?: number | null; assignedToUserId?: string | null; nextFollowUpAt?: string | null;
}

export interface WebsiteLeadsRepo {
  all(): Promise<LeadRow[]>;
  getById(id: string): Promise<LeadRow | null>;
  insert(input: NewLead): Promise<string>;
  update(id: string, patch: Partial<NewLead> & { archivedAt?: string | null; convertedApplicationId?: string | null }): Promise<void>;
  addActivity(a: { leadId: string; activityType: string; title?: string | null; message?: string | null; createdByUserId?: string | null }): Promise<void>;
  listActivities(leadId: string): Promise<LeadActivity[]>;
  recentActivity(limit: number): Promise<LeadActivity[]>;
  addFollowUp(f: { leadId: string; assignedToUserId?: string | null; dueAt?: string | null; notes?: string | null }): Promise<void>;
  listFollowUps(leadId: string): Promise<LeadFollowUp[]>;
  createApplicationFromLead(lead: LeadRow): Promise<string>;
  listAssignableUsers(): Promise<AssignableUser[]>;
}

const nowIso = () => new Date().toISOString();

export class InMemoryWebsiteLeadsRepo implements WebsiteLeadsRepo {
  public leads: LeadRow[] = [];
  public activities: LeadActivity[] = [];
  public followUps: LeadFollowUp[] = [];
  public users: AssignableUser[] = [];
  async all() { return this.leads.map((r) => ({ ...r })); }
  async getById(id: string) { return this.leads.find((r) => r.id === id) ?? null; }
  async insert(i: NewLead) {
    const id = randomUUID(); const ts = nowIso();
    this.leads.unshift({ id, salonName: i.salonName ?? null, contactName: i.contactName ?? null, phone: i.phone ?? null, email: i.email ?? null, city: i.city ?? null, state: i.state ?? null, source: i.source ?? 'manual', leadScore: i.leadScore ?? null, status: i.status ?? 'new', message: i.message ?? null, currentPos: i.currentPos ?? null, technicianCount: i.technicianCount ?? null, monthlyCardVolumeCents: i.monthlyCardVolumeCents ?? null, assignedToUserId: i.assignedToUserId ?? null, assignedToName: null, nextFollowUpAt: i.nextFollowUpAt ?? null, convertedApplicationId: null, createdAt: ts, updatedAt: ts });
    return id;
  }
  async update(id: string, p: any) { const r = this.leads.find((x) => x.id === id); if (!r) return; Object.assign(r, { salonName: p.salonName ?? r.salonName, contactName: p.contactName ?? r.contactName, phone: p.phone ?? r.phone, email: p.email ?? r.email, city: p.city ?? r.city, state: p.state ?? r.state, source: p.source ?? r.source, leadScore: p.leadScore !== undefined ? p.leadScore : r.leadScore, status: p.status ?? r.status, message: p.message ?? r.message, currentPos: p.currentPos ?? r.currentPos, technicianCount: p.technicianCount ?? r.technicianCount, monthlyCardVolumeCents: p.monthlyCardVolumeCents ?? r.monthlyCardVolumeCents, assignedToUserId: p.assignedToUserId !== undefined ? p.assignedToUserId : r.assignedToUserId, nextFollowUpAt: p.nextFollowUpAt !== undefined ? p.nextFollowUpAt : r.nextFollowUpAt, convertedApplicationId: p.convertedApplicationId ?? r.convertedApplicationId, updatedAt: nowIso() }); }
  async addActivity(a: any) { this.activities.unshift({ id: randomUUID(), leadId: a.leadId, activityType: a.activityType, title: a.title ?? null, message: a.message ?? null, createdByUserId: a.createdByUserId ?? null, createdAt: nowIso(), leadName: this.leads.find((l) => l.id === a.leadId)?.salonName ?? null }); }
  async listActivities(leadId: string) { return this.activities.filter((a) => a.leadId === leadId); }
  async recentActivity(limit: number) { return this.activities.slice(0, limit); }
  async addFollowUp(f: any) { this.followUps.unshift({ id: randomUUID(), leadId: f.leadId, assignedToUserId: f.assignedToUserId ?? null, dueAt: f.dueAt ?? null, completedAt: null, status: 'open', notes: f.notes ?? null, createdAt: nowIso() }); }
  async listFollowUps(leadId: string) { return this.followUps.filter((f) => f.leadId === leadId); }
  async createApplicationFromLead() { return randomUUID(); }
  async listAssignableUsers() { return this.users.map((u) => ({ ...u })); }
}

export class KyselyWebsiteLeadsRepo implements WebsiteLeadsRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): LeadRow => ({
    id: String(r.id), salonName: r.salon_name ?? null, contactName: r.contact_name ?? r.name ?? null, phone: r.phone ?? null, email: r.email ?? null,
    city: r.city ?? null, state: r.state ?? null, source: r.source ?? null, leadScore: r.lead_score ?? null, status: String(r.status),
    message: r.message ?? null, currentPos: r.current_pos ?? null, technicianCount: r.technician_count ?? null, monthlyCardVolumeCents: r.monthly_card_volume_cents != null ? Number(r.monthly_card_volume_cents) : null,
    assignedToUserId: r.assigned_to_user_id ?? null, assignedToName: null, nextFollowUpAt: r.next_follow_up_at ? new Date(r.next_follow_up_at).toISOString() : null,
    convertedApplicationId: r.application_id ?? null, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  });
  async all(): Promise<LeadRow[]> {
    return sql`select id, salon_name, contact_name, name, phone, email, city, state, source, lead_score, status, message, current_pos, technician_count, monthly_card_volume_cents, assigned_to_user_id, next_follow_up_at, application_id, created_at, updated_at from website_leads order by created_at desc`
      .execute(this.db).then((r: any) => r.rows.map(this.map)).catch(() => []);
  }
  async getById(id: string): Promise<LeadRow | null> {
    return sql`select id, salon_name, contact_name, name, phone, email, city, state, source, lead_score, status, message, current_pos, technician_count, monthly_card_volume_cents, assigned_to_user_id, next_follow_up_at, application_id, created_at, updated_at from website_leads where id = ${id}`
      .execute(this.db).then((r: any) => (r.rows[0] ? this.map(r.rows[0]) : null)).catch(() => null);
  }
  async insert(i: NewLead): Promise<string> {
    const r: any = await sql`
      insert into website_leads (kind, salon_name, contact_name, name, phone, email, city, state, source, lead_score, status, message, current_pos, technician_count, monthly_card_volume_cents, assigned_to_user_id, next_follow_up_at)
      values ('contact', ${i.salonName ?? null}, ${i.contactName ?? null}, ${i.contactName ?? null}, ${i.phone ?? null}, ${i.email ?? null}, ${i.city ?? null}, ${i.state ?? null}, ${i.source ?? 'manual'}, ${i.leadScore ?? null}, ${i.status ?? 'new'}, ${i.message ?? null}, ${i.currentPos ?? null}, ${i.technicianCount ?? null}, ${i.monthlyCardVolumeCents ?? null}, ${i.assignedToUserId ?? null}, ${i.nextFollowUpAt ?? null})
      returning id`.execute(this.db);
    return String(r.rows[0].id);
  }
  async update(id: string, p: any): Promise<void> {
    await sql`update website_leads set
      salon_name = coalesce(${p.salonName ?? null}, salon_name), contact_name = coalesce(${p.contactName ?? null}, contact_name),
      phone = coalesce(${p.phone ?? null}, phone), email = coalesce(${p.email ?? null}, email), city = coalesce(${p.city ?? null}, city), state = coalesce(${p.state ?? null}, state),
      source = coalesce(${p.source ?? null}, source), lead_score = ${p.leadScore !== undefined ? p.leadScore : sql`lead_score`}, status = coalesce(${p.status ?? null}, status),
      message = coalesce(${p.message ?? null}, message), current_pos = coalesce(${p.currentPos ?? null}, current_pos),
      technician_count = coalesce(${p.technicianCount ?? null}, technician_count), monthly_card_volume_cents = coalesce(${p.monthlyCardVolumeCents ?? null}, monthly_card_volume_cents),
      assigned_to_user_id = ${p.assignedToUserId !== undefined ? p.assignedToUserId : sql`assigned_to_user_id`}, next_follow_up_at = ${p.nextFollowUpAt !== undefined ? p.nextFollowUpAt : sql`next_follow_up_at`},
      application_id = coalesce(${p.convertedApplicationId ?? null}, application_id), archived_at = ${p.archivedAt !== undefined ? p.archivedAt : sql`archived_at`}, updated_at = now()
      where id = ${id}`.execute(this.db).catch(() => undefined);
  }
  async addActivity(a: any): Promise<void> {
    await sql`insert into lead_activities (lead_id, activity_type, title, message, created_by_user_id) values (${a.leadId}, ${a.activityType}, ${a.title ?? null}, ${a.message ?? null}, ${a.createdByUserId ?? null})`.execute(this.db).catch(() => undefined);
  }
  async listActivities(leadId: string): Promise<LeadActivity[]> {
    return sql`select id, lead_id, activity_type, title, message, created_by_user_id, created_at from lead_activities where lead_id = ${leadId} order by created_at desc`
      .execute(this.db).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), leadId: String(x.lead_id), activityType: String(x.activity_type), title: x.title ?? null, message: x.message ?? null, createdByUserId: x.created_by_user_id ?? null, createdAt: new Date(x.created_at).toISOString() }))).catch(() => []);
  }
  async recentActivity(limit: number): Promise<LeadActivity[]> {
    return sql`select a.id, a.lead_id, a.activity_type, a.title, a.message, a.created_at, l.salon_name lead_name from lead_activities a left join website_leads l on l.id = a.lead_id order by a.created_at desc limit ${limit}`
      .execute(this.db).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), leadId: String(x.lead_id), activityType: String(x.activity_type), title: x.title ?? null, message: x.message ?? null, createdByUserId: null, createdAt: new Date(x.created_at).toISOString(), leadName: x.lead_name ?? null }))).catch(() => []);
  }
  async addFollowUp(f: any): Promise<void> {
    await sql`insert into lead_follow_ups (lead_id, assigned_to_user_id, due_at, notes) values (${f.leadId}, ${f.assignedToUserId ?? null}, ${f.dueAt ?? null}, ${f.notes ?? null})`.execute(this.db).catch(() => undefined);
  }
  async listFollowUps(leadId: string): Promise<LeadFollowUp[]> {
    return sql`select id, lead_id, assigned_to_user_id, due_at, completed_at, status, notes, created_at from lead_follow_ups where lead_id = ${leadId} order by due_at asc nulls last`
      .execute(this.db).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), leadId: String(x.lead_id), assignedToUserId: x.assigned_to_user_id ?? null, dueAt: x.due_at ? new Date(x.due_at).toISOString() : null, completedAt: x.completed_at ? new Date(x.completed_at).toISOString() : null, status: String(x.status), notes: x.notes ?? null, createdAt: new Date(x.created_at).toISOString() }))).catch(() => []);
  }
  async createApplicationFromLead(lead: LeadRow): Promise<string> {
    const r: any = await sql`
      insert into tenant_applications (salon_name, owner_name, phone, email, city, state, technicians_count, current_pos, monthly_card_volume_cents, source, status)
      values (${lead.salonName ?? 'Unknown salon'}, ${lead.contactName ?? 'Unknown'}, ${lead.phone ?? null}, ${lead.email ?? null}, ${lead.city ?? null}, ${lead.state ?? null}, ${lead.technicianCount ?? null}, ${lead.currentPos ?? null}, ${lead.monthlyCardVolumeCents ?? null}, ${lead.source ?? null}, 'new')
      returning id`.execute(this.db);
    return String(r.rows[0].id);
  }
  async listAssignableUsers(): Promise<AssignableUser[]> {
    return sql`select id, coalesce(full_name, first_name, email, 'Staff') name from users where role = 'SUPER_ADMIN' order by full_name nulls last limit 100`
      .execute(this.db).then((r: any) => r.rows.map((x: any) => ({ id: String(x.id), name: String(x.name) }))).catch(() => []);
  }
}
