// Payments mandate §7 / §10 / §13 / §138 / §140 (wave 3) on the real schema: the ONE provider router resolves tenant + BRANCH
// → merchant account → adapter. A branch with its own merchant (payment_merchant_accounts) charges through it; a branch
// without one inherits the tenant default; a paused branch merchant does NOT silently fall back to the tenant default; a
// webhook's MID resolves to exactly one (tenant, branch) across both tables; a branch of tenant B can never be routed for
// tenant A (the database refuses the cross-tenant row).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentGatewayResolver } from './payment-gateway.resolver';

const A = '81818181-8181-4818-8818-818181818181', B = '82828282-8282-4828-8828-828282828282';
const A_CH = '83838383-8383-4838-8838-838383838383', A_MAIN = '84848484-8484-4848-8848-848484848484', B_ONE = '85858585-8585-4858-8858-858585858585';
let pg: any; let db: any;
const plain = { encrypt: (s: string) => 'enc:' + s, decrypt: (s: string) => String(s).replace(/^enc:/, '') } as any;
const resolver = () => new PaymentGatewayResolver(db, plain);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [id, slug] of [[A, 'salona'], [B, 'salonb']]) {
    await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,$2,$2,$2,upper($2),'active')`, [id, slug]);
  }
  await pg.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,'Cherry Hill'),($3,$2,'Main'),($4,$5,'B One')`, [A_CH, A, A_MAIN, B_ONE, B]);
  await pg.query(`INSERT INTO tenant_payment_config (tenant_id, processor, environment, base_url, merchant_id, api_username_enc, api_password_enc, status)
                  VALUES ($1,'fiserv','sandbox','https://isv-uat.cardconnect.com/cardconnect/rest','MID-A-DEFAULT','enc:u','enc:p','active'),
                         ($2,'fiserv','sandbox','https://isv-uat.cardconnect.com/cardconnect/rest','MID-B-DEFAULT','enc:u','enc:p','active')`, [A, B]);
  await pg.query(`INSERT INTO payment_merchant_accounts (tenant_id, branch_id, processor, environment, base_url, merchant_id, api_username_enc, api_password_enc, status, display_name)
                  VALUES ($1,$2,'fiserv','sandbox','https://isv-uat.cardconnect.com/cardconnect/rest','MID-1001','enc:u2','enc:p2','active','Cherry Hill merchant')`, [A, A_CH]);
});

