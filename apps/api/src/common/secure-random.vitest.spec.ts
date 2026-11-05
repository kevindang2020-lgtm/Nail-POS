// secure-random.vitest.spec — Constitution 12 finding H9: no security value comes from Math.random().
//
// A keyword heuristic ("token", "code" on the same line) was tried first and MISSED gift-card codes and device pairing
// codes. So this guard does not guess: every remaining Math.random() in code must be on a REVIEWED list with a reason
// it is not a secret. A new one fails the build until someone decides — and if it guards anything, it uses secure-random.
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { codeRoots, codeKey, sourcePath } from '../../test-support/code-roots';
import { join } from 'node:path';
import { secureToken, secureDigits, secureString, secureTempPassword } from '@aipowersalon/security';

const REVIEWED: Record<string, string> = {
  'observability/sync-reconciliation.ts': 'scheduler start jitter (spreads workers apart, Smooth Refresh spec §38) — guards nothing',
  'ai-booking/ai-booking-context.ts': 'best-effort correlation id',
  'ai-booking/ai-booking-public.resolver.ts': 'correlation id fallback (not a credential)',
  'ai-ocr-receipt/ai-ocr-receipt.kysely.ts': 'row id generator (uuid-shaped), not a credential',
  'ai/ai-platform.ts': 'hashed into a request id',
  'auth/login-throttle-redis.ts': 'sorted-set member uniqueness',
  'checkout/checkout.kysely.repository.ts': 'receipt number label',
  'checkout/checkout.repository.ts': 'in-memory test double ids',
  'packages/security/keyed-rate-limit.ts': 'sorted-set member uniqueness',
  'common/tenant-rate-limit.ts': 'sorted-set member uniqueness',
  'packages/observability/telemetry-store.ts': 'INFO log sampling for the telemetry store when a line has no request id (TELEMETRY_LOG_SAMPLE) — Phase 14 A, guards nothing',
  'packages/observability/tracing/span.ts': 'trace sampling decision (parent-based; a span id/trace id is minted with crypto) — Phase 11',
  'hardware-payment/hardware-payment.charge-adapter.ts': 'sandbox adapter fake reference',
  'help/support-tickets.service.ts': 'support ticket number label',
  'memberships/membership-enroll-core.ts': 'member number label (display, not a bearer credential)',
  'memberships/memberships.repository.ts': 'in-memory test double ids',
  'settings/settings.service.ts': 'audit row id',
  'super-admin-alerts/alerts.repository.ts': 'in-memory test double ids',
  'super-admin-audit-logs/audit-evidence.service.ts': 'evidence pack reference label',
  'super-admin-audit-logs/audit-investigations.service.ts': 'case reference label',
  'super-admin-audit-logs/audit-legal-holds.service.ts': 'legal hold reference label',
  'super-admin-report-builder/super-admin-report-builder.repository.ts': 'in-memory test double ids',
  'super-admin-scheduled-reports/super-admin-scheduled-reports.repository.ts': 'in-memory test double ids',
  'super-admin-system-status/system-status.kysely.repository.ts': 'incident/PIR reference labels',
  'super-admin-tenants/super-admin-tenants.service.ts': 'public salon code suffix (an identifier, not a secret)',
  'tech-profile/global-tech-identity.service.ts': 'public handle / key suffix',
  'tech-profile/tech-profile.service.ts': 'public-media storage key suffix',
  'tenant-safety-community/community.repository.ts': 'in-memory test double ids',
  'voice-booking/voice-gateway-core.ts': 'hashed into a request id',
  'packages/realtime-contracts/realtime-core.ts': 'event id uniqueness (envelope id suffix, not a credential)',
};
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|test|\.d\.ts$/.test(f) ? [p] : []); });
// Strip block and line comments (not inside strings — good enough for this code base; a false negative would need
// Math.random() inside a string literal, which is not a call).
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('H9 no security value from Math.random()', () => {
  // Constitution 13: domain modules (modules/<name>/src) are part of the API's code surface — walked too, keyed as
  // <name>/<file> so the reviewed list keeps applying to a file after it moves (the directory name became the module name).
  // ...and the workspace packages the API depends on (keyed packages/<package>/<file>) — see test-support/code-roots.
  const users = codeRoots().flatMap((r) => walk(r)).filter((f) => /Math\.random\(\)/.test(code(readFileSync(f, 'utf8')))).map(codeKey);
  it('every Math.random() in code is on the reviewed non-secret list', () => {
    const unreviewed = users.filter((f) => !(f in REVIEWED));
    expect(unreviewed, `review these — if the value guards anything, use secureToken/secureDigits from @aipowersalon/security:\n${unreviewed.join('\n')}`).toEqual([]);
  });
  it('the list has no stale entries (a file that no longer uses it)', () => {
    expect(Object.keys(REVIEWED).filter((f) => !users.includes(f))).toEqual([]);
  });
  it('the fixed H9 sites use secure-random', () => {
    // Constitution 13: 'checkout/…' lives in modules/checkout now; everything else is still apps/api/src.
    const s = (p: string) => readFileSync(sourcePath(p), 'utf8');   // API or owning module (Constitution 13)
    expect(s('customer-activation/customer-activation.service.ts')).toMatch(/secureToken\(32\)/);
    // BUILD_PLAN Phase 3: the customer app's phone-verification code is no longer generated here at all — the canonical
    // phone service sends it through the salon's Twilio Verify, which holds the code (we never see it). No local
    // generator, and certainly no Math.random().
    expect(s('customer/customer.service.ts')).not.toMatch(/Math\.random|secureDigits\(/);
    // BUILD_PLAN Phase 4: and the duplicate route family is gone — the app verifies through /customer/profile/phone/*.
    expect(s('customer/customer.service.ts')).not.toMatch(/requestPhoneVerification|phoneVerifier/);
    expect(s('customer/customer.kysely.repository.ts')).toMatch(/'RDM' \+ secureString\(8\)/);
    expect(s('super-admin-platform/super-admin-platform.repository.ts')).toMatch(/return secureTempPassword\(\)/);
    // the customer-display pairing code moved (23-inch spec Unit 6): the display asks for it itself; the old staff-side
    // generator in settings/settings.devices.kysely.repository.ts is gone. Code, poll secret and credential: all secure.
    expect(s('customer-display/display-devices.service.ts')).toMatch(/const code = secureDigits\(DISPLAY_PAIRING_CODE_DIGITS\)/);
    expect(s('customer-display/display-devices.service.ts')).toMatch(/const pollSecret = randomBytes\(32\)/);
    expect(s('customer-display/display-devices.service.ts')).toMatch(/const deviceToken = randomBytes\(32\)/);
    expect(s('checkout/checkout.service.ts')).toMatch(/'GC-' \+ secureString\(10\)/);
  });
});

describe('the helpers', () => {
  it('tokens are 256-bit and never repeat', () => { const a = new Set(Array.from({ length: 2000 }, () => secureToken())); expect(a.size).toBe(2000); expect(secureToken().length).toBe(43); });
  it('digits are exactly N digits, no leading zero', () => { for (let i = 0; i < 500; i++) expect(secureDigits(6)).toMatch(/^[1-9]\d{5}$/); });
  it('strings use only the alphabet (no ambiguous 0/O/1/I)', () => { for (let i = 0; i < 200; i++) expect(secureString(12)).toMatch(/^[A-HJ-NP-Z2-9]{12}$/); });
  it('temporary passwords are 16 random characters after the prefix', () => expect(secureTempPassword()).toMatch(/^Tmp-[A-HJ-NP-Za-hj-kmnp-z2-9]{16}$/));
  it('digits are roughly uniform (not a biased generator)', () => {
    const counts = new Array(10).fill(0); for (let i = 0; i < 20000; i++) counts[Number(secureDigits(2)[1])]++;
    for (const c of counts) expect(c).toBeGreaterThan(1600);
  });
});
