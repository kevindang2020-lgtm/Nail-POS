// Nov 6 2026 (Kevin): signing in never asks for notification permission. The device registers silently when it is already
// allowed; otherwise the "Turn on notifications" banner asks from a tap (enablePush), and that registers it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const native = { on: true };
const perm = { receive: 'prompt' as string };
const calls = { check: 0, request: 0, register: 0, localRequest: 0 };
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on, getPlatform: () => 'ios' } }));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: async () => { calls.check++; return { receive: perm.receive }; },
    requestPermissions: async () => { calls.request++; perm.receive = 'granted'; return { receive: 'granted' }; },
    register: async () => { calls.register++; },
    addListener: async () => ({ remove: () => undefined }),
    removeAllListeners: async () => undefined, listChannels: async () => ({ channels: [] }), deleteChannel: async () => undefined,
    createChannel: async () => undefined,
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => { calls.localRequest++; return { display: 'granted' }; },
    addListener: async () => ({ remove: () => undefined }), removeAllListeners: async () => undefined, createChannel: async () => undefined, schedule: async () => undefined,
  },
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}), getApps: () => [], getApp: () => ({}) }));
vi.mock('firebase/messaging', () => ({ getMessaging: () => ({}), getToken: async () => 'tok', onMessage: () => () => undefined }));

import { useWebPush, enablePush, pushPermission, usePushPrompt } from './web-push';

const http = { post: vi.fn(async () => ({})) };
let n = 0;
beforeEach(() => { perm.receive = 'prompt'; native.on = true; calls.check = calls.request = calls.register = calls.localRequest = 0; http.post.mockClear(); n++; });

describe('native: no prompt at sign-in', () => {
  it('signing in with permission undecided neither prompts nor registers', async () => {
    renderHook(() => useWebPush({ http, tenantId: 't', userType: 'customer', userId: `u-a${n}`, app: 'customer' }));
    await waitFor(() => expect(calls.check).toBeGreaterThan(0));
    expect(calls.request).toBe(0);
    expect(calls.register).toBe(0);
  });
  it('already allowed: registers silently, still no prompt', async () => {
    perm.receive = 'granted';
    renderHook(() => useWebPush({ http, tenantId: 't', userType: 'customer', userId: `u-b${n}`, app: 'customer' }));
    await waitFor(() => expect(calls.register).toBe(1));
    expect(calls.request).toBe(0);
  });
  it('the banner tap (enablePush) prompts, then the signed-in hook registers the device', async () => {
    renderHook(() => useWebPush({ http, tenantId: 't', userType: 'customer', userId: `u-c${n}`, app: 'customer' }));
    await waitFor(() => expect(calls.check).toBeGreaterThan(0));
    await expect(enablePush()).resolves.toBe(true);
    expect(calls.request).toBe(1);
    await waitFor(() => expect(calls.register).toBe(1));
  });
});

describe('usePushPrompt', () => {
  it('shows only to a signed-in person whose device has not decided, and not when snoozed', async () => {
    expect(await pushPermission()).toBe('prompt');
    const shown = renderHook(() => usePushPrompt(true, () => false, () => undefined));
    await waitFor(() => expect(shown.result.current.visible).toBe(true));
    const out = renderHook(() => usePushPrompt(false, () => false, () => undefined));
    expect(out.result.current.visible).toBe(false);
    const snoozed = renderHook(() => usePushPrompt(true, () => true, () => undefined));
    await new Promise((r) => setTimeout(r, 0));
    expect(snoozed.result.current.visible).toBe(false);
    perm.receive = 'granted';
    const allowed = renderHook(() => usePushPrompt(true, () => false, () => undefined));
    await new Promise((r) => setTimeout(r, 0));
    expect(allowed.result.current.visible).toBe(false);
  });
});
