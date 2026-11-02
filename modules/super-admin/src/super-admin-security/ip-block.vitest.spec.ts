import { describe, it, expect, beforeEach } from 'vitest';
import { IpBlockService, IpBlockError } from './ip-block.service';
import { InMemoryIpBlockRepository } from './ip-block.repository';

let repo: InMemoryIpBlockRepository; let svc: IpBlockService;
const actor = { userId: 'admin1', role: 'SUPER_ADMIN', name: 'Admin', ip: '10.0.0.1' };
beforeEach(() => { repo = new InMemoryIpBlockRepository(); svc = new IpBlockService(repo); });

describe('IpBlockService', () => {
  it('blocks a valid public IP with normalized threat type + audit', async () => {
    const r = await svc.createBlock({ target: '203.0.113.45', threatType: 'Brute Force', reason: 'repeated failures' }, actor);
    expect(r.status).toBe('blocked'); expect(r.threatType).toBe('brute_force');
    expect(repo.audits[0]).toMatchObject({ action: 'ip_blocked', target: '203.0.113.45' });
  });

  it('REFUSES to block a loopback/reserved source (never lock out local/health checks)', async () => {
    await expect(svc.createBlock({ target: '127.0.0.1' }, actor)).rejects.toMatchObject({ code: 'protected' });
    await expect(svc.createBlock({ target: '169.254.1.1' }, actor)).rejects.toMatchObject({ code: 'protected' });
    expect(repo.rows).toHaveLength(0);
  });

  it('REFUSES to block an allowlisted address or a protected office/health-check range', async () => {
    await svc.addAllowlist('203.0.113.9', 'monitoring', actor);
    await svc.addAllowlist('10.20.0.0/16', 'office network', actor);
    await expect(svc.createBlock({ target: '203.0.113.9' }, actor)).rejects.toMatchObject({ code: 'protected' });
    await expect(svc.createBlock({ target: '10.20.30.40' }, actor)).rejects.toMatchObject({ code: 'protected' });
  });

  it('rejects invalid IP/CIDR syntax', async () => {
    await expect(svc.createBlock({ target: '999.1.1.1' }, actor)).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.createBlock({ target: '10.0.0.0/40' }, actor)).rejects.toBeInstanceOf(IpBlockError);
  });

  it('is idempotent — re-blocking an active target returns the same rule', async () => {
    const a = await svc.createBlock({ target: '198.51.100.7' }, actor);
    const b = await svc.createBlock({ target: '198.51.100.7' }, actor);
    expect(a.id).toBe(b.id);
    expect(repo.rows.filter((r) => r.target === '198.51.100.7' && !r.isAllowlist)).toHaveLength(1);
  });

  it('preview reports protected status without mutating', async () => {
    const p1 = await svc.preview('203.0.113.45'); expect(p1).toMatchObject({ valid: true, protected: false, wouldBlock: true });
    const p2 = await svc.preview('127.0.0.1'); expect(p2).toMatchObject({ valid: true, protected: true, wouldBlock: false });
    const p3 = await svc.preview('garbage'); expect(p3.valid).toBe(false);
    expect(repo.rows).toHaveLength(0);
  });

  it('unblock transitions a blocked rule to allowed and audits it', async () => {
    const r = await svc.createBlock({ target: '203.0.113.45' }, actor);
    const u = await svc.unblock(r.id, actor);
    expect(u!.status).toBe('allowed');
    expect(repo.audits.find((a) => a.action === 'ip_unblocked')).toBeTruthy();
    await expect(svc.unblock('ghost', actor)).rejects.toMatchObject({ code: 'not_found' });
  });
});
