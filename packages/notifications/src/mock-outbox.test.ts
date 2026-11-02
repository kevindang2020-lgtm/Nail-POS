// mock-outbox.test.ts — the proof-only outbox (Security Deep Scan C2): live proofs read the mock senders' messages from a
// file; it is inert without MOCK_OUTBOX_FILE and never writes in production.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockOutbox } from './email.service';

describe('mockOutbox', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-'));
  it('appends one JSON line per message when MOCK_OUTBOX_FILE is set outside production', () => {
    const file = join(dir, 'a.jsonl');
    mockOutbox({ channel: 'email', to: 'o@x.test', subject: 's', body: 'b1' }, { MOCK_OUTBOX_FILE: file, NODE_ENV: 'development' } as any);
    mockOutbox({ channel: 'sms', to: '+16095550100', body: 'b2' }, { MOCK_OUTBOX_FILE: file, NODE_ENV: 'test' } as any);
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.channel, l.to, l.body])).toEqual([['email', 'o@x.test', 'b1'], ['sms', '+16095550100', 'b2']]);
  });
  it('is inert without the variable and NEVER writes in production', () => {
    const file = join(dir, 'prod.jsonl');
    mockOutbox({ channel: 'email', to: 'o@x.test', body: 'secret' }, { MOCK_OUTBOX_FILE: file, NODE_ENV: 'production' } as any);
    mockOutbox({ channel: 'email', to: 'o@x.test', body: 'secret' }, { NODE_ENV: 'development' } as any);
    expect(existsSync(file)).toBe(false);
  });
});
