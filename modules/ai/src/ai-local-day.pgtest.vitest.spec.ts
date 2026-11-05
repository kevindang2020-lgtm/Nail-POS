// ai-local-day.pgtest — the AI Center's and Call Intelligence's "today" is the BRANCH's day (Oct 6 2026). Clock: 9:30 pm
// Monday Oct 5 in New York (01:30 UTC Tuesday). Rows at 10 am and 9 pm today count; 11 pm last night (Monday in UTC) does not.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyCallIntelRepo } from './call-intelligence/call-intelligence.kysely.repository';
import { KyselyAiCenterRepo } from './ai-center/ai-center.kysely.repository';
import { summarize } from './call-intelligence/call-intelligence.dto';

const T = 'e5000000-0000-4000-8000-0000000000a1', B = 'e5000000-0000-4000-8000-0000000000b1';
const NOW = Date.parse('2026-10-06T01:30:00Z');
const AT = ['2026-10-05T14:00:00Z', '2026-10-06T01:00:00Z', '2026-10-05T03:00:00Z'];   // 10 am, 9 pm, 11 pm last night
let db: any;

beforeAll(async () => {
  const pg: any = await migratedPglite(); db = kyselyFor(pg); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'AI Day LLC','AI Day','ai-day','AIDAY1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  let i = 0;
  for (const at of AT) {
    await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, status, ai_handled, started_at) values ($1,$2,$3,'answered_ai',true,$4)`, [T, B, 'call-' + (++i), at]);
    await q(`insert into ai_usage_logs (tenant_id, package_code, status, created_at) values ($1,'receptionist','success',$2)`, [T, at]);
  }
});

describe('the branch\'s day', () => {
  it('Call Intelligence: two AI-answered calls today', async () => {
    const r = new KyselyCallIntelRepo(db); r.now = () => NOW;
    expect((await r.summary({ tenantId: T, branchId: B } as never) as any).aiHandledToday).toBe(2);
  });
  it('the pure summary in UTC would have counted one (so the test can tell)', () => {
    const rows = AT.map((startedAt, k) => ({ id: String(k), startedAt, status: 'answered_ai', outcome: 'no_action', direction: 'inbound' }) as any);
    expect(summarize(rows, new Date(NOW), 'UTC').aiHandledToday).toBe(1);
    expect(summarize(rows, new Date(NOW), 'America/New_York').aiHandledToday).toBe(2);
  });
  it('AI Center: two AI conversations today', async () => {
    const r: any = new KyselyAiCenterRepo(db); r.now = () => NOW;
    expect((await r.load({ tenantId: T, branchId: B })).aiConversationsToday).toBe(2);
  });
});
