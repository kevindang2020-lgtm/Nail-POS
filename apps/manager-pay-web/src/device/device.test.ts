// device.test — Secure Tap to Pay M6-4 (client): one device id everywhere, every /mobile-checkout request signed once the
// key is enrolled (and verified by the SERVER's checkProof), the DEVICE_* refusals in plain English with exactly one
// replay retry, a revoked phone wiped + locked, the pairing link parsed, and registration carrying the public key.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { InMemoryDeviceKeyStore } from '@aipowersalon/mobile-sdk';
import { checkProof, readProof } from '../../../../modules/checkout/src/mobile-checkout/device-proof';

vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { registerDevice: vi.fn() } }));
vi.mock('../native/tapToPay', () => ({ isTapToPayAvailable: () => false }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';
import * as session from '../util/session';
import { setDeviceKeyStore, currentKey, markEnrolled, signingHeaders, isEnrolled } from './deviceKeys';
import { deviceErrorCode, deviceErrorMessage, deviceErrorAction, DEVICE_ERROR_CODES } from './deviceErrors';
import { getDeviceStanding, resetDeviceStandingForTests, clearRemoved } from './deviceState';
import { parsePairingInput } from './pairing';
import { withDeviceRules } from '../api/client';
import { enrollDevice } from './enroll';

vi.stubGlobal('crypto', webcrypto);   // jsdom has no SubtleCrypto; the phone's WKWebView does — Node's is the same API

const err = (code: string, message = 'server text') => Object.assign(new Error(message), { code, status: 403 });
let store: InMemoryDeviceKeyStore;

beforeEach(() => {
  vi.clearAllMocks();
  clearRemoved(); resetDeviceStandingForTests();
  store = new InMemoryDeviceKeyStore();
  setDeviceKeyStore(store);
});

describe('one device id', () => {
  it('the key record carries the SAME id the app sends everywhere (login, register, select-branch, headers)', async () => {
    const k = (await currentKey())!;
    expect(k.deviceId).toBe(session.DEVICE_ID);
    expect(globalThis.localStorage.getItem(session.DEVICE_ID_KEY)).toBe(session.DEVICE_ID);
  });
});

describe('signingHeaders — the transport hook', () => {
  const url = (p: string) => `https://api.example.com/api/v1${p}`;
  it('only /mobile-checkout is signed; before enrolment only the registration (proof of possession)', async () => {
    expect(await signingHeaders({ method: 'GET', url: url('/auth/me'), body: undefined, isForm: false })).toBeNull();
    expect(await signingHeaders({ method: 'GET', url: url('/mobile-checkout/queue'), body: undefined, isForm: false })).toBeNull();
    const body = JSON.stringify({ deviceId: session.DEVICE_ID, publicKey: (await currentKey())!.publicKey });
    const h = (await signingHeaders({ method: 'POST', url: url('/mobile-checkout/device/register'), body, isForm: false }))!;
    expect(h['x-aps-device-id']).toBe(session.DEVICE_ID);
    expect(checkProof({ method: 'POST', path: '/mobile-checkout/device/register', headers: h, rawBody: Buffer.from(body) }, readProof(h)!, (await currentKey())!.publicKey)).toEqual({ ok: true });
  });
  it('once enrolled every /mobile-checkout request is signed and verifies with the server checkProof', async () => {
    await currentKey(); await markEnrolled();
    expect(isEnrolled()).toBe(true);
    const body = JSON.stringify({ sessionId: 's', idempotencyKey: 'k', amountCents: 500, deviceId: session.DEVICE_ID });
    const h = (await signingHeaders({ method: 'POST', url: url('/mobile-checkout/tickets/t1/payment-attempts'), body, isForm: false }))!;
    const pub = (await currentKey())!.publicKey;
    expect(checkProof({ method: 'POST', path: '/mobile-checkout/tickets/t1/payment-attempts', headers: h, rawBody: Buffer.from(body) }, readProof(h)!, pub)).toEqual({ ok: true });
    const h2 = (await signingHeaders({ method: 'POST', url: url('/mobile-checkout/tickets/t1/payment-attempts'), body, isForm: false }))!;
    expect(h2['x-aps-device-nonce']).not.toBe(h['x-aps-device-nonce']);   // fresh nonce every request
  });
  it('no secure storage → nothing signed and the reason is known (the server decides; the app explains)', async () => {
    setDeviceKeyStore({ load: async () => { throw new Error('blocked'); }, save: async () => undefined, clear: async () => undefined });
    expect(await signingHeaders({ method: 'POST', url: url('/mobile-checkout/device/register'), body: '{}', isForm: false })).toBeNull();
    expect(deviceErrorMessage('DEVICE_KEY_REQUIRED', 'This phone has no secure key storage.')).toMatch(/secure payment key set up.*no secure key storage/);
  });
});

describe('DEVICE_* refusals', () => {
  it('every registered device code has plain English and an action', () => {
    for (const c of DEVICE_ERROR_CODES) { expect(deviceErrorMessage(c).length).toBeGreaterThan(10); expect(deviceErrorAction(c)).toBeTruthy(); }
    expect(deviceErrorCode(err('DEVICE_SUSPENDED'))).toBe('DEVICE_SUSPENDED');
    expect(deviceErrorCode(err('PAYMENT_IN_PROGRESS'))).toBeNull();
    expect(deviceErrorMessage('DEVICE_REVOKED')).toBe('This phone was removed from the salon');
    expect(deviceErrorMessage('PAIRING_CODE_INVALID')).toMatch(/expired or already used/);
  });
  it('DEVICE_REQUEST_REPLAYED is retried exactly ONCE (re-signed), then reported', async () => {
    const fn = vi.fn().mockRejectedValueOnce(err('DEVICE_REQUEST_REPLAYED', 'x')).mockResolvedValueOnce('ok');
    await expect(withDeviceRules(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    const always = vi.fn().mockRejectedValue(err('DEVICE_REQUEST_REPLAYED', 'x'));
    await expect(withDeviceRules(always)).rejects.toMatchObject({ code: 'DEVICE_REQUEST_REPLAYED', message: 'That request could not be confirmed. Please try again.' });
    expect(always).toHaveBeenCalledTimes(2);
  });
  it('no other refusal is retried — a payment is never re-sent blindly', async () => {
    for (const c of ['DEVICE_KEY_MISMATCH', 'DEVICE_BRANCH_NOT_AUTHORIZED', 'DEVICE_SUSPENDED', 'PAYMENT_IN_PROGRESS']) {
      const fn = vi.fn().mockRejectedValue(err(c));
      await expect(withDeviceRules(fn)).rejects.toBeTruthy();
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
  it('DEVICE_PENDING_APPROVAL → waiting for the owner; DEVICE_SUSPENDED → paused', async () => {
    await expect(withDeviceRules(() => Promise.reject(err('DEVICE_PENDING_APPROVAL')))).rejects.toMatchObject({ message: expect.stringMatching(/waiting for the salon owner/) });
    expect(getDeviceStanding()).toBe('pending');
    await expect(withDeviceRules(() => Promise.reject(err('DEVICE_SUSPENDED')))).rejects.toBeTruthy();
    expect(getDeviceStanding()).toBe('suspended');
  });
  it('DEVICE_REVOKED wipes the key + id and locks the app (persisted across relaunch)', async () => {
    const before = (await currentKey())!;
    await expect(withDeviceRules(() => Promise.reject(err('DEVICE_REVOKED')))).rejects.toMatchObject({ message: 'This phone was removed from the salon' });
    expect(getDeviceStanding()).toBe('removed');
    expect(globalThis.localStorage.getItem('aps_pay_device_removed')).toBe('1');
    expect(await store.load()).toBeNull();
    expect(session.DEVICE_ID).not.toBe(before.deviceId);   // the old id is final on the server; a new phone identity next time
    resetDeviceStandingForTests(); expect(getDeviceStanding()).toBe('removed');   // a relaunch stays locked
  });
});

describe('pairing + registration', () => {
  it('parses the POS QR link and a pasted code; refuses anything else', () => {
    const code = 'Zq3x_9-abcdefghijklmnopqrstuvwxyzABCDEFGHI';
    expect(parsePairingInput(`aipowersalon-pay://pair?code=${code}`)).toBe(code);
    expect(parsePairingInput(code)).toBe(code);
    expect(parsePairingInput('https://evil.example/pair?code=' + code)).toBeNull();
    expect(parsePairingInput('aipowersalon-pay://other?code=' + code)).toBeNull();
    expect(parsePairingInput('short')).toBeNull();
  });
  it('registration sends the public key (+ pairing code) and enrols the key; standing follows the answer', async () => {
    (mobileCheckoutApi.registerDevice as any).mockResolvedValue({ deviceId: session.DEVICE_ID, status: 'active' });
    const r = await enrollDevice({ pairingCode: 'Zq3x_9-abcdefghijklmnop' });
    expect(r.status).toBe('active');
    const body = (mobileCheckoutApi.registerDevice as any).mock.calls[0][0];
    expect(body).toMatchObject({ deviceId: session.DEVICE_ID, publicKey: (await currentKey())!.publicKey, pairingCode: 'Zq3x_9-abcdefghijklmnop' });
    expect(isEnrolled()).toBe(true);
    expect(getDeviceStanding()).toBe('active');
  });
  it('DEVICE_KEY_MISMATCH at registration (another key on file for this id) → a NEW id + key, registered once more', async () => {
    const first = (await currentKey())!;
    (mobileCheckoutApi.registerDevice as any).mockRejectedValueOnce(err('DEVICE_KEY_MISMATCH')).mockResolvedValueOnce({ deviceId: 'x', status: 'pending' });
    await enrollDevice();
    const calls = (mobileCheckoutApi.registerDevice as any).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].deviceId).not.toBe(first.deviceId);
    expect(calls[1][0].publicKey).not.toBe(first.publicKey);
    expect(getDeviceStanding()).toBe('pending');
  });
  it('PAIRING_CODE_INVALID is returned to the caller (no retry, no new identity)', async () => {
    (mobileCheckoutApi.registerDevice as any).mockRejectedValue(err('PAIRING_CODE_INVALID'));
    await expect(enrollDevice({ pairingCode: 'Zq3x_9-abcdefghijklmnop' })).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    expect(mobileCheckoutApi.registerDevice).toHaveBeenCalledTimes(1);
  });
});
