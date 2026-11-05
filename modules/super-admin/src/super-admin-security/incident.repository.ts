// Repository port for security incidents + append-only transition history.
export interface IncidentRow { id: string; incidentRef: string; title: string; category: string; severity: string; status: string; tenant: string | null; branch: string | null; assignedTo: string | null; detectedAt: string | null; updatedAt: string | null }
export interface IncidentDetail extends IncidentRow { description: string | null; detectionSource: string | null; correlationId: string | null; containedAt: string | null; resolvedAt: string | null; events: { fromStatus: string | null; toStatus: string; actor: string | null; reason: string | null; occurredAt: string | null }[] }
export interface InsertIncidentInput { title: string; description: string | null; category: string; severity: string; detectionSource: string | null; tenantId: string | null; branchId: string | null; assignedTo: string | null; correlationId: string | null }
export interface TransitionRecord { fromStatus: string; toStatus: string; actor: string | null; reason: string | null; correlationId: string | null }
export interface IncidentActor { userId: string | null; role: string | null; name: string | null; ip: string | null }

export interface IncidentRepositoryPort {
  insert(input: InsertIncidentInput, actor: IncidentActor): Promise<IncidentRow>;
  get(id: string): Promise<IncidentDetail | null>;
  list(limit: number): Promise<IncidentRow[]>;
  applyTransition(id: string, record: TransitionRecord, actor: IncidentActor): Promise<IncidentRow | null>;
  countByStatus(): Promise<Record<string, number>>;
  openCount(): Promise<number>;
  openedToday(): Promise<number>;
}

export class InMemoryIncidentRepository implements IncidentRepositoryPort {
  incidents: (IncidentDetail & { statusHistory: any[] })[] = []; audits: any[] = []; private seq = 1;
  async insert(i: InsertIncidentInput, actor: IncidentActor): Promise<IncidentRow> {
    const now = new Date().toISOString(); const ref = `INC-${new Date().getUTCFullYear()}-${String(this.seq).padStart(3, '0')}`;
    const row: IncidentDetail & { statusHistory: any[] } = { id: `inc${this.seq++}`, incidentRef: ref, title: i.title, description: i.description, category: i.category, severity: i.severity, status: 'detected', detectionSource: i.detectionSource, tenant: i.tenantId, branch: i.branchId, assignedTo: i.assignedTo, correlationId: i.correlationId, detectedAt: now, containedAt: null, resolvedAt: null, updatedAt: now, events: [{ fromStatus: null, toStatus: 'detected', actor: actor.userId, reason: 'created', occurredAt: now }], statusHistory: [] };
    this.incidents.push(row); this.audits.push({ action: 'security_incident_opened', ref, actor: actor.userId }); return row;
  }
  async get(id: string) { return this.incidents.find((x) => x.id === id) || null; }
  async list(limit: number) { return this.incidents.slice(0, limit); }
  async applyTransition(id: string, record: TransitionRecord, actor: IncidentActor) {
    const inc = this.incidents.find((x) => x.id === id); if (!inc) return null;
    inc.status = record.toStatus; const now = new Date().toISOString(); inc.updatedAt = now;
    if (record.toStatus === 'contained') inc.containedAt = now;
    if (record.toStatus === 'closed') inc.resolvedAt = now;
    inc.events.push({ fromStatus: record.fromStatus, toStatus: record.toStatus, actor: actor.userId, reason: record.reason, occurredAt: now });
    this.audits.push({ action: 'incident_status_changed', ref: inc.incidentRef, from: record.fromStatus, to: record.toStatus, actor: actor.userId });
    return inc;
  }
  async countByStatus() { const m: Record<string, number> = {}; this.incidents.forEach((i) => { m[i.status] = (m[i.status] || 0) + 1; }); return m; }
  async openCount() { return this.incidents.filter((i) => !['closed'].includes(i.status)).length; }
  async openedToday() { return this.incidents.length; }
}