describe('payment provider router — tenant + branch → merchant account', () => {
  it('a branch with its own merchant routes to it (scope branch, its MID)', async () => {
    const g = await resolver().resolve(A, A_CH);
    expect(g).toMatchObject({ configured: true, status: 'active', scope: 'branch', branchId: A_CH });
    expect(g.merchantAccountId).toBeTruthy();
    expect(g.merchantIdMasked.endsWith('1001')).toBe(true);
    expect(g.processor).toBeTruthy();
  });
  it('a branch without its own merchant inherits the tenant default', async () => {
    const g = await resolver().resolve(A, A_MAIN);
    expect(g).toMatchObject({ configured: true, scope: 'tenant', merchantAccountId: null });
    expect(g.merchantIdMasked.endsWith('AULT')).toBe(true);
  });
  it('no branch → the tenant default (unchanged behaviour)', async () => {
    const g = await resolver().resolve(A);
    expect(g).toMatchObject({ configured: true, scope: 'tenant' });
  });
  it('a paused branch merchant blocks charging at that branch — never a silent fall back to the tenant default', async () => {
    await pg.query(`UPDATE payment_merchant_accounts SET status = 'paused' WHERE branch_id = $1`, [A_CH]);
    const g = await resolver().resolve(A, A_CH);
    expect(g).toMatchObject({ configured: false, status: 'paused', scope: 'branch' });
    expect(g.processor).toBeUndefined();
    await pg.query(`UPDATE payment_merchant_accounts SET status = 'active' WHERE branch_id = $1`, [A_CH]);
  });
  it('§138: tenant B asking for tenant A\'s branch gets B\'s default, never A\'s branch merchant', async () => {
    const g = await resolver().resolve(B, A_CH);
    expect(g.scope).toBe('tenant');
    expect(g.merchantIdMasked.endsWith('AULT')).toBe(true);
    expect(g.merchantAccountId).toBeNull();
  });
  it('§140: the database refuses a branch merchant row naming another tenant\'s branch', async () => {
    await expect(pg.query(`INSERT INTO payment_merchant_accounts (tenant_id, branch_id, processor, status) VALUES ($1,$2,'fiserv','pending')`, [B, A_CH])).rejects.toThrow(/cross-tenant/);
  });
  it('a webhook MID resolves to exactly one (tenant, branch) across the tenant defaults and the branch merchants', async () => {
    const r = await resolver().resolveTenantByMerchantId('MID-1001');
    expect(r).toMatchObject({ tenantId: A, branchId: A_CH });
    const d = await resolver().resolveTenantByMerchantId('MID-B-DEFAULT');
    expect(d).toMatchObject({ tenantId: B, branchId: null });
    await pg.query(`INSERT INTO payment_merchant_accounts (tenant_id, branch_id, processor, merchant_id, status) VALUES ($1,$2,'fiserv','MID-B-DEFAULT','pending')`, [B, B_ONE]);
    expect(await resolver().resolveTenantByMerchantId('MID-B-DEFAULT')).toBeNull();   // ambiguous → refused
  });
  it('§169: the router caches the built processor per (tenant, branch, provider, version) and drops it when the config changes', async () => {
    const r = resolver();
    const g1 = await r.resolve(A, A_CH); const g2 = await r.resolve(A, A_CH);
    expect(g2.processor).toBe(g1.processor);
    await pg.query(`UPDATE payment_merchant_accounts SET api_password_enc = 'enc:rotated', config_version = config_version + 1 WHERE branch_id = $1`, [A_CH]);
    const g3 = await r.resolve(A, A_CH);
    expect(g3.processor).not.toBe(g1.processor);
    expect(g3.configVersion).toBe(2);
  });
  it('§13/§17 terminal route: the branch merchant\'s Bolt key drives the Clover at that branch; the tenant default elsewhere', async () => {
    // Fiserv master build §5.3: Bolt hosts must be allowlisted Fiserv hosts matching the row's environment (sandbox → UAT)
    await pg.query(`UPDATE payment_merchant_accounts SET bolt_base_url = 'https://branch-uat.bolt.cardpointe.com', bolt_api_key_enc = 'enc:bolt-branch' WHERE branch_id = $1`, [A_CH]);
    await pg.query(`UPDATE tenant_payment_config SET bolt_base_url = 'https://default-uat.bolt.cardpointe.com', bolt_api_key_enc = 'enc:bolt-default' WHERE tenant_id = $1`, [A]);
    const br = await resolver().resolveTerminalConfig(A, A_CH);
    expect(br.config).toEqual({ baseUrl: 'https://branch-uat.bolt.cardpointe.com', apiKey: 'bolt-branch', merchantId: 'MID-1001' });
    expect(br.scope).toBe('branch');
    const main = await resolver().resolveTerminalConfig(A, A_MAIN);
    expect(main.config).toEqual({ baseUrl: 'https://default-uat.bolt.cardpointe.com', apiKey: 'bolt-default', merchantId: 'MID-A-DEFAULT' });
    expect(main.scope).toBe('tenant');
  });
  it('Fiserv §5.3: a non-Fiserv Bolt host, or a production host on a sandbox merchant, is refused (HOST_NOT_ALLOWED) — no key handed out', async () => {
    await pg.query(`UPDATE tenant_payment_config SET bolt_base_url = 'https://bolt-default.example', bolt_api_key_enc = 'enc:bolt-default' WHERE tenant_id = $1`, [A]);
    const r1 = await resolver().resolveTerminalConfig(A, A_MAIN);
    expect(r1.config).toBeNull(); expect(r1.reason).toBe('HOST_NOT_ALLOWED');
    await pg.query(`UPDATE tenant_payment_config SET bolt_base_url = 'https://mysite.bolt.cardpointe.com' WHERE tenant_id = $1`, [A]);
    const r2 = await resolver().resolveTerminalConfig(A, A_MAIN);
    expect(r2.config).toBeNull(); expect(r2.reason).toBe('HOST_NOT_ALLOWED');
  });
  it('Fiserv §5.2: a terminal bound to branch Cherry Hill\'s merchant account cannot charge from another branch', async () => {
    await pg.query(`UPDATE payment_merchant_accounts SET bolt_base_url = 'https://branch-uat.bolt.cardpointe.com', bolt_api_key_enc = 'enc:bolt-branch' WHERE branch_id = $1`, [A_CH]);
    const acct: any = (await pg.query(`SELECT id FROM payment_merchant_accounts WHERE branch_id = $1`, [A_CH])).rows[0];
    const r = await resolver().resolveTerminalConfig(A, A_MAIN, String(acct.id));
    expect(r.config).toBeNull(); expect(r.reason).toBe('MERCHANT_BRANCH_MISMATCH');
    const ok = await resolver().resolveTerminalConfig(A, A_CH, String(acct.id));
    expect(ok.config?.merchantId).toBe('MID-1001');
  });
  it('terminal route: a paused branch merchant answers MERCHANT_SUSPENDED (no fall back); no Bolt key → TERMINAL_NOT_CONFIGURED', async () => {
    await pg.query(`UPDATE payment_merchant_accounts SET status = 'paused' WHERE branch_id = $1`, [A_CH]);
    expect((await resolver().resolveTerminalConfig(A, A_CH)).reason).toBe('MERCHANT_SUSPENDED');
    await pg.query(`UPDATE payment_merchant_accounts SET status = 'active' WHERE branch_id = $1`, [A_CH]);
    expect((await resolver().resolveTerminalConfig(B, B_ONE)).reason).toBe('MERCHANT_NOT_CONFIGURED');   // B One's own merchant is still pending
    expect((await resolver().resolveTerminalConfig(B, null)).reason).toBe('TERMINAL_NOT_CONFIGURED');    // B's default has no Bolt
    expect((await resolver().resolveTerminalConfig(B, A_CH)).scope).toBe('tenant');                       // §138: never A's branch row
  });
});

