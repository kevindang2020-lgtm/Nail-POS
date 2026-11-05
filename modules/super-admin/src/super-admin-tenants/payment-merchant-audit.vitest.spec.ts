// payment-merchant-audit.vitest.spec.ts — wave 3 PAYI §137 / §55: every Super Admin merchant change is audited and the
// audit never carries a secret (merchant configured / changed, status change, connection test, webhook-secret rotation).
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { SuperAdminTenantsController } from './super-admin-tenants.controller';

const SECRET = 'S3cr3t-Pa$$word-never-in-audit';

function harness(prior: any = null) {
  const audits: { tenantId: string; action: string; actor: any; meta: any }[] = [];
  const svc: any = { recordGatewayAudit: async (tenantId: string, action: string, actor: any, meta?: any) => { audits.push({ tenantId, action, actor, meta }); } };
  let current: any = prior;
  const gateway: any = {
    getBranchMerchant: async () => current,
    upsertBranchMerchant: async (_t: string, branchId: string, body: any) => { current = { id: 'pma_1', branchId, status: 'active', configVersion: (current?.configVersion ?? 0) + 1, merchantIdMasked: '••••1001', ...(body.displayName ? { displayName: body.displayName } : {}) }; return current; },
    setBranchMerchantStatus: async (_t: string, _b: string, to: string) => { current = { ...current, status: to }; return current; },
    testBranchConnection: async () => ({ ok: true, tested: true, detail: 'merchant answered' }),
    rotateWebhookSecret: async () => ({ webhookSecret: 'whsec_' + SECRET, shownOnce: true }),
  };
  const ctl = new SuperAdminTenantsController(svc, gateway);
  const req = { ctx: { userId: 'sa_1' }, ip: '10.0.0.1' };
  return { ctl, audits, req };
}

describe('Super Admin payment merchant audits (§55, §137)', () => {
  it('configuring a branch merchant records payment_merchant_account_configured; credential fields are named, never valued', async () => {
    const { ctl, audits, req } = harness();
    await ctl.setBranchMerchant('ten_a', 'br_cherry', { merchantId: '1001', username: 'u', password: SECRET, displayName: 'Cherry Hill' }, req);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('payment_merchant_account_configured');
    expect(audits[0].meta).toMatchObject({ branchId: 'br_cherry', created: true, merchantAccountId: 'pma_1' });
    expect(audits[0].meta.fields).toContain('password:rotated');
    expect(JSON.stringify(audits)).not.toContain(SECRET);
  });

  it('a change to an existing merchant is recorded as a change (created=false)', async () => {
    const { ctl, audits, req } = harness({ id: 'pma_1', branchId: 'br_cherry', status: 'active', configVersion: 3 });
    await ctl.setBranchMerchant('ten_a', 'br_cherry', { displayName: 'Cherry Hill 2' }, req);
    expect(audits[0].meta).toMatchObject({ created: false });
  });

  it('pausing a branch merchant records the transition from → to', async () => {
    const { ctl, audits, req } = harness({ id: 'pma_1', branchId: 'br_cherry', status: 'active', configVersion: 3 });
    await ctl.branchMerchantStatus('ten_a', 'br_cherry', { action: 'pause' } as any, req);
    expect(audits[0].action).toBe('payment_merchant_account_status_changed');
    expect(audits[0].meta).toMatchObject({ from: 'active', action: 'pause' });
    expect(audits[0].meta.to).not.toBe('active');
  });

  it('a connection test is audited with its outcome', async () => {
    const { ctl, audits, req } = harness({ id: 'pma_1', branchId: 'br_cherry', status: 'active' });
    await ctl.testBranchMerchant('ten_a', 'br_cherry', req);
    expect(audits[0]).toMatchObject({ action: 'payment_merchant_account_tested', meta: { ok: true, tested: true } });
  });

  it('rotating the webhook secret is audited WITHOUT the secret (§99 rotation, §101 logging)', async () => {
    const { ctl, audits, req } = harness();
    await ctl.rotateWebhookSecret('ten_a', req);
    expect(audits[0].action).toBe('payment_gateway_webhook_secret_rotated');
    expect(JSON.stringify(audits)).not.toContain(SECRET);
  });
});
