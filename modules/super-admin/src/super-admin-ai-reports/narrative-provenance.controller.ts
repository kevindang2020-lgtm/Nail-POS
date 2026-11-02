import { Controller, Post, Get, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { NarrativeProvenanceService, ProvenanceError } from './narrative-provenance.service';
import { AI_NARRATIVE_COMMIT_BODY, AI_NARRATIVE_MODEL_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof ProvenanceError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-narrative-model-versions')
export class NarrativeModelVersionController {
  constructor(private readonly svc: NarrativeProvenanceService) {}
  @Get() list() { return run(() => this.svc.listModelVersions()); }
  @Post() register(@Body(ValidatedBody(AI_NARRATIVE_MODEL_BODY, { strict: true })) b: any) { return run(() => this.svc.registerModelVersion({ modelName: b?.modelName, promptVersion: b?.promptVersion, promptText: b?.promptText, notes: b?.notes })); }
  @Post(':id/activate') activate(@Param('id') id: string) { return run(() => this.svc.activateModelVersion(id)); }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-reports')
export class NarrativeCommitController {
  constructor(private readonly svc: NarrativeProvenanceService) {}
  @Post('runs/:runId/narrative/commit') commit(@Param('runId') runId: string, @Body(ValidatedBody(AI_NARRATIVE_COMMIT_BODY, { strict: true })) b: any) { return run(() => this.svc.commitNarrative(runId, b?.modelName || 'default')); }
  @Get('runs/:runId/narrative/provenance') provenance(@Param('runId') runId: string) { return run(() => this.svc.getNarrativeByRun(runId)); }
}
