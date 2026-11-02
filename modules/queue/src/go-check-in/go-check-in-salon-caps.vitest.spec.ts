// go-check-in-salon-caps.vitest.spec.ts — Security Deep Scan E10: a new kiosk session reset the per-session phone-lookup
// cap, so the public slug alone allowed unlimited phone → name enumeration. Salon-wide 15-minute caps a new session
// cannot reset: start-session and lookups are refused (429 rate_limited) past them; another salon is unaffected.
import { describe, it, expect } from 'vitest';
import { GoCheckInService } from './go-check-in.service';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { MAX_KIOSK_SESSIONS_PER_WINDOW, MAX_KIOSK_LOOKUPS_PER_WINDOW } from './go-check-in.dto';

async function setup(activity: Record<string, { sessions: number; lookups: number }>) {
  const repo: any = new InMemoryGoCheckInRepository();
  repo.recentKioskActivity = async (tenantId: string) => activity[tenantId] ?? { sessions: 0, lookups: 0 };
  const svc = new GoCheckInService(repo, { async technicians() { return []; } } as any);
  await repo.createDevice({ tenantId: 'A', branchId: 'bA', deviceName: 'A', checkinSlug: 'a' }); await repo.upsertSettings('A', { enabled: true });
  await repo.createDevice({ tenantId: 'B', branchId: 'bB', deviceName: 'B', checkinSlug: 'b' }); await repo.upsertSettings('B', { enabled: true });
  return { svc };
}

describe('kiosk salon-wide caps', () => {
  it('start-session is refused once the salon reached the session cap; another salon still works', async () => {
    const { svc } = await setup({ A: { sessions: MAX_KIOSK_SESSIONS_PER_WINDOW, lookups: 0 } });
    await expect(svc.startSession('a')).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    await expect(svc.startSession('b')).resolves.toHaveProperty('sessionId');
  });
  it('a lookup is refused past the salon-wide lookup cap even on a fresh session', async () => {
    const act: any = { A: { sessions: 0, lookups: 0 } };
    const { svc } = await setup(act);
    const s = await svc.startSession('a');
    act.A.lookups = MAX_KIOSK_LOOKUPS_PER_WINDOW + 1;
    await expect(svc.lookupPhone(s.sessionId, s.sessionToken, '(856) 555-1000')).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });
});
