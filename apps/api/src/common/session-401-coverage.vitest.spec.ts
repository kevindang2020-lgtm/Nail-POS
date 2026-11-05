// session-401-coverage.vitest.spec.ts — every app that uses the shared staff/customer session MUST handle a 401.
//
// Session revocation is cross-app: signing out on one device, or an admin killing a compromised session, makes
// the API return 401 to EVERY app that user has open. An app that doesn't handle it keeps rendering its shell
// while every screen errors — it still LOOKS signed in but does nothing.
//
// This was found the hard way: the 401 handling was fixed in pos-web first, and admin-web / owner-web / tech-web /
// customer-web / manager-pay-web were all still broken. This test stops the next app from shipping that way.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const APPS_ROOT = join(__dirname, '../../..');

// Apps whose API client talks to the shared session endpoints (/auth/me, /auth/logout).
const TRANSPORT = readFileSync(join(APPS_ROOT, '..', 'packages', 'mobile-sdk', 'src', 'network', 'transport.ts'), 'utf8');
const SESSION_APPS = ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'manager-pay-web'];

describe('every session-using app handles a 401 (revoked/expired session)', () => {
  for (const app of SESSION_APPS) {
    const clientPath = join(APPS_ROOT, app, 'src/api/client.ts');

    it(`${app}: the API client exists`, () => {
      expect(existsSync(clientPath), `${app}/src/api/client.ts is missing`).toBe(true);
    });

    it(`${app}: announces 401 so the app can return the user to sign-in`, () => {
      const src = readFileSync(clientPath, 'utf8');
      // BUILD_PLAN Phase 13: the four mobile apps' clients are thin wrappers over the ONE mobile transport — the 401
      // announcement lives there, so it is checked there (and the client must not switch it off for every call)
      const viaTransport = /createTransport\(/.test(src) && /from '@aipowersalon\/mobile-sdk'/.test(src)
        && /res\.status === 401/.test(TRANSPORT) && /dispatchEvent\(new CustomEvent\('aps:unauthorized'\)\)/.test(TRANSPORT)
        && !/notifyUnauthorized:\s*false/.test(src);
      expect(
        (/res\.status === 401/.test(src) && /aps:unauthorized/.test(src)) || viaTransport,
        `${app} does not announce a 401. A revoked or expired session would leave it rendering a shell where ` +
        `every screen errors while still LOOKING signed in. Dispatch 'aps:unauthorized' on res.status === 401 ` +
        `and have AuthContext drop the principal.`,
      ).toBe(true);
    });
  }
});
