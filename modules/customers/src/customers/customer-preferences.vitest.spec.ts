// customer-preferences.vitest.spec.ts — Functional Decision 1: preferred name, preferred language and preferred branch
// are PROFILE fields (pos.customers.edit), not private notes — trimmed, length-limited, '' clears, the branch must be one
// of this salon's, and a customer can be found by preferred name.
import { describe, it, expect } from 'vitest';
import { CustomersService } from './customers.service';
import { InMemoryCustomersRepository } from './customers.repository';

const editor = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'FRONT_DESK', permissions: ['pos.customers.view', 'pos.customers.edit', 'pos.customers.create'] } as any;
const setup = async () => {
  const repo = new InMemoryCustomersRepository(); repo.extraBranchIds = ['b2'];
  const svc = new CustomersService(repo);
  const c = await svc.create(editor, { firstName: 'Nguyen', lastName: 'Thi Hoa', phone: '+15555550177', email: 'hoa@example.com' } as any);
  return { svc, id: c.customerId };
};

describe('preferred name / language / branch (Decision 1)', () => {
  it('saved on the profile by staff who can edit customers — no private-notes permission needed', async () => {
    const { svc, id } = await setup();
    const r = await svc.update(editor, id, { preferredName: '  Hoa  ', preferredLanguage: ' Vietnamese ', preferredBranchId: 'b2' });
    expect(r).toMatchObject({ preferredName: 'Hoa', preferredLanguage: 'vi', preferredBranchId: 'b2' });   // WP-I: stored as the code
    expect(editor.permissions).not.toContain('pos.customers.notes.edit');
  });
  it('empty clears; untouched fields stay', async () => {
    const { svc, id } = await setup();
    await svc.update(editor, id, { preferredName: 'Hoa', preferredLanguage: 'Vietnamese' });
    const r = await svc.update(editor, id, { preferredName: '' });
    expect(r.preferredName).toBeNull();
    expect(r.preferredLanguage).toBe('vi');
  });
  it('refuses a name over 60 or a language over 40 characters, and a branch that is not this salon\'s', async () => {
    const { svc, id } = await setup();
    await expect(svc.update(editor, id, { preferredName: 'x'.repeat(61) })).rejects.toThrow(/60 characters/);
    await expect(svc.update(editor, id, { preferredLanguage: 'y'.repeat(41) })).rejects.toThrow(/40 characters/);
    await expect(svc.update(editor, id, { preferredBranchId: 'branch-of-another-salon' })).rejects.toThrow(/not one of this salon/);
    expect((await svc.getState(editor, {})).customers.items.find((x: any) => x.customerId === id)!.preferredName ?? null).toBeNull();
  });
  it('the front desk finds the customer by the name she goes by', async () => {
    const { svc, id } = await setup();
    await svc.update(editor, id, { preferredName: 'Hoa' });
    const found = await svc.getState(editor, { search: 'hoa' } as any);
    expect(found.customers.items.map((x: any) => x.customerId)).toContain(id);
    const byNick = await svc.update(editor, id, { preferredName: 'Rosie' });
    expect(byNick.preferredName).toBe('Rosie');
    expect((await svc.getState(editor, { search: 'rosie' } as any)).customers.items.map((x: any) => x.customerId)).toEqual([id]);
  });
});

// English + Vietnamese POS mandate WP-I (§55): the customer's COMMUNICATION language is English or Vietnamese — typed names
// become the code; any other language is refused (the salon's reminders and receipts exist in those two only).
describe('customer communication language (WP-I)', () => {
  it('"Tiếng Việt" / "vi-VN" / "English" are stored as vi / en; blank clears', async () => {
    const { svc, id } = await setup();
    expect((await svc.update(editor, id, { preferredLanguage: 'Tiếng Việt' })).preferredLanguage).toBe('vi');
    expect((await svc.update(editor, id, { preferredLanguage: 'vi-VN' })).preferredLanguage).toBe('vi');
    expect((await svc.update(editor, id, { preferredLanguage: 'English' })).preferredLanguage).toBe('en');
    expect((await svc.update(editor, id, { preferredLanguage: '' })).preferredLanguage).toBeNull();
  });
  it('another language is refused and nothing changes', async () => {
    const { svc, id } = await setup();
    await svc.update(editor, id, { preferredLanguage: 'vi' });
    await expect(svc.update(editor, id, { preferredLanguage: 'Korean' })).rejects.toThrow(/English or Vietnamese/);
    expect((await svc.update(editor, id, { preferredName: 'Hoa' })).preferredLanguage).toBe('vi');
  });
});
