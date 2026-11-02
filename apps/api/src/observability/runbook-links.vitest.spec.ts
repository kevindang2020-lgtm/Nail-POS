// runbook-links.vitest.spec — Constitution 11 §102, §177–179: every alert links to a runbook that EXISTS.
//
// The component registry sent alerts to RUNBOOKS.md#… before that file existed — every alert would have pointed a
// responder at nothing. This resolves each link to a real file and a real heading, and checks §179's structure and
// §178's required list.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { COMPONENTS } from './health-core';

const ROOT = join(process.cwd(), '../..');
const slug = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
const anchorsOf = (file: string) => new Set([...readFileSync(join(ROOT, file), 'utf8').matchAll(/^##\s+(.+)$/gm)].map((m) => slug(m[1])));

describe('every component\'s runbook link resolves', () => {
  for (const c of COMPONENTS) {
    it(`${c.key} → ${c.runbook}`, () => {
      const [file, anchor] = c.runbook.split('#');
      expect(existsSync(join(ROOT, file)), `${file} does not exist`).toBe(true);
      if (anchor) expect(anchorsOf(file).has(anchor), `${file} has no "## ${anchor}" heading`).toBe(true);
    });
  }
});

describe('§178 the required runbooks exist, with §179 structure', () => {
  const REQUIRED = ['api-outage', 'database-outage', 'redis-outage', 'queue-backlog', 'worker-crash-loop', 'realtime-outage', 'twilio-outage',
    'payment-processor-outage', 'ai-provider-outage', 'storage-outage', 'backup-failure', 'deployment-failure', 'cross-tenant-security-incident'];
  const anchors = anchorsOf('RUNBOOKS.md');
  for (const r of REQUIRED) it(`${r} exists`, () => expect(anchors.has(r)).toBe(true));
  it('each full runbook covers symptoms, confirmation, mitigation, safe and unsafe actions, escalation, recovery', () => {
    const text = readFileSync(join(ROOT, 'RUNBOOKS.md'), 'utf8');
    const sections = text.split(/^## /m).slice(1).filter((s) => !/^(realtime-outage|email-outage)\b/.test(s));
    for (const s of sections) {
      const name = s.split('\n')[0];
      for (const part of ['Symptoms', 'How to confirm', 'Immediate mitigation', 'Safe', 'Unsafe', 'Escalation', 'Recovery verification']) {
        expect(s, `${name}: missing "${part}"`).toMatch(new RegExp(`\\*\\*${part}`));
      }
    }
  });
});
