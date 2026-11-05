// bank-endpoint-secrets.pgtest — Constitution 12 M6/M7/M8 (migration 451): no plaintext bearer tokens or signing secrets.
import { secretSealers } from './provider-secrets.module';   // the API's real webhook sealer (this spec stays in the API)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { KyselyWebhookRepository } from '@aipowersalon/payments';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const T = 'f1f1f1f1-0000-4000-8000-00000000000a', BA = 'f2f2f2f2-0000-4000-8000-00000000000a';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'B', 'B', 'bank-t', 'BANK1', 'active') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => { await pg.exec(`DELETE FROM bank_webhook_endpoints WHERE tenant_id = '${T}'; DELETE FROM billing_export_jobs WHERE created_by_user_id = 'a0a0a0a0-0000-4000-8000-000000000a5a'`); });
const bankAccountCols = async () => (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_webhook_endpoints' AND is_nullable = 'NO' AND column_default IS NULL`)).rows.map((r: any) => r.column_name);

describe('M6 bank webhook endpoints (migration 542 finished what 451 started)', () => {
  const cols = async () => (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_webhook_endpoints'`)).rows.map((r: any) => r.column_name);
  it('the plaintext token and signing-secret columns are gone; only the hash and the sealed secret remain', async () => {
    const c = await cols();
    expect(c).not.toContain('token'); expect(c).not.toContain('signing_secret');
    expect(c).toEqual(expect.arrayContaining(['token_hash', 'signing_secret_enc']));
    expect(await bankAccountCols()).not.toContain('token_hash');
  });
  it('an endpoint resolves by the token\'s hash and its sealed secret; the wrong token or the hash itself does not', async () => {
    const sealer = secretSealers.forPurpose('webhook');
    await pg.query(`INSERT INTO bank_webhook_endpoints (tenant_id, bank_account_id, token_hash, signing_secret_enc, status) VALUES ($1, $2, $3, $4, 'active')`, [T, BA, sha('tok-2'), sealer.encrypt('whsec-2')]);
    const repo = new KyselyWebhookRepository(db, sealer);
    expect(await repo.resolveEndpoint('tok-2')).toMatchObject({ tenantId: T, signingSecret: 'whsec-2', status: 'active' });
    expect(await repo.resolveEndpoint('tok-2x')).toBeNull();
    expect(await repo.resolveEndpoint(sha('tok-2'))).toBeNull();   // presenting the HASH as the token does not work either
  });
  it('an endpoint with no sealed secret cannot authenticate anything → null, not an empty secret', async () => {
    await pg.query(`INSERT INTO bank_webhook_endpoints (tenant_id, bank_account_id, token_hash, status) VALUES ($1, $2, $3, 'active')`, [T, BA, sha('tok-3')]);
    expect(await new KyselyWebhookRepository(db, secretSealers.forPurpose('webhook')).resolveEndpoint('tok-3')).toBeNull();
  });
});

describe('M7 billing export tokens', () => {
  it('only the SHA-256 of the download token is stored; the token itself still downloads', async () => {
    const { KyselyBillingRepository } = await import('@aipowersalon/super-admin') as any;
    const repo = new KyselyBillingRepository(db);
    const job = await repo.createExportJob({ userId: 'a0a0a0a0-0000-4000-8000-000000000a5a', role: 'SUPER_ADMIN' } as any, { report: 'invoices' });
    const stored = (await pg.query(`SELECT download_token_hash FROM billing_export_jobs WHERE id = $1`, [job.jobId])).rows[0].download_token_hash;
    expect(stored).toBe(sha(job.token)); expect(stored).not.toBe(job.token);
    expect((await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_export_jobs' AND column_name = 'download_token'`)).rows).toEqual([]);
  }, 60_000);   // the first dynamic import of @aipowersalon/super-admin loads the whole control plane (Constitution 13) — cold, that alone can pass 5 s
});

describe('M8', () => {
  it('the unused kiosk-session bearer column is gone', async () => {
    expect((await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'public_check_in_sessions' AND column_name = 'public_token'`)).rows).toEqual([]);
  });
});
