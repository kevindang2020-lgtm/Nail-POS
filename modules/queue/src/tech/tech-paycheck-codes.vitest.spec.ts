// tech-paycheck-codes — pilot phase 10e2 (Oct 27 2026): a WRONG QR handoff code on POST /tech/payroll/cash-payouts/:id/acknowledge
// answered 400 BAD_REQUEST (TechError 'invalid_state') — the payroll service's 401 HANDOFF_TOKEN_INVALID was flattened. A
// payroll refusal with a registry code now keeps its status and code through the Tech App route.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { TechService } from './tech.service';
import { TechController } from './tech.controller';

class CodedRefusal extends Error { constructor(readonly code: string, readonly status: number, message: string) { super(message); } }
const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'TECHNICIAN', permissions: ['tech.payroll.view'] } as any;
function controllerWith(thrown: Error | null) {
  const repo: any = { technicianAppEnabled: async () => true, resolveTechnicianId: async () => 'tech-1' };
  const svc = new TechService(repo);
  svc.paychecks = { acknowledgeCashByTechnician: async () => { if (thrown) throw thrown; return { id: 'p1', cashAckMethod: 'qr_handoff' }; } } as any;
  return new TechController(svc, {} as any);
}

describe('Tech App cash acknowledgement keeps the payroll registry code', () => {
  it('a wrong handoff code → 401 HANDOFF_TOKEN_INVALID (an exposed client error), not 400', async () => {
    const ctl = controllerWith(new CodedRefusal('HANDOFF_TOKEN_INVALID', 401, 'That handoff code is not valid any more.'));
    await expect(ctl.ackCash({ ctx }, 'p1', { handoffCode: 'ZZZZZZZZ' })).rejects.toMatchObject({ status: 401, code: 'HANDOFF_TOKEN_INVALID', expose: true });
  });
  it('other coded refusals keep theirs too (409 / 404); an uncoded 4xx still maps through TechError', async () => {
    await expect(controllerWith(new CodedRefusal('PAYROLL_PERIOD_NOT_READY', 409, 'x')).ackCash({ ctx }, 'p1', {})).rejects.toMatchObject({ status: 409, code: 'PAYROLL_PERIOD_NOT_READY' });
    const plain = Object.assign(new Error('gone'), { status: 404 });
    await expect(controllerWith(plain).ackCash({ ctx }, 'p1', {})).rejects.toMatchObject({ status: 404 });
  });
  it('the right code confirms', async () => {
    expect(await controllerWith(null).ackCash({ ctx }, 'p1', { handoffCode: 'ABCDEFGH' })).toMatchObject({ cashAckMethod: 'qr_handoff' });
  });
});
