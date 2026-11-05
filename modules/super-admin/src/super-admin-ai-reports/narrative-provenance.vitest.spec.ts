import { describe, it, expect, beforeEach } from 'vitest';
import { NarrativeProvenanceService, ProvenanceError } from './narrative-provenance.service';
import { InMemoryNarrativeProvenanceRepository } from './narrative-provenance.repository';
import { ReportRunService } from './report-run.service';
import { InMemoryReportRunRepository } from './report-run.repository';
import { ReportTemplateService } from './report-template.service';
import { InMemoryReportTemplateRepository } from './report-template.repository';

const sections = [{ id: 's1', title: 'Revenue', metricKeys: ['revenueCents', 'bookings'] }];
let provRepo: InMemoryNarrativeProvenanceRepository; let runs: ReportRunService; let templates: ReportTemplateService; let svc: NarrativeProvenanceService;
let runId: string;
beforeEach(async () => {
  provRepo = new InMemoryNarrativeProvenanceRepository();
  runs = new ReportRunService(new InMemoryReportRunRepository());
  templates = new ReportTemplateService(new InMemoryReportTemplateRepository());
  svc = new NarrativeProvenanceService(provRepo, runs, templates);
  const r = await runs.generate({ reportKey: 'daily_platform', start: '2026-05-01', end: '2026-05-06' });
  runId = r.run.id;
});

describe('NarrativeProvenanceService', () => {
  it('registers a model version (pins prompt hash) and rejects missing fields', async () => {
    const v = await svc.registerModelVersion({ modelName: 'default', promptVersion: '2026-05', promptText: 'Summarize using only provided metrics.' });
    expect(v.status).toBe('draft'); expect(v.promptHash).toMatch(/^ph_/);
    await expect(svc.registerModelVersion({ modelName: '', promptVersion: '1', promptText: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.registerModelVersion({ modelName: 'm', promptVersion: '1', promptText: '' })).rejects.toBeInstanceOf(ProvenanceError);
  });

  it('activating a version retires the prior active version of the same model', async () => {
    const v1 = await svc.registerModelVersion({ modelName: 'default', promptVersion: 'v1', promptText: 'p1' });
    const v2 = await svc.registerModelVersion({ modelName: 'default', promptVersion: 'v2', promptText: 'p2' });
    await svc.activateModelVersion(v1.id);
    await svc.activateModelVersion(v2.id);
    expect((await provRepo.getModelVersion(v1.id))!.status).toBe('retired');
    expect((await provRepo.getModelVersion(v2.id))!.status).toBe('active');
    await expect(svc.activateModelVersion(v2.id)).rejects.toMatchObject({ code: 'conflict' }); // already active
  });

  it('commits an auditable narrative tying run → template version → model version, grounded', async () => {
    const t = await templates.createDraft({ reportKey: 'daily_platform', name: 'v1', sections }); await templates.publish(t.id);
    const mv = await svc.registerModelVersion({ modelName: 'default', promptVersion: 'v1', promptText: 'p' }); await svc.activateModelVersion(mv.id);
    const res = await svc.commitNarrative(runId);
    expect(res.provenance).toMatchObject({ templateVersion: 1, modelVersionId: mv.id, allGrounded: true, groundingOk: true, offendingCount: 0 });
    expect(res.record.runId).toBe(runId);
  });

  it('commit is idempotent per run and 404s an unknown run', async () => {
    const t = await templates.createDraft({ reportKey: 'daily_platform', name: 'v1', sections }); await templates.publish(t.id);
    const a = await svc.commitNarrative(runId);
    const b = await svc.commitNarrative(runId);
    expect(a.record.id).toBe(b.record.id);
    expect(provRepo.narratives).toHaveLength(1);
    await expect(svc.commitNarrative('ghost')).rejects.toBeInstanceOf(Error);
  });

  it('refuses to commit when no template is published', async () => {
    await expect(svc.commitNarrative(runId)).rejects.toMatchObject({ code: 'conflict' });
  });
});
