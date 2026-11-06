// Nov 5 2026 sweep: the customer app could not get past a challenged booking-code send, and sent a `phone` key the
// server rejects. These pin both fixes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
const get = vi.fn();
vi.mock('../api/client', () => ({ api: { post: (...a: any[]) => post(...a), get: (...a: any[]) => get(...a) } }));

import { isCaptchaRequired, withCaptcha, solveCaptcha, CAPTCHA_UNAVAILABLE } from './captcha';
import { customerApi } from '../api/customerApi';

const challenge = Object.assign(new Error('Please complete the verification challenge to continue.'), { status: 428, code: 'PRECONDITION_REQUIRED', details: { status: 'captcha_required' } });

beforeEach(() => { post.mockReset(); get.mockReset(); document.body.innerHTML = ''; delete (window as any).turnstile; });

describe('verification bodies match the server schema (phone is x-forbidden)', () => {
  it('send carries only bookingSessionId (+ captchaToken), never phone', async () => {
    post.mockResolvedValue({});
    await customerApi.sendBookingVerification({ bookingSessionId: 'bs-1', phone: '' });
    expect(post).toHaveBeenLastCalledWith('/customer/booking/verification/send', { bookingSessionId: 'bs-1' });
    await customerApi.sendBookingVerification({ bookingSessionId: 'bs-1', phone: '+15555550100', captchaToken: 'tok' });
    expect(post).toHaveBeenLastCalledWith('/customer/booking/verification/send', { bookingSessionId: 'bs-1', captchaToken: 'tok' });
  });
  it('check carries only bookingSessionId + code', async () => {
    post.mockResolvedValue({});
    await customerApi.checkBookingVerification({ bookingSessionId: 'bs-1', phone: '+15555550100', code: '123456' });
    expect(post).toHaveBeenLastCalledWith('/customer/booking/verification/check', { bookingSessionId: 'bs-1', code: '123456' });
  });
});

describe('captcha challenge', () => {
  it('recognises the 428 captcha_required instruction and nothing else', () => {
    expect(isCaptchaRequired(challenge)).toBe(true);
    expect(isCaptchaRequired({ status: 428, code: 'phone_verification_required', details: {} })).toBe(false);
    expect(isCaptchaRequired({ status: 400 })).toBe(false);
  });

  it('a send that is not challenged runs once, with no token', async () => {
    const send = vi.fn(async () => 'ok');
    await expect(withCaptcha(send)).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith();
  });

  it('other errors pass straight through', async () => {
    const boom = Object.assign(new Error('nope'), { status: 429 });
    await expect(withCaptcha(async () => { throw boom; })).rejects.toBe(boom);
    expect(get).not.toHaveBeenCalled();
  });

  it('fails closed with a clear message when no captcha is configured', async () => {
    get.mockResolvedValue({ provider: null, siteKey: null });
    const send = vi.fn(async () => { throw challenge; });
    await expect(withCaptcha(send)).rejects.toThrow(CAPTCHA_UNAVAILABLE);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('shows the widget, then retries the send with the solved token', async () => {
    get.mockResolvedValue({ provider: 'turnstile', siteKey: 'site-key' });
    // the provider script "loads" and exposes its global
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((el: any) => {
      (window as any).turnstile = { render: (_box: HTMLElement, o: any) => { expect(o.sitekey).toBe('site-key'); setTimeout(() => o.callback('solved-token'), 0); } };
      const r = append(el); setTimeout(() => el.onload?.(), 0); return r;
    });
    const send = vi.fn(async (t?: string) => { if (!t) throw challenge; return `sent:${t}`; });
    await expect(withCaptcha(send)).resolves.toBe('sent:solved-token');
    expect(send).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();   // the overlay is gone
  });

  it('cancel resolves null', async () => {
    get.mockResolvedValue({ provider: 'turnstile', siteKey: 'k' });
    (window as any).turnstile = { render: () => undefined };
    vi.spyOn(document.head, 'appendChild').mockImplementation((el: any) => { setTimeout(() => el.onload?.(), 0); return el; });
    const p = solveCaptcha();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] button')).not.toBeNull());
    (document.querySelector('[role="dialog"] button') as HTMLButtonElement).click();
    await expect(p).resolves.toBeNull();
  });
});
