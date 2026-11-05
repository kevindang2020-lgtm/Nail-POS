// audit-fields.pgtest — BUILD_PLAN Phase 10 (Constitution 1 §32–§33) on the real schema: an audit_events row says what
// changed (before / after, redacted like metadata), why (reason), and which request, workflow and session it came from —
// filled by AuditService.record from the request context when the caller does not pass them (migration 541).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { runWithContext } from '@aipowersalon/observability';
import { KyselyAuditRepository } from './audit.kysely.repository';
import { AuditService } from './audit.service';

const TENANT = '6f1c2b1e-4d2a-4c3b-9a8e-1f2d3c4b5a61', USER = '6f1c2b1e-4d2a-4c3b-9a8e-1f2d3c4b5a62';
let db: any; let svc: AuditService;
beforeAll(async () => { db = kyselyFor(await migratedPglite()); svc = new AuditService(new KyselyAuditRepository(db)); }, 120_000);
const stored = (action: string) => db.selectFrom('audit_events').selectAll().where('action', '=', action).executeTakeFirst();

describe('audit_events carries the change and where it came from', () => {
  it('inside a request: request / correlation / session ids from the context; before, after and reason from the caller', async () => {
    const tele = { requestId: 'req_01JTESTREQUEST0000000000', correlationId: 'corr_booking_42', traceId: 't', service: 'api' as const, sessionId: 'sess-abc' };
    const row = await runWithContext(tele, () => svc.record({ tenantId: TENANT, userId: USER, role: 'OWNER' }, {
      module: 'customers', action: 'loyalty.adjusted', resourceType: 'customer', resourceId: 'c-1',
      before: { points: 10, card: { password: 'hunter2' } }, after: { points: 70 }, reason: '  migrated from paper card  ',
    }));
    expect(row).toMatchObject({ requestId: tele.requestId, correlationId: 'corr_booking_42', sessionId: 'sess-abc', reason: 'migrated from paper card' });
    const r = await stored('loyalty.adjusted');
    expect(r).toMatchObject({ request_id: tele.requestId, correlation_id: 'corr_booking_42', session_id: 'sess-abc', reason: 'migrated from paper card' });
    expect(r.before_state).toEqual({ points: 10, card: { password: '[redacted]' } });      // the same redaction as metadata
    expect(r.after_state).toEqual({ points: 70 });
  });

  it('the caller\'s own ids win over the context; outside a request the row is still written, with nulls', async () => {
    await runWithContext({ requestId: 'req_ctx', correlationId: 'corr_ctx', traceId: 't', service: 'api' }, () =>
      svc.record({ tenantId: TENANT, userId: USER, correlationId: 'corr_explicit' }, { module: 'm', action: 'explicit.ids' }));
    expect(await stored('explicit.ids')).toMatchObject({ request_id: 'req_ctx', correlation_id: 'corr_explicit', session_id: null });
    await svc.record({ tenantId: TENANT, userId: USER }, { module: 'm', action: 'no.context', after: 5 });
    expect(await stored('no.context')).toMatchObject({ request_id: null, correlation_id: null, before_state: null, after_state: { value: 5 }, reason: null });
  });
});
