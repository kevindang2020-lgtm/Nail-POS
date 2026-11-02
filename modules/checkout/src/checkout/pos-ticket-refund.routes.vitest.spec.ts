// pos-ticket-refund.routes.vitest.spec.ts — the POS ticket-refund routes (Oct 2 2026; Decision 20 had a split refund
// only in Manager Pay): they reach the one refund engine with the refund permission, pass only reason + amount (the
// server splits), and the preview is a read-only GET.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CheckoutController } from './checkout.controller';

const ctxReq = { ctx: { tenantId: 't', branchId: 'b', userId: 'u', role: 'MANAGER', permissions: ['checkout.manage_overrides'] } };
const svc: any = { refundAllocationPreview: vi.fn(async () => ({ ok: 'preview' })), refundTicket: vi.fn(async () => ({ ok: 'refund' })) };
const ctl = new CheckoutController(svc, {} as any, {} as any);
const perm = (m: string) => {
  const fn = (CheckoutController.prototype as any)[m];
  return Reflect.getMetadataKeys(fn).map((k: any) => Reflect.getMetadata(k, fn)).flat().find((v: any) => typeof v === 'string' && v.startsWith('pos.'));
};

describe('POS ticket-refund routes', () => {
  it('preview: GET with the amount as a number, refund permission', async () => {
    expect(await ctl.previewRefundSplit(ctxReq, 'tk1', '5000')).toEqual({ ok: 'preview' });
    expect(svc.refundAllocationPreview).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't', userId: 'u' }), 'tk1', 5000);
    expect(perm('previewRefundSplit')).toBe('pos.checkout.refund');
    expect(Reflect.getMetadata('method', (CheckoutController.prototype as any).previewRefundSplit)).toBe(0);
  });
  it('refund: POST passes reason + amount only (no client-chosen split or tenders), refund permission', async () => {
    expect(await ctl.refundTicket(ctxReq, 'tk1', { reason: 'Chipped', amountCents: 5000, allocations: [{ paymentId: 'x', amountToRefundCents: 5000 }] })).toEqual({ ok: 'refund' });
    expect(svc.refundTicket).toHaveBeenCalledWith(expect.anything(), 'tk1', { reason: 'Chipped', amountCents: 5000, managerPin: undefined, serviceLineIds: undefined, tipRefunded: false });
    expect(perm('refundTicket')).toBe('pos.checkout.refund');
    expect(Reflect.getMetadata('method', (CheckoutController.prototype as any).refundTicket)).toBe(1);
  });
});
