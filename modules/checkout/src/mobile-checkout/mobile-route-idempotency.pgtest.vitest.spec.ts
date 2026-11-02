// mobile-route-idempotency.pgtest — Secure Tap to Pay M6-6 (§30 / §37): @Idempotent() on the money-moving Payment App routes
// (payment-attempts, cash-tender, capture-result, reconcile — beside refund / void), on the REAL api_idempotency table.
// A retry with the same Idempotency-Key (re-signed: a fresh device nonce in the headers, the same body) is answered from the
// store — the service, and so the processor, runs ONCE. A different body on the same key is IDEMPOTENCY_KEY_REUSED.
import { describe, it, expect, beforeAll } from 'vitest';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, from } from 'rxjs';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { IdempotencyInterceptor } from '@aipowersalon/database/nest';
import { MobileCheckoutController } from './mobile-checkout.controller';

const T = 'd6930000-0000-4000-8000-00000000000a';
let interceptor: IdempotencyInterceptor;
const reflector = new Reflector();
const proto = MobileCheckoutController.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const ROUTES = ['createAttempt', 'cashTender', 'captureResult', 'reconcile', 'refundPayment', 'refundTicket', 'voidPayment'];

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'D693', 'D693', 'd693', 'D693', 'active')`);
  interceptor = new IdempotencyInterceptor(reflector, kyselyFor(pg));
}, 120_000);

/** One HTTP call through the interceptor: `nonce` stands for the device proof headers (a re-signed retry changes it). */
function call(handler: string, opts: { key?: string; nonce: string; body: Record<string, unknown>; params: Record<string, string>; route: string; userId?: string }, run: () => Promise<unknown>) {
  const headers: Record<string, string> = { 'x-aps-device-id': 'phone-1', 'x-aps-device-nonce': opts.nonce, ...(opts.key ? { 'idempotency-key': opts.key } : {}) };
  const res = { statusCode: 0, headers: {} as Record<string, string>, status(s: number) { this.statusCode = s; return this; }, setHeader(k: string, v: string) { this.headers[k] = v; } };
  const req = { headers, body: opts.body, params: opts.params, method: 'POST', route: { path: opts.route }, ctx: { tenantId: T, role: 'MANAGER', userId: opts.userId ?? 'u-mgr' } };
  const ctx: any = { getHandler: () => proto[handler], getClass: () => MobileCheckoutController, switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  return lastValueFrom(interceptor.intercept(ctx, { handle: () => from(run()) })).then((body) => ({ body, res }));
}

describe('M6-6 route-level idempotency on the Payment App money routes', () => {
  it('every money-moving route carries @Idempotent()', () => {
    for (const r of ROUTES) expect(reflector.get('aps:idempotent', proto[r]), r).toEqual({ required: false });
  });

  it('payment-attempts: a re-signed retry with the same Idempotency-Key is answered from the store — the service runs once', async () => {
    let runs = 0; const svc = async () => ({ idempotencyKey: 'ttp_x', status: 'created', amountCents: 4200, run: ++runs });
    const o = { key: 'pa-ttp_abcdef0123', body: { sessionId: 's', idempotencyKey: 'ttp_abcdef0123', deviceId: 'phone-1' }, params: { ticketId: 'tk1' }, route: '/mobile-checkout/tickets/:ticketId/payment-attempts' };
    const a = await call('createAttempt', { ...o, nonce: 'n-1' }, svc);
    const b = await call('createAttempt', { ...o, nonce: 'n-2' }, svc);
    expect(runs).toBe(1);
    expect(b.body).toEqual(a.body);
    expect(b.res.headers['Idempotent-Replayed']).toBe('true');
  });

  it('capture-result: the SAME SDK result delivered twice records once; a different result on the same key is refused', async () => {
    let runs = 0; const svc = async () => ({ to: 'confirmed', paymentId: 'p-' + (++runs) });
    const o = { key: 'cr-ttp_abc-approved', params: { idempotencyKey: 'ttp_abc' }, route: '/mobile-checkout/payment-attempts/:idempotencyKey/capture-result' };
    const a = await call('captureResult', { ...o, nonce: 'n-3', body: { outcome: 'approved', processorRef: 'R1' } }, svc);
    const b = await call('captureResult', { ...o, nonce: 'n-4', body: { outcome: 'approved', processorRef: 'R1' } }, svc);
    expect(runs).toBe(1); expect(b.body).toEqual(a.body);
    await expect(call('captureResult', { ...o, nonce: 'n-5', body: { outcome: 'declined' } }, svc)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(runs).toBe(1);
  });

  it('cash-tender: one cash tender per key; a failed first try is released so the real retry runs', async () => {
    let runs = 0; let fail = true;
    const svc = async () => { runs++; if (fail) { fail = false; throw new Error('db blip'); } return { paymentId: 'cash-1', duplicate: false }; };
    const o = { key: 'ct-cash-key-0001', body: { sessionId: 's', idempotencyKey: 'cash-key-0001', amountCents: 1000 }, params: { ticketId: 'tk1' }, route: '/mobile-checkout/tickets/:ticketId/cash-tender' };
    await expect(call('cashTender', { ...o, nonce: 'n-6' }, svc)).rejects.toThrow('db blip');
    const ok = await call('cashTender', { ...o, nonce: 'n-7' }, svc);
    const again = await call('cashTender', { ...o, nonce: 'n-8' }, svc);
    expect(runs).toBe(2); expect(again.body).toEqual(ok.body);
  });

  it('keys are the caller\'s: the same key from another employee (a shared phone) is a different request', async () => {
    let runs = 0; const svc = async () => ({ verified: ++runs });
    const o = { key: 'rc-same-key-0001', body: { resolution: 'confirmed' }, params: { idempotencyKey: 'ttp_q' }, route: '/mobile-checkout/payment-attempts/:idempotencyKey/reconcile' };
    await call('reconcile', { ...o, nonce: 'n-9', userId: 'u-a' }, svc);
    await call('reconcile', { ...o, nonce: 'n-10', userId: 'u-b' }, svc);
    expect(runs).toBe(2);
  });

  it('no Idempotency-Key → the route behaves as before (the stable intent key still makes the payment one intent)', async () => {
    let runs = 0; const svc = async () => ({ n: ++runs });
    const o = { body: { sessionId: 's', idempotencyKey: 'ttp_nokey' }, params: { ticketId: 'tk2' }, route: '/mobile-checkout/tickets/:ticketId/payment-attempts' };
    await call('createAttempt', { ...o, nonce: 'n-11' }, svc); await call('createAttempt', { ...o, nonce: 'n-12' }, svc);
    expect(runs).toBe(2);
  });
});
