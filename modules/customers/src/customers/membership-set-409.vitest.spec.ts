// membership-set-409 — Security Deep Scan §163 run 3 (Oct 27 2026): PATCH /pos/customers/:customerId/membership always
// refuses (membership is enrolled through the memberships module), but the refusal was a plain Error → 500. It is a named
// refusal the controller answers 409 CONFLICT with the explanation.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { KyselyCustomersRepository } from './customers.kysely.repository';

describe('§163 run 3 — customer membership setter', () => {
  it('the real repository refusal reaches the client as 409 CONFLICT, never 500', async () => {
    const svc: any = Object.create(CustomersService.prototype);
    svc.repo = Object.create(KyselyCustomersRepository.prototype);
    const ctl = new CustomersController(svc);
    const req = { ctx: { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.membership.edit'] } };
    let e: unknown; try { await ctl.sMember(req, 'c1', { tier: "' OR '1'='1" }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(409);
    expect((e as HttpException).getResponse()).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('memberships module') });
  });
});
