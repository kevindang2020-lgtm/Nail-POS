// ai-faq.vitest.spec.ts — customer-facing FAQ CRUD. Permission-gated writes, validation, active toggle, and tenant
// isolation. FAQs are new data; nothing here duplicates services/hours/policies.
import { describe, it, expect } from 'vitest';
import { AiFaqService, InMemoryFaqRepo, FaqForbiddenError, FaqValidationError, FaqNotFoundError } from './ai-faq.service';

const owner = { tenantId: 't1', branchId: null, userId: 'u1', role: 'OWNER', permissions: ['ai.manage'] };
const viewer = { tenantId: 't1', branchId: null, userId: 'u2', role: 'RECEPTION', permissions: ['ai.use'] };
const svc = () => new AiFaqService(new InMemoryFaqRepo());

describe('AiFaqService', () => {
  it('requires ai.manage for writes', async () => {
    await expect(svc().create(viewer as any, { question: 'Do you take walk-ins?', answer: 'Yes, when we have openings.' })).rejects.toBeInstanceOf(FaqForbiddenError);
  });
  it('validates question and answer', async () => {
    await expect(svc().create(owner as any, { question: '', answer: 'x' })).rejects.toBeInstanceOf(FaqValidationError);
    await expect(svc().create(owner as any, { question: 'q', answer: '' })).rejects.toBeInstanceOf(FaqValidationError);
  });
  it('creates, updates active flag, lists, and deletes', async () => {
    const s = svc();
    const f = await s.create(owner as any, { question: 'Do you do gel?', answer: 'Yes, gel manicures and pedicures.', category: 'services' });
    expect(f).toMatchObject({ question: 'Do you do gel?', isActive: true, category: 'services' });
    const off = await s.update(owner as any, f.id, { isActive: false });
    expect(off.isActive).toBe(false);
    const list = await s.list(owner as any);
    expect(list.length).toBe(1);
    await expect(s.remove(owner as any, f.id)).resolves.toEqual({ deleted: true });
    expect((await s.list(owner as any)).length).toBe(0);
  });
  it('404s updating a cross-tenant FAQ', async () => {
    const s = svc();
    const f = await s.create(owner as any, { question: 'q?', answer: 'a.' });
    await expect(s.update({ ...owner, tenantId: 't2' } as any, f.id, { answer: 'hacked' })).rejects.toBeInstanceOf(FaqNotFoundError);
  });
});
