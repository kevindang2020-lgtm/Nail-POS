// No secret is ever written to the server log (Sep 2026 merge: the developer's tree printed activation OTPs and temporary
// passwords with console.log). Scans every server source file: a console call may not interpolate a secret-named value.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeRoots, codeKey } from '../../test-support/code-roots';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walk(p)) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
const SECRET = /\$\{\s*(?:[\w.]*\.)?(?:code|otp|otpCode|password|temporaryPassword|tempPassword|newPassword|pin|token|secret|apiKey|accessToken|refreshToken)\s*\}/i;

describe('no secret reaches the server log', () => {
  it('no console.* call interpolates a code, password, PIN, token or secret', () => {
    const hits: string[] = [];
    for (const f of codeRoots().flatMap((r) => walk(r))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/console\.(log|info|warn|error|debug)\(/.test(line) && SECRET.test(line)) hits.push(`${codeKey(f)}:${i + 1}`);
      });
    }
    expect(hits, `secrets written to the log:\n${hits.join('\n')}`).toEqual([]);
  });
});
