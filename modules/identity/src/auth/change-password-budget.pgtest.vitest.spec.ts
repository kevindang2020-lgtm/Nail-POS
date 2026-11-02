// change-password-budget.pgtest — Security Deep Scan C4: POST /auth/change-password re-proves the current password for a
// signed-in session and had NO attempt limit (an unlimited password oracle for a hijacked session). Now 5 wrong guesses
// per account per 15 minutes (Postgres): after them even the RIGHT current password is refused with 429, and the
// password is unchanged. A refused weak NEW password is not a guess and spends nothing. Old code: the last call succeeded.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { AccountController } from './account.controller';

let pg: any; let db: any;
const T = 'af000000-0000-4000-8000-0000000000c4', U = 'af000000-0000-4000-8000-0000000000a1';
const CURRENT = 'Current-Pass-123';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'CP', 'CP', 'cp-t', 'CPT', 'active') ON CONFLICT DO NOTHING`);
  await pg.query(`INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ($1, $2, 'Pat', 'pat@cp.test', $3, 'active', 'MANAGER') ON CONFLICT DO NOTHING`, [U, T, await hashPassword(CURRENT)]);
});

describe('C4 — change-password attempts are budgeted', () => {
  it('a weak new password spends nothing; 5 wrong current passwords lock; then the right one is refused (429)', async () => {
    const c = new AccountController(db, testProviderSecrets);
    const r = { ctx: { userId: U, tenantId: T, role: 'MANAGER' }, ip: '198.51.100.30' };
    for (let i = 0; i < 6; i++) await expect(c.changePassword(r, { currentPassword: CURRENT, newPassword: 'short', confirmPassword: 'short' })).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < 5; i++) await expect(c.changePassword(r, { currentPassword: 'nope-' + i, newPassword: 'Brand-New-Pass-9', confirmPassword: 'Brand-New-Pass-9' })).rejects.toMatchObject({ status: 400 });
    await expect(c.changePassword(r, { currentPassword: CURRENT, newPassword: 'Brand-New-Pass-9', confirmPassword: 'Brand-New-Pass-9' })).rejects.toMatchObject({ status: 429 });
    const hash = (await pg.query(`SELECT password_hash FROM users WHERE id = $1`, [U])).rows[0].password_hash;
    expect(await verifyPassword(CURRENT, hash)).toBe(true);
  });
});
