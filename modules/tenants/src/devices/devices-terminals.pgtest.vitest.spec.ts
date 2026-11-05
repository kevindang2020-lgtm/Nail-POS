// devices-terminals.pgtest — w4 sweep SW-07 (Oct 13 2026): POS → Devices listed NO payment terminals.
// The wave-3 live-lease subquery compared payment_terminal_leases.tenant_id (uuid) with pos_payment_terminals.tenant_id
// (text): PostgreSQL refuses `uuid = text`, the repository's .catch(() => []) turned the error into an empty list, and the
// screen (and its "payment terminals" KPI) showed zero terminals for every salon. Found by live-checkout-one-payment
// ("Devices shows the register's name" → undefined) run under live-event-wiring.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDevicesRepository } from './devices.kysely.repository';

const T = 'e7100000-0000-4000-8000-0000000000a1', B = 'e7100000-0000-4000-8000-0000000000b1', ST = 'e7100000-0000-4000-8000-0000000000c1';
let repo: KyselyDevicesRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Devices LLC','Devices','devices-w4','DEVW41','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$2,$3,'Front Desk')`, [ST, T, B]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, station_id) values ('term-1',$1,$2,'Counter reader',$3)`, [T, B, ST]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, station_id) values ('term-2',$1,$2,'Leased reader',null)`, [T, B]);
  await q(`insert into payment_terminal_leases (tenant_id, terminal_id, holder, expires_at) values ($1,'term-2','station-x', now() + interval '5 minutes')`, [T]);
  repo = new KyselyDevicesRepository(kyselyFor(pg) as never);
});

describe('POS → Devices: the payment terminals', () => {
  it('lists every terminal of the branch (the lease lookup no longer fails on uuid = text)', async () => {
    const rows = await repo.terminals({ tenantId: T, branchId: B } as never);
    expect(rows.map((r) => r.id).sort()).toEqual(['term-1', 'term-2']);
  });
  it('names the register a terminal serves, and carries the live lease holder', async () => {
    const rows = await repo.terminals({ tenantId: T, branchId: B } as never);
    expect(rows.find((r) => r.id === 'term-1')?.station).toBe('Front Desk');
    expect((rows.find((r) => r.id === 'term-2') as any)?.leaseHolder).toBe('station-x');
  });
});
