// Oct 28 2026 (Receipt mandate audit F2, §72 / §196): receipt documents were tenant-scoped only — a branch-A user with the
// OCR permissions could list, preview, correct, approve and post branch B's receipts. The service now asks the finance
// module's bound branch rule (visibleBranches) and a document outside the person's branches answers like a missing one.
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import { InMemoryDocStore } from './ai-ocr-receipt.kysely';

const A = 'branch-a', B = 'branch-b';
const person = (branchId: string) => ({ tenantId: 't1', branchId, userId: 'u-' + branchId, role: 'MANAGER', permissions: [] as string[] }) as any;

async function world(scopes: Record<string, string[] | null>) {
  const docs = new InMemoryDocStore();
  const a = await docs.create({ tenantId: 't1', branchId: A, userId: 'x', role: 'OWNER', permissions: [] } as any, { pipelineState: 'review_required', documentType: 'receipt', vendor: 'A Supply', totalCents: 1000 } as any);
  const b = await docs.create({ tenantId: 't1', branchId: B, userId: 'x', role: 'OWNER', permissions: [] } as any, { pipelineState: 'review_required', documentType: 'receipt', vendor: 'B Supply', totalCents: 2000 } as any);
  const audit: any = { async record() { /* */ } };
  const svc = new AiOcrReceiptService(docs as any, {} as any, {} as any, {} as any, {} as any, audit);
  svc.visibleBranches = async (c) => scopes[c.userId] ?? null;
  return { svc, a, b };
}

describe('F2: receipt documents stay inside the person\'s branches', () => {
  it('a branch-A manager lists only branch A, and branch B\'s receipt reads as missing (no correction either)', async () => {
    const { svc, a, b } = await world({ ['u-' + A]: [A] });
    const list = await svc.listDocuments(person(A), {});
    expect(list.items.map((d) => d.id)).toEqual([a.id]);
    expect(list.total).toBe(1);
    await expect(svc.correctField(person(A), b.id, 'total', { valueCents: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.correctField(person(A), a.id, 'vendor', { value: 'A Supply Co' })).resolves.toBeDefined();
  });
  it('an owner (null scope) sees both; the pipeline\'s system actor is never scoped', async () => {
    const { svc } = await world({});
    expect((await svc.listDocuments(person(A), {})).total).toBe(2);
    expect((await svc.listDocuments({ ...person(A), userId: 'system:ocr-pipeline' }, {})).total).toBe(2);
  });
  it('a restricted person with no branches sees nothing', async () => {
    const { svc } = await world({ ['u-' + A]: [] });
    expect((await svc.listDocuments(person(A), {})).total).toBe(0);
  });
});
