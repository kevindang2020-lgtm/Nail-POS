// audit-investigations.service.ts — Open Investigation / case management. Opening a case requires a title; linking
// events and adding notes are APPEND-ONLY (they never rewrite prior timeline entries or any audit_events row). Status
// transitions update only the case status and append a status_change entry. The timeline is immutable evidence.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditInvestigationsRepository, type InvestigationRow, type TimelineRow } from './audit-investigations.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed', 'reopened'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const shape = (r: InvestigationRow) => ({ id: r.id, caseRef: r.case_ref, title: r.title, tenantId: r.tenant_id, severity: r.severity, assignee: r.assignee, status: r.status, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at });
const shapeTimeline = (t: TimelineRow) => ({ id: t.id, entryType: t.entry_type, payload: t.payload, author: t.author, createdAt: t.created_at });

export class AuditInvestigationsService {
  constructor(private readonly repo: AuditInvestigationsRepository) {}

  async list(status?: string) { return { investigations: (await this.repo.list(status)).map(shape) }; }
  async get(id: string) {
    const inv = await this.repo.get(id);
    if (!inv) throw new NotFoundException('investigation not found');
    return { investigation: shape(inv), timeline: (await this.repo.timeline(id)).map(shapeTimeline) };
  }

  async open(ctx: AdminCtx, body: any) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (title.length < 3) throw new BadRequestException('an investigation title is required');
    const severity = SEVERITIES.includes(String(body?.severity)) ? String(body.severity) : 'medium';
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;
    const assignee = typeof body?.assignee === 'string' && body.assignee.trim() ? body.assignee.trim() : null;
    const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null;
    const caseRef = `INV-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const row = await this.repo.insert({ caseRef, title, tenantId, severity, assignee, description, createdBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    // Optionally link initial events (append-only).
    const eventRefs: string[] = Array.isArray(body?.eventRefs) ? body.eventRefs.map((e: unknown) => String(e)).filter(Boolean) : [];
    for (const ref of eventRefs) await this.repo.appendTimeline(row.id, 'event_linked', { eventRef: ref }, ctx.email ?? 'super_admin');
    await this.repo.writeAudit(tenantId, ctx, 'investigation_opened', `Investigation ${caseRef} opened: ${title}`, { caseRef, severity, linkedEvents: eventRefs.length });
    return { ok: true, investigation: shape(row), linkedEvents: eventRefs.length };
  }

  async addEvent(ctx: AdminCtx, id: string, body: any) {
    const inv = await this.repo.get(id);
    if (!inv) throw new NotFoundException('investigation not found');
    const eventRef = typeof body?.eventRef === 'string' ? body.eventRef.trim() : '';
    if (!eventRef) throw new BadRequestException('eventRef is required');
    await this.repo.appendTimeline(id, 'event_linked', { eventRef }, ctx.email ?? 'super_admin');
    await this.repo.writeAudit(inv.tenant_id, ctx, 'investigation_event_linked', `Event linked to ${inv.case_ref}`, { caseRef: inv.case_ref, eventRef });
    return { ok: true };
  }

  async addNote(ctx: AdminCtx, id: string, body: any) {
    const inv = await this.repo.get(id);
    if (!inv) throw new NotFoundException('investigation not found');
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length < 1) throw new BadRequestException('a note is required');
    await this.repo.appendTimeline(id, 'note', { note }, ctx.email ?? 'super_admin');
    return { ok: true };
  }

  async setStatus(ctx: AdminCtx, id: string, body: any) {
    const inv = await this.repo.get(id);
    if (!inv) throw new NotFoundException('investigation not found');
    const status = String(body?.status ?? '');
    if (!STATUSES.includes(status)) throw new BadRequestException('invalid status');
    const from = inv.status;
    await this.repo.setStatus(id, status);
    await this.repo.appendTimeline(id, 'status_change', { from, to: status, reason: typeof body?.reason === 'string' ? body.reason : null }, ctx.email ?? 'super_admin');
    await this.repo.writeAudit(inv.tenant_id, ctx, 'investigation_status_changed', `Investigation ${inv.case_ref}: ${from} → ${status}`, { caseRef: inv.case_ref, from, to: status });
    const after = await this.repo.get(id);
    return { ok: true, investigation: after ? shape(after) : null };
  }
}
