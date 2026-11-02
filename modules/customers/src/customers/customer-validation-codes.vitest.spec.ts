// customer-validation-codes.vitest.spec — English + Vietnamese POS mandate §2 / §21 / §58 (Oct 27 2026): the customer form's
// refusals carry a stable code / field / rule / params beside the English message (additive), and the controller sends them
// as `{ code, message, details }` — so the POS words them in the cashier's language (ns/errors) instead of the English.
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { toErrorEnvelope } from '@aipowersalon/observability';
import { CustomersService, ValidationError } from './customers.service';
import { InMemoryCustomersRepository } from './customers.repository';

const editor = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'FRONT_DESK', permissions: ['pos.customers.view', 'pos.customers.edit', 'pos.customers.create'] } as any;
const refusal = async (p: Promise<unknown>): Promise<ValidationError> => { try { await p; } catch (e) { return e as ValidationError; } throw new Error('expected a refusal'); };

describe('§58 customer refusals carry a code + field + params', () => {
  it('no first name and no phone → REQUIRED_ONE_OF on firstName (other: phone); a bad phone / email → FORMAT on that field', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    const e1 = await refusal(svc.create(editor, { firstName: '', phone: '' } as any));
    expect(e1).toBeInstanceOf(ValidationError);
    expect(e1.message).toBe('First name or phone is required');   // the English stays (fallback, logs)
    expect(e1.detail).toEqual({ field: 'firstName', rule: 'REQUIRED_ONE_OF', params: { other: 'phone' } });
    expect((await refusal(svc.create(editor, { firstName: 'Lan', phone: '12' } as any))).detail).toEqual({ field: 'phone', rule: 'FORMAT' });
    expect((await refusal(svc.create(editor, { firstName: 'Lan', email: 'nope' } as any))).detail).toEqual({ field: 'email', rule: 'FORMAT' });
  });
  it('a duplicate → CUSTOMER_POSSIBLE_DUPLICATE with the existing customer\'s name; editing to a used contact → CUSTOMER_CONTACT_IN_USE', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    await svc.create(editor, { firstName: 'Nguyễn Thị', lastName: 'Hương', phone: '+15555550111' } as any);
    const dup = await refusal(svc.create(editor, { firstName: 'Huong', phone: '+15555550111' } as any));
    expect(dup.detail?.code).toBe('CUSTOMER_POSSIBLE_DUPLICATE');
    expect(dup.detail?.params?.name).toMatch(/Hương/);
    const other = await svc.create(editor, { firstName: 'Lan', phone: '+15555550112' } as any);
    const used = await refusal(svc.update(editor, other.customerId, { phone: '+15555550111' } as any));
    expect(used.detail?.code).toBe('CUSTOMER_CONTACT_IN_USE');
  });
  it('preferred language / name refusals name their field and rule', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    const c = await svc.create(editor, { firstName: 'Lan', phone: '+15555550113' } as any);
    expect((await refusal(svc.update(editor, c.customerId, { preferredLanguage: 'Klingon' } as any))).detail).toMatchObject({ field: 'preferredLanguage', rule: 'ENUM' });
    expect((await refusal(svc.update(editor, c.customerId, { preferredName: 'x'.repeat(61) } as any))).detail).toEqual({ field: 'preferredName', rule: 'MAX_LENGTH', params: { max: 60 } });
  });
  it('on the wire (the controller\'s mapping through the standard envelope): code + details beside the English message', () => {
    const e = new ValidationError('Phone is not valid', { field: 'phone', rule: 'FORMAT' });
    const body = new HttpException({ code: 'VALIDATION_FAILED', message: e.message, details: { field: 'phone', rule: 'FORMAT' } }, 400).getResponse() as Record<string, unknown>;
    const env = toErrorEnvelope({ status: 400, body, unexpected: false }) as any;
    expect(env.error).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Phone is not valid', details: { field: 'phone', rule: 'FORMAT' } });
  });
});
