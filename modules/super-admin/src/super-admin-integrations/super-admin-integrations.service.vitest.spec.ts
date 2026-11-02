import { describe, it, expect } from 'vitest';
import { SuperAdminIntegrationsService } from './super-admin-integrations.service';

describe('SuperAdminIntegrationsService', () => {
  it('reports unavailable when no repo is wired', async () => {
    const s = new SuperAdminIntegrationsService(undefined, undefined);
    expect((await s.overview()).available).toBe(false);
    expect((await s.connectedIntegrations()).available).toBe(false);
    expect((await s.marketplace()).available).toBe(false);
  });

  it('passes reads through and keeps connection/auth/webhook separate', async () => {
    const repo = {
      overview: async () => ({ available: true, kpis: { totalActiveIntegrations: 2, disabledConnections: 2, expiredAuthTokens: 1, healthyConnections: 1, healthyPct: 50, webhookErrors: 2, apiUsageToday: 3, integrationsRequiringAttention: 2, connectedTenants: 1, failedSynchronizations: 2, failedSync24h: 1, successfulSyncs24h: 2 }, syncTrend: [], apiUsageByIntegration: [], statusBreakdown: [], webhookHealth: [] }),
      connectedIntegrations: async () => ([{ key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway', status: 'active', authStatus: 'valid', webhookStatus: 'healthy', tenantsUsing: 3, lastSuccessfulSync: null, failedSyncs: 0, apiUsageToday: 5, errorLogs: 0, modelled: true }]),
      recentWebhookEvents: async () => ([]), authAlerts: async () => ([]), errorLogs: async () => ([]), tenantUsage: async () => ([]), marketplace: () => ([{ key: 'quickbooks', name: 'QuickBooks', category: 'Accounting' }]),
    } as any;
    const s = new SuperAdminIntegrationsService(repo, undefined);
    const ov = await s.overview(); expect(ov.kpis.totalActiveIntegrations).toBe(2);
    const dir = await s.connectedIntegrations(); const f = dir.integrations[0];
    expect(f.status).toBe('active'); expect(f.authStatus).toBe('valid'); expect(f.webhookStatus).toBe('healthy');
  });

  it('disableConnection requires a connection id + reason and maps not_found', async () => {
    const s0 = new SuperAdminIntegrationsService({ setWebhookStatus: async () => null } as any, undefined);
    expect((await s0.disableConnection({}, '', 'r') as any).error).toBe('connection_required');
    expect((await s0.disableConnection({}, 'c1', '') as any).error).toBe('reason_required');
    const nf = await s0.disableConnection({}, 'c1', 'compromised'); expect(nf.ok).toBe(false); expect((nf as any).status).toBe(404);
    const s1 = new SuperAdminIntegrationsService({ setWebhookStatus: async () => ({ ok: true, tenantId: 't1' }) } as any, undefined);
    const ok = await s1.disableConnection({}, 'c1', 'compromised'); expect(ok.ok).toBe(true); expect((ok as any).status).toBe('disabled');
  });

  it('exportReport builds a secret-free CSV of the directory', async () => {
    const repo = { connectedIntegrations: async () => ([{ name: 'Fiserv', category: 'Payment Gateway', status: 'active', tenantsUsing: 3, authStatus: 'valid', lastSuccessfulSync: null, failedSyncs: 0, apiUsageToday: 5, webhookStatus: 'healthy' }]) } as any;
    const s = new SuperAdminIntegrationsService(repo, undefined);
    const csv = await s.exportReport({}, { format: 'csv' });
    expect(csv.ok).toBe(true); expect((csv as any).content).toContain('"Integration"'); expect((csv as any).content).toContain('Fiserv');
    expect((csv as any).content.toLowerCase()).not.toContain('secret'); expect((csv as any).content.toLowerCase()).not.toContain('token');
    const bad = await new SuperAdminIntegrationsService(undefined, undefined).exportReport({}, {}); expect(bad.ok).toBe(false);
  });
});