// Oct 21 2026 (Oct 19 audit item, rebuilt): "merchant routing never silently falls back" — the two gaps left.
describe('merchant routing never silently falls back', () => {
  it('a FAILED read of the branch merchants (database error) is an error, not the tenant default (a different MID would settle the money elsewhere)', async () => {
    await pg.query(`ALTER TABLE payment_merchant_accounts RENAME TO payment_merchant_accounts_gone`);
    try {
      await expect(resolver().resolve(A, A_CH)).rejects.toThrow(/merchant/i);
      await expect(resolver().resolveTerminalConfig(A, A_CH, null)).rejects.toThrow(/merchant/i);
    } finally { await pg.query(`ALTER TABLE payment_merchant_accounts_gone RENAME TO payment_merchant_accounts`); }
  });
  it('a terminal tied to a merchant account that no longer exists answers MERCHANT_NOT_CONFIGURED for THAT account — never the branch\'s or the salon\'s key', async () => {
    const r = await resolver().resolveTerminalConfig(A, A_CH, '86868686-8686-4868-8868-868686868686');
    expect(r).toMatchObject({ config: null, scope: 'branch', merchantAccountId: '86868686-8686-4868-8868-868686868686', reason: 'MERCHANT_NOT_CONFIGURED' });
  });
  it('a terminal tied to ANOTHER salon\'s merchant account is refused the same way (the id is scoped by this tenant)', async () => {
    const [{ id }] = (await pg.query(`SELECT id FROM payment_merchant_accounts WHERE tenant_id = $1 AND branch_id = $2`, [A, A_CH])).rows;
    const r = await resolver().resolveTerminalConfig(B, B_ONE, String(id));
    expect(r).toMatchObject({ config: null, scope: 'branch', merchantAccountId: String(id), reason: 'MERCHANT_NOT_CONFIGURED' });
  });
});
