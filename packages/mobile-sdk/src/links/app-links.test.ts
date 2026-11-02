// app-links.test.ts — BUILD_PLAN Phase 13 D (Constitution 6 §64–66).
import { describe, it, expect } from 'vitest';
import { installAppLinks, consumeWebLink } from './app-links';
import { createRouteGate } from './route-gate';
import type { PushRoute } from '@aipowersalon/api-contracts';

const flush = () => new Promise((r) => setTimeout(r, 0));
function setup(signedIn = true) {
  const opened: PushRoute[] = [];
  const gate = createRouteGate({ canOpen: () => signedIn, open: (r) => opened.push(r) });
  return { opened, gate };
}

describe('native universal links / App Links', () => {
  it('routes this app’s links (and the launch URL) through the gate; ignores other apps’ and unknown ones', async () => {
    const { opened, gate } = setup();
    let cb: (e: { url: string }) => void = () => {};
    await installAppLinks({ app: 'customer', gate, plugin: { addListener: (_e, f) => { cb = f; return { remove() {} }; }, getLaunchUrl: async () => ({ url: 'https://l.example.com/app-links/customer/appointments' }) } });
    cb({ url: 'https://l.example.com/app-links/customer/appointment/a1' });
    cb({ url: 'https://l.example.com/app-links/owner/approvals' });
    cb({ url: 'https://l.example.com/app-links/customer/admin' });
    await flush();
    expect(opened).toEqual([{ name: 'appointments', params: {} }, { name: 'appointment', params: { appointmentId: 'a1' } }]);
  });
  it('a link never signs anybody in: signed out → it waits for sign-in', async () => {
    const { opened, gate } = setup(false);
    let cb: (e: { url: string }) => void = () => {};
    await installAppLinks({ app: 'tech', gate, plugin: { addListener: (_e, f) => { cb = f; return { remove() {} }; } } });
    cb({ url: 'https://l.example.com/app-links/tech/queue?token=stolen' }); await flush();
    expect(opened).toEqual([]); expect(gate.pending()).toEqual({ name: 'queue', params: {} });
  });
});

describe('web fallback (?link=)', () => {
  it('reads ?link=, strips it from the address bar, and goes through the gate', () => {
    const { opened, gate } = setup(); let replaced = '';
    expect(consumeWebLink('owner', gate, { search: '?link=approvals&x=1', pathname: '/owner/', hash: '' }, (u) => { replaced = u; })).toBe(true);
    expect(replaced).toBe('/owner/?x=1');
    return flush().then(() => expect(opened).toEqual([{ name: 'approvals', params: {} }]));
  });
  it('nothing to do without ?link= or with an unknown route', () => {
    const { gate } = setup();
    expect(consumeWebLink('owner', gate, { search: '', pathname: '/', hash: '' }, null)).toBe(false);
    expect(consumeWebLink('owner', gate, { search: '?link=../../admin', pathname: '/', hash: '' }, null)).toBe(false);
  });
});
