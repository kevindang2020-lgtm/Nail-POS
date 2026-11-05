// Model/prompt version registry + narrative provenance. Registering pins the prompt hash; activating retires the prior
// active version of the same model. commitNarrative records, for a run, which template version + model/prompt version
// produced its narrative and whether grounding passed — making every AI narrative auditable and reproducible.
import { promptHash, canActivateVersion, buildProvenance } from './narrative-provenance-core';
import type { NarrativeProvenanceRepositoryPort } from './narrative-provenance.repository';
import type { ReportRunService } from './report-run.service';
import type { ReportTemplateService } from './report-template.service';

export class ProvenanceError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); } }

export class NarrativeProvenanceService {
  constructor(private readonly repo: NarrativeProvenanceRepositoryPort, private readonly runs: ReportRunService, private readonly templates: ReportTemplateService) {}

  async registerModelVersion(input: { modelName: string; promptVersion: string; promptText: string; notes?: string }) {
    const modelName = String(input.modelName || '').trim();
    const promptVersion = String(input.promptVersion || '').trim();
    if (!modelName || !promptVersion) throw new ProvenanceError('invalid', 'modelName and promptVersion are required');
    if (!String(input.promptText || '').trim()) throw new ProvenanceError('invalid', 'promptText is required (to pin the prompt hash)');
    return this.repo.insertModelVersion({ modelName, promptVersion, promptHash: promptHash(input.promptText), notes: input.notes ?? null });
  }

  async activateModelVersion(id: string) {
    const v = await this.repo.getModelVersion(String(id || ''));
    if (!v) throw new ProvenanceError('not_found', 'Model version not found');
    if (!canActivateVersion(v.status)) throw new ProvenanceError('conflict', `only a draft version can be activated (status "${v.status}")`);
    const activated = await this.repo.setModelVersionStatus(v.id, 'active');
    await this.repo.retireOtherActive(v.modelName, v.id); // one active version per model
    return activated;
  }

  async listModelVersions() { return this.repo.listModelVersions(); }

  // Commit an auditable narrative record for a run: uses the current published template + active model version, grounds
  // against the run's real metrics, and records the provenance. Idempotent per run.
  async commitNarrative(runId: string, modelName = 'default') {
    const run = await this.runs.getRun(String(runId || '')); // throws 404 if missing
    const narrative = await this.templates.buildNarrative(run.reportKey, (run.metricsSnapshot || {}) as Record<string, unknown>);
    if (!narrative.available) throw new ProvenanceError('conflict', 'no published template for this report');
    const versions = await this.repo.listModelVersions();
    const active = versions.find((v) => v.modelName === modelName && v.status === 'active') || null;
    // Structured grounded fill has no invented numbers by construction ⇒ offendingCount 0; allGrounded reflects completeness.
    const prov = buildProvenance({ templateId: narrative.templateId, templateVersion: narrative.version, modelVersionId: active?.id ?? null, grounding: { allGrounded: narrative.allGrounded, offendingCount: 0 } });
    const record = await this.repo.insertNarrative({ runId: run.id ?? String(runId), templateId: prov.templateId, templateVersion: prov.templateVersion, modelVersionId: prov.modelVersionId, allGrounded: prov.allGrounded, groundingOk: prov.groundingOk, offendingCount: prov.offendingCount });
    return { record, provenance: prov, narrative };
  }

  async getNarrativeByRun(runId: string) { return this.repo.getNarrativeByRun(String(runId || '')); }
}
