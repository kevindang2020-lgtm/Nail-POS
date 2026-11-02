// kiosk-alternate.test.mjs — BUILD_PLAN Phase 6 (ai_queue_assignment) for the Go Check-In kiosk (a single static HTML
// file — no bundler, so the REAL file runs in jsdom against a stubbed API). After check-in: the queue engine's
// estimated wait, and — only when the check-in result says the requested technician is busy and offers alternates —
// "See <technician>" / "Keep waiting". Accepting posts { queueItemId, technicianId } with the session token. Both shipped
// copies (index.html, www/index.html) must be identical.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

let calls;
let checkInResult;
let alternateResponse;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(fn, ms = 2000) { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await tick(); } }

function boot() {
  const dom = new JSDOM(HTML, {
    url: 'http://kiosk.test/?slug=harness-salon', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.setInterval = () => 0;   // no heartbeat in tests
      win.fetch = async (url, init = {}) => {
        const path = new URL(url, 'http://kiosk.test').pathname; const method = init.method || 'GET';
        const body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ method, path, body, token: init.headers?.['x-checkin-token'] });
        const ok = (b, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
        if (path.endsWith('/config')) return ok({ salonName: 'Harness Salon', settings: { showWaitEstimate: true, walkinCheckinEnabled: true, technicianPreferenceEnabled: true } });
        if (path.endsWith('/start-session')) return ok({ sessionId: 's1', sessionToken: 'tok-1', config: { salonName: 'Harness Salon', settings: { showWaitEstimate: true, walkinCheckinEnabled: true, technicianPreferenceEnabled: true } } });
        if (path.endsWith('/lookup-phone')) return ok({ match: { source: 'tenant', firstName: 'Ava', customerId: 'c1' }, appointment: { appointmentId: 'ap1', startTimeLabel: '10:00 AM', serviceName: 'Gel Manicure', technicianName: 'Mai' } });
        if (path.endsWith('/check-in-appointment')) return ok(checkInResult);
        if (path.endsWith('/accept-alternate')) return alternateResponse;
        return ok({});
      };
    },
  });
  return dom;
}

// drive to the confirmation screen through the real flow: welcome → keypad → lookup → "I'm Here" on the appointment
async function toConfirmation(dom) {
  const doc = dom.window.document;
  (await until(() => doc.getElementById('go'))).click();
  await until(() => doc.querySelector('.keypad'));
  for (const d of '5551234567') doc.querySelector(`.key[data-k="${d}"]`).click();
  doc.querySelector('.key[data-k="✓"]').click();
  (await until(() => doc.getElementById('here'))).click();
  await until(() => doc.getElementById('done'));
  return doc;
}

beforeEach(() => {
  calls = [];
  checkInResult = { status: 'checked_in', firstName: 'Ava', estimatedWait: { fromMinutes: 30, toMinutes: 40 }, queueItemId: 'qi-9',
    requestedTechnician: { technicianId: 'tA', name: 'Mai', busy: true, availableInMinutes: 35 },
    alternates: [{ technicianId: 'tB', name: 'Kim', availableInMinutes: 5 }, { technicianId: 'tC', name: 'Ana', availableInMinutes: 0 }] };
  alternateResponse = { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, technicianName: 'Kim' }) };   // A's exact response
});

describe('kiosk: estimated wait + accept another technician', () => {
  it('both shipped copies are the same file', () => {
    expect(readFileSync(join(ROOT, 'www', 'index.html'), 'utf8')).toBe(HTML);
  });

  it('offers the alternates when the requested technician is busy; accepting posts the queue item + technician with the session token', async () => {
    const dom = boot();
    const doc = await toConfirmation(dom);
    expect(doc.body.textContent).toContain('30–40 min');
    expect(doc.getElementById('alt').textContent).toContain('Mai is with another guest (about 35 min)');
    expect(doc.getElementById('alt').textContent).toContain('free now');
    doc.querySelector('[data-alt="tB"]').click();
    await until(() => doc.getElementById('alt-done'));
    expect(doc.getElementById('alt-done').textContent).toContain('You’re now waiting for Kim.');
    const post = calls.find((c) => c.path.endsWith('/accept-alternate'));
    expect(post).toMatchObject({ method: 'POST', path: '/api/v1/go-check-in/session/s1/accept-alternate', body: { queueItemId: 'qi-9', technicianId: 'tB' }, token: 'tok-1' });
    dom.window.close();
  });

  it('BUILD_PLAN Phase 12: every call the kiosk makes is /api/v1/go-check-in/… (kiosks in the field keep the legacy path)', async () => {
    const dom = boot();
    await toConfirmation(dom);
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(c.path, c.path).toMatch(/^\/api\/v1\/go-check-in\//);
    dom.window.close();
  });

  it('"Keep waiting" removes the offer without calling the server', async () => {
    const dom = boot();
    const doc = await toConfirmation(dom);
    (await until(() => doc.getElementById('keep'))).click();
    expect(doc.getElementById('alt')).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/accept-alternate'))).toBe(false);
    dom.window.close();
  });

  it('a technician who was just taken (409) is said plainly; the guest stays checked in', async () => {
    alternateResponse = { ok: false, status: 409, text: async () => JSON.stringify({ message: 'That technician was just taken — please choose another, or keep waiting.', code: 'technician_taken' }) };
    const dom = boot();
    const doc = await toConfirmation(dom);
    (await until(() => doc.querySelector('[data-alt="tB"]'))).click();
    await until(() => doc.getElementById('alt-done'));
    expect(doc.getElementById('alt-done').textContent).toContain('That technician was just taken — please choose another, or keep waiting.');
    expect(doc.body.textContent).toContain('You’re checked in!');
    dom.window.close();
  });

  it('no offer when the requested technician is free or nothing is offered (never guessed); the wait still shows', async () => {
    checkInResult = { ...checkInResult, requestedTechnician: { technicianId: 'tA', name: 'Mai', busy: false } };
    const dom = boot();
    const doc = await toConfirmation(dom);
    expect(doc.body.textContent).toContain('30–40 min');
    expect(doc.getElementById('alt')).toBeNull();
    dom.window.close();
  });
});
