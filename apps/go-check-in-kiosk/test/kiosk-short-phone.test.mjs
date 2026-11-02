// wave 4 UI sweep: on the kiosk keypad, ✓ with fewer than 7 digits did nothing at all — no message — so a guest who
// typed part of the number was left guessing. It now says what is missing, and still never looks up a partial number.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(fn, ms = 2000) { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await tick(); } }

describe('kiosk keypad: ✓ with a partial number', () => {
  it('asks for the full number and does not look anything up', async () => {
    const calls = [];
    const dom = new JSDOM(HTML, { url: 'http://kiosk.test/?slug=harness-salon', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(win) {
        win.setInterval = () => 0;
        win.fetch = async (url, init = {}) => { const path = new URL(url, 'http://kiosk.test').pathname; calls.push(path);
          const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
          if (path.endsWith('/config')) return ok({ salonName: 'Harness Salon', settings: {} });
          if (path.endsWith('/start-session')) return ok({ sessionId: 's1', sessionToken: 't', config: { salonName: 'Harness Salon', settings: {} } });
          return ok({}); };
      } });
    const doc = dom.window.document;
    (await until(() => doc.getElementById('go'))).click();
    await until(() => doc.querySelector('.keypad'));
    for (const d of '555') doc.querySelector(`.key[data-k="${d}"]`).click();
    doc.querySelector('.key[data-k="✓"]').click();
    expect(doc.getElementById('pd').textContent).toMatch(/full phone number/i);
    expect(calls.some((p) => p.endsWith('/lookup-phone'))).toBe(false);
    doc.querySelector('.key[data-k="4"]').click();                 // typing again shows the number again
    expect(doc.getElementById('pd').textContent).toBe('(555) 4');
  });
});
