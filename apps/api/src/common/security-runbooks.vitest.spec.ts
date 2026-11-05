// security-runbooks.vitest.spec — Constitution 12 §310–312: every control a runbook names actually exists.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SECRETS } from './secrets-inventory';
import { KEY_SOURCES } from './key-ring';
import { SECURITY_EVENT_TYPES } from '@aipowersalon/security-center';

const md = readFileSync(join(process.cwd(), '../../SECURITY_RUNBOOKS.md'), 'utf8');
const ticks = [...md.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.controller\.ts$/.test(f) ? [p] : []); });
const controllers = codeRoots().flatMap((r) => walk(r)).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('§310 all thirteen runbooks, each with the eight §311 sections named up front', () => {
  it('thirteen numbered runbooks', () => expect((md.match(/^### \d+\. /gm) ?? []).length).toBe(13));
  it.each(['Account takeover', 'Super Admin compromise', 'Cross-tenant incident', 'API key compromise', 'Payment credential compromise', 'Twilio compromise', 'AI provider compromise', 'Database breach', 'Ransomware', 'Lost mobile device', 'Backup restore', 'DDoS', 'SMS abuse'])('%s', (t) => expect(md).toContain(t));
  it('the eight-step structure is stated', () => expect(md).toMatch(/Detection · Containment · Evidence · Credential rotation · Recovery · Verification · Notification · Postmortem/));
});

describe('every control named exists', () => {
  it('every route: its final path segments appear as a route in some controller', () => {
    const routes = ticks.filter((t) => /^\/?(super-admin|pos|customer-data-oversight)/.test(t));
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const r of routes) {
      const segs = r.replace(/^\//, '').split('/');
      // the handler's own path is the last 1–3 segments (after the controller prefix) — some suffix must be a declared route
      const found = [3, 2, 1].some((n) => segs.length >= n && controllers.includes(`'${segs.slice(-n).join('/')}'`));
      expect(found, `runbook names ${r} — no controller declares it`).toBe(true);
    }
  });
  it('every ALL-CAPS variable is a real secret or key (or a documented _PREVIOUS)', () => {
    const known = new Set([...SECRETS.map((s) => s.env), ...Object.values(KEY_SOURCES).map((k) => k.env)]);
    for (const v of ticks.filter((t) => /^[A-Z][A-Z0-9_]{3,}$/.test(t) && !(SECURITY_EVENT_TYPES as readonly string[]).includes(t))) {
      expect(known.has(v.replace(/_PREVIOUS$/, '')), `runbook names ${v} — not in the secrets inventory`).toBe(true);
    }
  });
  it('every security event type named is in the catalog', () => {
    for (const e of ticks.filter((t) => /^[A-Z_]+$/.test(t) && /(FAILED|ATTEMPT|DETECTED|MFA_\*|ESCALATION)/.test(t))) {
      if (e === 'MFA_*') continue;
      expect(SECURITY_EVENT_TYPES as readonly string[], e).toContain(e);
    }
  });
  it('every script and test file named exists', () => {
    const specs = [join(process.cwd(), 'src/common'), join(process.cwd(), 'src/realtime')];
    for (const f of ticks.filter((t) => /^scripts\/|\.ts$|\.mjs$/.test(t) && !t.includes(' '))) {
      const exists = f.startsWith('scripts/') ? existsSync(join(process.cwd(), f)) : specs.some((d) => existsSync(join(d, f)));
      expect(exists, `runbook names ${f} — not found`).toBe(true);
    }
  });
});

describe('§312 no promised notification deadline', () => {
  it('never states a fixed notification window', () => expect(md).not.toMatch(/within \d+ (hours|days)|\d+-hour notif/i));
  it('defers to counsel', () => expect(md).toMatch(/ask counsel/i));
});
