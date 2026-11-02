// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): serving / queue refusals carry a registry code beside the English
// sentence; the serving controller answers 400 { code, message } (unchanged status); a code-less refusal stays plain text.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { ServingService, ValidationError } from './serving.service';
import { ServingController } from './serving.controller';

const req = { ctx: { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] } };
describe('V-5: serving refusals carry their registry code', () => {
  it('report a delay without a reason → 400 DELAY_REASON_REQUIRED (real service method + controller)', async () => {
    const svc: any = Object.create(ServingService.prototype);
    svc.need = () => undefined; svc.ticketOr404 = async () => ({ id: 't1' });
    const ctl = new ServingController(svc);
    let e: unknown; try { await (ctl as any).reportDelay(req, 't1', { reason: '' }); } catch (x) { e = x; }
    expect((e as HttpException).getStatus()).toBe(400);
    expect((e as HttpException).getResponse()).toMatchObject({ code: 'DELAY_REASON_REQUIRED', message: 'A delay reason is required' });
  });
  it('a refusal without a code is still the plain 400 text', async () => {
    const ctl = new ServingController({ reportDelay: async () => { throw new ValidationError('Ticket not found'); } } as any);
    let e: unknown; try { await (ctl as any).reportDelay(req, 't1', { reason: 'x' }); } catch (x) { e = x; }
    expect((e as HttpException).getResponse()).toBe('Ticket not found');
  });
});
