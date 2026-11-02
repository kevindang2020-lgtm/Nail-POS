// malformed-input-4xx — Security Deep Scan §163 run 3 (Oct 27 2026): two Super Admin routes answered 5xx on malformed input.
//   GET /super-admin/ai-reports/runs/:runId/narrative — "Report run not found" re-thrown with status 500 → 404 RESOURCE_NOT_FOUND
//   GET /super-admin/tenants/:id/payment-gateway (and its writes) — a non-uuid id reached the gateway resolver → 400 up front
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { ReportNarrativeController } from './super-admin-ai-reports/report-template.controller';
import { ReportRunService } from './super-admin-ai-reports/report-run.service';
import { SuperAdminTenantsController } from './super-admin-tenants/super-admin-tenants.controller';

const outcome = async (p: unknown) => { try { await (typeof p === 'function' ? (p as () => unknown)() : p); return { status: 200, body: null as any }; } catch (e) { return e instanceof HttpException ? { status: e.getStatus(), body: e.getResponse() as any } : { status: 500, body: e }; } };

describe('§163 run 3 — Super Admin routes answer 4xx on malformed input', () => {
  it('narrative for an unknown run is 404 RESOURCE_NOT_FOUND (the real ReportRunService refusal)', async () => {
    const runs: any = Object.create(ReportRunService.prototype); runs.repo = { getRun: async () => null };
    const ctl = new ReportNarrativeController({} as any, runs);
    expect(await outcome(ctl.narrative("' OR '1'='1"))).toMatchObject({ status: 404, body: { code: 'RESOURCE_NOT_FOUND' } });
  });
  it('an error outside the narrative taxonomy is passed through unwrapped (a database data error becomes 400 INVALID_INPUT in the filter)', async () => {
    const db = Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    const ctl = new ReportNarrativeController({} as any, { getRun: async () => { throw db; } } as any);
    await expect(ctl.narrative('x')).rejects.toBe(db);
  });
  it('payment-gateway routes refuse a non-uuid salon id with 400 before the resolver is called', async () => {
    let calls = 0; const gw: any = new Proxy({}, { get: () => async () => { calls++; return { status: 'active' }; } });
    const ctl = new SuperAdminTenantsController({} as any, gw);
    for (const p of [() => ctl.getGateway("' OR '1'='1"), () => ctl.setGateway('../../etc/passwd', {} as any, {}), () => ctl.patchGateway('<script>', {} as any, {}), () => ctl.testGateway('1;DROP TABLE users--')]) {
      expect(await outcome(p)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED', details: { field: 'id' } } });
    }
    expect(calls).toBe(0);
    expect((await outcome(ctl.getGateway('11111111-1111-4111-8111-111111111111'))).status).toBe(200);
  });
});
