// audit-engine.repository.ts — port + InMemory for the Security Audit Engine (runs + deduplicated findings).
import type { AuditSeverity, CheckFinding, StoredFinding } from './audit-engine-core';

export interface AuditRunRow { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null; checksRun: number; findingsOpen: number; findingsResolved: number; error: string | null }
export interface AuditFindingRow extends StoredFinding { area: string; title: string; detail: string | null; occurrences: number; incidentId: string | null; openedAt: string; resolvedAt: string | null }

export interface AuditEngineRepositoryPort {
  /** Serialize whole runs platform-wide; returns false when another runner holds the lock. */
  withRunLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }>;
  startRun(trigger: 'scheduled' | 'manual', userId: string | null): Promise<string>;
  finishRun(id: string, patch: { status: 'completed' | 'failed'; checksRun: number; findingsOpen: number; findingsResolved: number; error?: string | null }): Promise<void>;
  lastCompletedAt(): Promise<string | null>;
  listRuns(limit: number): Promise<AuditRunRow[]>;
  allFindings(): Promise<AuditFindingRow[]>;
  listFindings(status: string | null, limit: number): Promise<AuditFindingRow[]>;
  insertFinding(runId: string, f: CheckFinding, incidentId: string | null): Promise<string>;
  bumpFinding(id: string, runId: string, f: CheckFinding): Promise<void>;
  reopenFinding(id: string, runId: string, f: CheckFinding): Promise<void>;
  resolveFinding(id: string, runId: string): Promise<void>;
}

export class InMemoryAuditEngineRepository implements AuditEngineRepositoryPort {
  runs: AuditRunRow[] = [];
  findings: AuditFindingRow[] = [];
  locked = false;
  private seq = 0;
  async withRunLock<T>(fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    if (this.locked) return { ran: false };
    this.locked = true;
    try { return { ran: true, result: await fn() }; } finally { this.locked = false; }
  }
  async startRun(trigger: 'scheduled' | 'manual'): Promise<string> {
    const id = `run_${++this.seq}`;
    this.runs.unshift({ id, trigger, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, checksRun: 0, findingsOpen: 0, findingsResolved: 0, error: null });
    return id;
  }
  async finishRun(id: string, patch: { status: 'completed' | 'failed'; checksRun: number; findingsOpen: number; findingsResolved: number; error?: string | null }): Promise<void> {
    const r = this.runs.find((x) => x.id === id); if (!r) return;
    Object.assign(r, patch, { finishedAt: new Date().toISOString(), error: patch.error ?? null });
  }
  async lastCompletedAt(): Promise<string | null> { return this.runs.find((r) => r.status === 'completed')?.finishedAt ?? null; }
  async listRuns(limit: number): Promise<AuditRunRow[]> { return this.runs.slice(0, limit); }
  async allFindings(): Promise<AuditFindingRow[]> { return this.findings; }
  async listFindings(status: string | null, limit: number): Promise<AuditFindingRow[]> { return this.findings.filter((f) => !status || f.status === status).slice(0, limit); }
  async insertFinding(runId: string, f: CheckFinding, incidentId: string | null): Promise<string> {
    const id = `f_${++this.seq}`;
    this.findings.push({ id, fingerprint: `${f.area.toLowerCase()}|${f.title.toLowerCase()}`, status: 'open', severity: f.severity as AuditSeverity, area: f.area, title: f.title, detail: f.detail, occurrences: 1, incidentId, openedAt: new Date().toISOString(), resolvedAt: null } as AuditFindingRow);
    return id;
  }
  async bumpFinding(id: string, _runId: string, f: CheckFinding): Promise<void> { const x = this.findings.find((y) => y.id === id); if (x) { x.occurrences++; x.detail = f.detail; x.severity = f.severity as AuditSeverity; } }
  async reopenFinding(id: string, _runId: string, f: CheckFinding): Promise<void> { const x = this.findings.find((y) => y.id === id); if (x) { x.status = 'reopened'; x.occurrences++; x.detail = f.detail; x.resolvedAt = null; } }
  async resolveFinding(id: string): Promise<void> { const x = this.findings.find((y) => y.id === id); if (x) { x.status = 'resolved'; x.resolvedAt = new Date().toISOString(); } }
}
