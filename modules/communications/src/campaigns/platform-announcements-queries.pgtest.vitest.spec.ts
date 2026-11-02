// platform-announcements-queries.pgtest — executes the platform announcement reads against the real schema.
//
// 15 queries with three swallowing catches. Two distinct quiet failures here:
//   • `list`/`listForOversight` returning [] reads as "no announcements" — a Super Admin sees an empty
//     oversight board and concludes nothing is in flight, including anything currently SENDING;
//   • the per-announcement counters (sent/open/click/booking/revenue) are read with `Number(x || 0)`, so a
//     renamed column silently becomes 0 — a campaign that reached 4,000 salons reports zero engagement, which
//     reads as a bad campaign rather than a broken query.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyAnnouncementRepo } from './platform-announcements.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'c9c9c9c9-0000-4000-8000-000000000001';
const A_SENT = 'c9c9c9c9-0000-4000-8000-00000000000a';
const A_DRAFT = 'c9c9c9c9-0000-4000-8000-00000000000b';
let repo: KyselyAnnouncementRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Announce Salon LLC', 'Announce Salon', 'announce', 'ANNC1', 'active') ON CONFLICT DO NOTHING;
  `);
  repo = new KyselyAnnouncementRepo(kyselyFor(pg) as never);

  // Non-zero, DISTINCT counters: if two columns were cross-wired, equal values would hide it.
  await pg.exec(`
    INSERT INTO platform_announcements
      (id, title, channel, audience_scope, status, audience_size, sent_count, open_count, click_count, booking_count, revenue_cents)
    VALUES ('${A_SENT}', 'August maintenance window', 'email', 'all_tenants', 'sent', 4000, 3900, 1200, 340, 27, 915000),
           ('${A_DRAFT}', 'Draft notice', 'email', 'selected_tenants', 'draft', 0, 0, 0, 0, 0, 0);
  `);
  await pg.exec(`
    INSERT INTO platform_announcement_targets (announcement_id, tenant_id) VALUES ('${A_DRAFT}', '${T}');
  `);
});

describe('the announcement list', () => {
  it('a sent announcement is LISTED — an empty board reads as "nothing in flight"', async () => {
    const r = await repo.list({});
    expect(r.map((a) => a.id)).toContain(A_SENT);
  });

  it('filtering by status finds the draft', async () => {
    expect((await repo.list({ status: 'draft' })).map((a) => a.id)).toContain(A_DRAFT);
  });

  // The negative. Without it, a status filter that ignores its argument passes everything above.
  it('filtering by status EXCLUDES the sent one', async () => {
    expect((await repo.list({ status: 'draft' })).map((a) => a.id)).not.toContain(A_SENT);
  });

  it('get() returns the row, not null', async () => {
    expect(await repo.get(A_SENT)).not.toBeNull();
  });

  it('an unknown id returns null rather than someone else’s announcement', async () => {
    expect(await repo.get('c9c9c9c9-0000-4000-8000-0000000000ff')).toBeNull();
  });
});

describe('the oversight counters — zero engagement reads as a bad campaign, not a broken query', () => {
  it('the announcement appears on the oversight board', async () => {
    const r = await repo.listForOversight();
    expect(r.map((x) => x.id)).toContain(A_SENT);
  });

  it('every counter survives the read, and none is cross-wired with another', async () => {
    const x = (await repo.listForOversight()).find((a) => a.id === A_SENT)!;
    expect(x.audienceSize).toBe(4000);
    expect(x.sentCount).toBe(3900);
    expect(x.openCount).toBe(1200);
    expect(x.clickCount).toBe(340);
    expect(x.bookingCount).toBe(27);
    expect(x.revenueCents).toBe(915000);
  });

  it('the title is carried as the display name', async () => {
    const x = (await repo.listForOversight()).find((a) => a.id === A_SENT)!;
    expect(x.name).toBe('August maintenance window');
    expect(x.ownerType).toBe('platform');
  });
});

describe('status transitions', () => {
  it('setStatus writes, and the new status comes BACK on re-read', async () => {
    await repo.setStatus(A_DRAFT, 'scheduled' as never);
    expect((await repo.get(A_DRAFT))!.status).toBe('scheduled');
  });
});
