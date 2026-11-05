// nail-photo-consent-queries.pgtest — executes the customer photo-consent reads against the real schema.
//
// Consent is the one place in this report where the FAILURE DIRECTION is as important as the failure. Both
// reads here degrade toward "no consent": `activeConsentExists` catches to null and returns false, and
// `listConsentedPhotos` catches to []. That is fail-CLOSED — a broken query hides a photo rather than
// publishing one without permission — and these tests pin that direction so a future refactor cannot quietly
// invert it.
//
// It is still a real bug: a customer whose consent list silently empties is told they have consented to
// nothing, which is the opposite of what the record says.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyNailPhotoConsentRepository } from './nail-photo-consent.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'c1c1c1c1-0000-4000-8000-000000000001';
const B = 'c1c1c1c1-0000-4000-8000-000000000002';
const USER = 'c1c1c1c1-0000-4000-8000-000000000003';
const CUST = 'c1c1c1c1-0000-4000-8000-000000000004';
const GTP = 'c1c1c1c1-0000-4000-8000-000000000005';
const PHOTO = 'c1c1c1c1-0000-4000-8000-000000000006';
const REVOKED_PHOTO = 'c1c1c1c1-0000-4000-8000-000000000007';
const ctx = { tenantId: T, userId: USER } as never;
let repo: KyselyNailPhotoConsentRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Showcase Salon LLC', 'Showcase Salon', 'showcase', 'SHOW1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  repo = new KyselyNailPhotoConsentRepository(kyselyFor(pg) as never);

  // customers.user_id carries a FK to users — the real schema refuses a dangling id, which a fake never would.
  await pg.exec(`
    INSERT INTO users (id, tenant_id, email, role, status)
    VALUES ('${USER}', '${T}', 'ada@example.com', 'CUSTOMER', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name)
    VALUES ('${CUST}', '${T}', '${B}', '${USER}', 'Ada', 'Rowe', 'Ada Rowe');
  `);
  await pg.exec(`
    INSERT INTO tech_portfolio_photos (id, global_tech_profile_id, image_url, caption)
    VALUES ('${PHOTO}', '${GTP}', 'https://cdn.example/a.jpg', 'Almond ombre'),
           ('${REVOKED_PHOTO}', '${GTP}', 'https://cdn.example/b.jpg', 'Withdrawn');
  `);
  await pg.exec(`
    INSERT INTO nail_photo_consent (tenant_id, photo_id, customer_id, global_tech_profile_id, approved_uses, revoked)
    VALUES ('${T}', '${PHOTO}', '${CUST}', '${GTP}', '["portfolio"]'::jsonb, false),
           ('${T}', '${REVOKED_PHOTO}', '${CUST}', '${GTP}', '["portfolio"]'::jsonb, true);
  `);
});

describe('the customer record lookup', () => {
  it('resolves a real customer id from the user id', async () => {
    expect(await repo.resolveCustomerRecordId(ctx)).toBe(CUST);
  });

  it('an unknown user resolves to null, not to someone else', async () => {
    expect(await repo.resolveCustomerRecordId({ tenantId: T, userId: 'd1d1d1d1-0000-4000-8000-000000000009' } as never)).toBeNull();
  });
});

describe('the consented-photo list', () => {
  it('a consented photo comes BACK with its image, joined from tech_portfolio_photos', async () => {
    const list = await repo.listConsentedPhotos(ctx, CUST);
    expect(list.map((p) => p.photoId)).toContain(PHOTO);
    expect(list.find((p) => p.photoId === PHOTO)?.imageUrl).toBe('https://cdn.example/a.jpg');
  });

  it('approved_uses survives the JSONB parse — an empty list would understate the consent', async () => {
    const p = (await repo.listConsentedPhotos(ctx, CUST)).find((x) => x.photoId === PHOTO)!;
    expect(p.approvedUses).toContain('portfolio');
  });

  // The negative case. Without it, a `revoked` filter that does nothing passes every other test here.
  it('a REVOKED consent is excluded — this is the assertion that matters', async () => {
    const list = await repo.listConsentedPhotos(ctx, CUST);
    expect(list.map((p) => p.photoId)).not.toContain(REVOKED_PHOTO);
  });

  it('another tenant sees none of it', async () => {
    const list = await repo.listConsentedPhotos({ tenantId: 'd2d2d2d2-0000-4000-8000-000000000002', userId: USER } as never, CUST);
    expect(list).toHaveLength(0);
  });
});

describe('activeConsentExists fails CLOSED, and that direction is the point', () => {
  it('an active consent is found', async () => {
    expect(await repo.activeConsentExists(PHOTO, CUST, T)).toBe(true);
  });

  it('a revoked consent is NOT active — a photo must not be publishable after withdrawal', async () => {
    expect(await repo.activeConsentExists(REVOKED_PHOTO, CUST, T)).toBe(false);
  });

  it('an unknown photo is not consented', async () => {
    expect(await repo.activeConsentExists('d3d3d3d3-0000-4000-8000-000000000003', CUST, T)).toBe(false);
  });

  it('a wrong tenant does not grant consent', async () => {
    expect(await repo.activeConsentExists(PHOTO, CUST, 'd4d4d4d4-0000-4000-8000-000000000004')).toBe(false);
  });
});
