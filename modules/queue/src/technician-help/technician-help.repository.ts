// In-memory HelpRepositoryPort — the test seam + module fallback. Seed open tickets + service lines, then drive the
// lifecycle; the reassignment of a line's technician is observable via lineTechnician().
import type { HelpRepositoryPort, HelpActor, HelpRequest, HelpStatus, ServiceLineRef } from './technician-help.service';
export type { HelpRepositoryPort } from './technician-help.service';

interface Line { serviceLineId: string; ticketId: string; serviceId: string | null; technicianId: string | null; }

export class InMemoryHelpRepository implements HelpRepositoryPort {
  private reqs: HelpRequest[] = [];
  private lines = new Map<string, Line>();
  private openTickets = new Set<string>();
  readonly audits: { action: string; entityId: string; metadata: unknown }[] = [];
  private seq = 1;

  seedTicket(ticketId: string, open = true) { if (open) this.openTickets.add(ticketId); else this.openTickets.delete(ticketId); }
  seedLine(l: Line) { this.lines.set(l.serviceLineId, { ...l }); this.openTickets.add(l.ticketId); }
  lineTechnician(serviceLineId: string): string | null { return this.lines.get(serviceLineId)?.technicianId ?? null; }

  async ticketIsOpen(_a: HelpActor, ticketId: string) { return this.openTickets.has(ticketId); }
  async loadServiceLine(_a: HelpActor, ticketId: string, serviceLineId: string): Promise<ServiceLineRef | null> {
    const l = this.lines.get(serviceLineId); return l && l.ticketId === ticketId ? { ...l } : null;
  }
  async hasOpenRequest(a: HelpActor, serviceLineId: string, helperTechnicianId: string) {
    return this.reqs.some((r) => r.tenantId === a.tenantId && r.serviceLineId === serviceLineId && r.helperTechnicianId === helperTechnicianId && (r.status === 'pending' || r.status === 'accepted'));
  }
  async insertRequest(_a: HelpActor, row: Omit<HelpRequest, 'id' | 'createdAt' | 'status' | 'respondedAt' | 'declineReason'>): Promise<HelpRequest> {
    const r: HelpRequest = { ...row, id: 'help_' + (this.seq++), status: 'pending', respondedAt: null, declineReason: null, createdAt: new Date().toISOString() };
    this.reqs.push(r); return { ...r };
  }
  async getRequest(a: HelpActor, id: string) { const r = this.reqs.find((x) => x.id === id && x.tenantId === a.tenantId); return r ? { ...r } : null; }
  async transition(a: HelpActor, id: string, from: HelpStatus, to: HelpStatus, patch: { respondedAt?: string; declineReason?: string }) {
    const r = this.reqs.find((x) => x.id === id && x.tenantId === a.tenantId);
    if (!r || r.status !== from) return false;
    r.status = to; if (patch.respondedAt) r.respondedAt = patch.respondedAt; if (patch.declineReason !== undefined) r.declineReason = patch.declineReason ?? null;
    return true;
  }
  async assignLineTechnician(_a: HelpActor, ticketId: string, serviceLineId: string, technicianId: string) {
    const l = this.lines.get(serviceLineId); if (l && l.ticketId === ticketId) l.technicianId = technicianId;
  }
  async listForHelper(a: HelpActor, helperTechnicianId: string, statuses: HelpStatus[]) {
    return this.reqs.filter((r) => r.tenantId === a.tenantId && r.helperTechnicianId === helperTechnicianId && statuses.includes(r.status)).map((r) => ({ ...r }));
  }
  async listForTicket(a: HelpActor, ticketId: string) {
    return this.reqs.filter((r) => r.tenantId === a.tenantId && r.ticketId === ticketId).map((r) => ({ ...r }));
  }
  async writeAudit(_a: HelpActor, action: string, entityId: string, metadata: unknown) { this.audits.push({ action, entityId, metadata }); }
}
