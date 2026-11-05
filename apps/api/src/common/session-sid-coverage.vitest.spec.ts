// session-sid-coverage.vitest.spec.ts — EVERY path that mints a session token must carry the session row id.
//
// Why this guard exists: a session token without `sid` is UNREVOCABLE. The revocation check keys off it, so a
// token that omits it silently opts out of "sign out other devices" and of an admin killing a compromised
// session — the failure is invisible, because the token still works perfectly.
//
// This was found the hard way, twice:
//   • branch selection RE-SIGNED the token and dropped the sid (every multi-branch user unrevocable);
//   • password-reset temp-login and the emergency system-reset both minted tokens without it — even though they
//     had already INSERTED the session row and had its id in hand. A password-reset session is precisely the one
//     you'd most want to kill if a reset link were intercepted.
//
// So: scan the source. Any call to signSession() must pass a sid.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.ts$/.test(e) && !/\.(spec|test)\.ts$/.test(e)) out.push(p);
  }
  return out;
}

describe('every session-minting path is sid-aware (else the session is unrevocable)', () => {
  // The token-signing helper DEFINES signSession — it is not a minting site.
  const DEFINITION = join(SRC, '..', '..', '..', 'modules', 'identity', 'src', 'auth', 'auth-session-token.ts');   // identity is modules/identity (Constitution 13)
  const files = codeRoots().flatMap((r) => walk(r))
    .filter((f) => f !== DEFINITION)
    .filter((f) => readFileSync(f, 'utf8').includes('signSession('));

  it('found the session-minting call sites', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    const rel = f.replace(SRC, 'src');
    it(`${rel}: is sid-aware`, () => {
      // Strip comments FIRST. A guard that passes because a comment happens to mention `sid` is worse than no
      // guard at all — it reports safety it hasn't checked. (This exact false pass was caught while writing it.)
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
        .replace(/^\s*\/\/.*$/gm, '');          // line comments
      expect(
        /\bsid\b/.test(src),
        `${rel} mints a session token but never mentions \`sid\`.\n` +
        `That session can NEVER be revoked: "sign out other devices" and admin session-kill will both silently ` +
        `fail for it, while the token keeps working until it expires.\n` +
        `Insert the sessions row and pass its id as \`sid\` in the signed claims.`,
      ).toBe(true);
    });
  }
});
