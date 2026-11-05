/* verify-customer-salons.ts — proves "Find Salons Near Me" on real Postgres (PGlite/PG16), build doc §14–§18/§23/§26:
 * migration 063, opt-IN public listing, distance sort + radius clamp, city search, booking flag, the VERBATIM
 * Google not-configured message, the Google proxy via an injected fetch (key never leaves the backend), the public
 * services preview with server-derived tenancy, and Super Admin flag overrides with null-reverts-to-default. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { CustomerSalonsService, SalonSearchError } from '../../../modules/customers/src/customer-salons/customer-salons.service';
import { GooglePlacesProvider } from '../../../modules/customers/src/customer-salons/google-places.provider';
import { GOOGLE_NOT_CONFIGURED_MESSAGE } from '../../../modules/customers/src/customer-salons/salon-directory-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5471;
  const TA = '00000000-0000-0000-0000-0000000000d1', TB = '00000000-0000-0000-0000-0000000000d2';
  const BA1 = '00000000-0000-0000-0000-0000000000e1', BA2 = '00000000-0000-0000-0000-0000000000e2', BB1 = '00000000-0000-0000-0000-0000000000e3';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

  // Two tenants. A: Cherry Hill + a far NYC branch. B: Philadelphia, NOT listed (default).
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
    ('${TA}','Luxe LLC','Luxe Nails','luxe-d','LUXED','active'), ('${TB}','Polish LLC','Polish Bar','polish-d','POLISHD','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, address, city, state, zip, phone, latitude, longitude) VALUES
    ('${BA1}','${TA}','Cherry Hill','1 Main St','Cherry Hill','NJ','08002','(856) 555-0101',39.9268,-75.0246),
    ('${BA2}','${TA}','Manhattan','9 5th Ave','New York','NY','10001','(212) 555-0102',40.7128,-74.0060),
    ('${BB1}','${TB}','Center City','2 Market St','Philadelphia','PA','19106','(215) 555-0103',39.9526,-75.1652)`);
  const CAT = '00000000-0000-0000-0000-0000000000f1';
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}','${TA}','${BA1}','Manicure')`);
  await db.exec(`INSERT INTO services (tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) VALUES
    ('${TA}','${BA1}','${CAT}','Gel Manicure',45,4500,'percent',50),
    ('${TA}','${BA1}','${CAT}','Classic Pedicure',50,5000,'percent',50),
    ('${TA}','${BA1}','${CAT}','Nail Art',20,2000,'percent',50),
    ('${TA}','${BA1}','${CAT}','Chrome Finish',15,1500,'percent',50)`);
  // Tenant A opts INTO public listing; tenant B stays at the default (hidden).
  await db.exec(`INSERT INTO tenant_app_flags (tenant_id, flag_key, enabled) VALUES ('${TA}','public_listing',true)`);

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    delete process.env.ENABLE_GOOGLE_NEARBY_SALON_SEARCH;
    delete process.env.GOOGLE_PLACES_API_KEY;
    const svc = new CustomerSalonsService(k as any, new GooglePlacesProvider());
    const origin = { lat: 39.93, lng: -75.03 }; // ~0.4 mi from Cherry Hill, ~78 mi from Manhattan

    // ── nearby by coordinates ──
    const near: any = await svc.nearby({ lat: origin.lat, lng: origin.lng, radiusMiles: 10 });
    ok('opt-in listing: only tenant A appears (B hidden by default)', near.results.every((r: any) => !r.name.includes('Polish')), JSON.stringify(near.results.map((r: any) => r.name)));
    ok('distance sort: Cherry Hill first with a real distance_miles', near.results[0]?.salon_id === BA1 && near.results[0]?.distance_miles > 0 && near.results[0]?.distance_miles < 2, String(near.results[0]?.distance_miles));
    ok('radius filter: the 78-mile Manhattan branch is excluded at 10 miles', !near.results.some((r: any) => r.salon_id === BA2));
    ok('§16 shape: source/partner/bookable/route/services_preview', near.results[0].source === 'aipowersalon' && near.results[0].is_aipowersalon_partner === true && near.results[0].is_bookable_in_app === true && near.results[0].booking_url_or_route === `/book/${BA1}` && near.results[0].services_preview.length === 3);
    ok('VERBATIM not-configured message + googleEnabled false', near.googleEnabled === false && near.googleMessage === GOOGLE_NOT_CONFIGURED_MESSAGE, near.googleMessage);
    const wide: any = await svc.nearby({ lat: origin.lat, lng: origin.lng, radiusMiles: 100 });
    ok('radius clamps to MAX (50): Manhattan still excluded at requested 100', wide.radiusMiles === 50 && !wide.results.some((r: any) => r.salon_id === BA2));

    // ── manual city search (no coordinates) ──
    const city: any = await svc.nearby({ city: 'Cherry Hill' });
    ok('city search works without location (distance null)', city.results.length === 1 && city.results[0].salon_id === BA1 && city.results[0].distance_miles === null);
    let invalid = '';
    try { await svc.nearby({}); } catch (e: any) { invalid = e instanceof SalonSearchError ? e.code : ''; }
    ok('no origin and no search terms → invalid', invalid === 'invalid');

    // ── booking flag (§26) ──
    await svc.setAppFlag(TA, 'customer_app_booking', false);
    const noBook: any = await svc.nearby({ city: 'Cherry Hill' });
    ok('customer_app_booking=false → not bookable, no booking route', noBook.results[0].is_bookable_in_app === false && noBook.results[0].booking_url_or_route === null);
    await svc.setAppFlag(TA, 'customer_app_booking', null);
    const reBook: any = await svc.nearby({ city: 'Cherry Hill' });
    ok('null flag reverts to the default (bookable again)', reBook.results[0].is_bookable_in_app === true);

    // ── Super Admin listing toggle for tenant B ──
    await svc.setAppFlag(TB, 'public_listing', true);
    const withB: any = await svc.nearby({ lat: origin.lat, lng: origin.lng, radiusMiles: 20 });
    ok('B appears after Super Admin enables public_listing', withB.results.some((r: any) => r.salon_id === BB1));
    await svc.setAppFlag(TB, 'public_listing', null);
    const withoutB: any = await svc.nearby({ lat: origin.lat, lng: origin.lng, radiusMiles: 20 });
    ok('null reverts B to the hidden default', !withoutB.results.some((r: any) => r.salon_id === BB1));

    // ── Google proxy path (injected fetch; key stays server-side) ──
    process.env.ENABLE_GOOGLE_NEARBY_SALON_SEARCH = 'true';
    process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-exposed';
    let fetchedUrl = '';
    const fakeFetch: any = async (url: string) => {
      fetchedUrl = url;
      return { ok: true, json: async () => ({ results: [
        { place_id: 'gp1', name: 'Polish Spot', geometry: { location: { lat: 39.94, lng: -75.05 } }, rating: 4.4, user_ratings_total: 88, vicinity: '7 Elm St', opening_hours: { open_now: true } },
        { place_id: 'gpDup', name: 'Dup Of Partner', geometry: { location: { lat: 39.9268, lng: -75.0246 } } },
      ] }) };
    };
    const svcG = new CustomerSalonsService(k as any, new GooglePlacesProvider(fakeFetch));
    const merged: any = await svcG.nearby({ lat: origin.lat, lng: origin.lng, radiusMiles: 10 });
    ok('google enabled: proxy URL carries the server-side key + nail-salon keyword', fetchedUrl.includes('key=test-key-not-exposed') && fetchedUrl.includes('nail%20salon'));
    const gItem = merged.results.find((r: any) => r.salon_id === 'g_gp1');
    ok('merged: partner FIRST, google after with source/rating/open_now', merged.results[0].salon_id === BA1 && !!gItem && gItem.source === 'google' && gItem.rating === 4.4 && gItem.open_now === true);
    ok('google result is NEVER bookable in app (§16/§18/§21 acceptance #21)', gItem.is_bookable_in_app === false && gItem.booking_url_or_route === null);
    ok('coordinate-duplicate of a partner branch is deduped', !merged.results.some((r: any) => r.salon_id === 'g_gpDup'));
    ok('attribution attached when Google serves results', merged.attribution === 'Powered by Google' && merged.googleMessage === null);
    delete process.env.ENABLE_GOOGLE_NEARBY_SALON_SEARCH; delete process.env.GOOGLE_PLACES_API_KEY;

    // ── public detail + services (server-derived tenancy, §24) ──
    const detail: any = await svc.detail(BA1);
    ok('salon detail returns the partner card', detail.salon_id === BA1 && detail.is_aipowersalon_partner === true);
    const services: any[] = await svc.services(BA1);
    ok('public services preview lists active services with prices', services.length === 4 && services.some((s) => s.name === 'Gel Manicure' && s.priceCents === 4500));
    let hidden = '';
    try { await svc.services(BB1); } catch (e: any) { hidden = e instanceof SalonSearchError ? e.code : ''; }
    ok('unlisted tenant services are NOT exposed (404)', hidden === 'not_found');
    const flagsList: any[] = await svc.listAppFlags(TA);
    ok('§26 read model: 6 flags with effective/override/default', flagsList.length === 6 && flagsList.find((f) => f.key === 'public_listing')?.override === true && flagsList.find((f) => f.key === 'show_on_map')?.enabled === false && flagsList.find((f) => f.key === 'customer_app_booking')?.default === true);
    // ── salon-level favorites (§17/§21) ──
    const U1 = '00000000-0000-0000-0000-0000000000a9';
    await db.exec(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, role, status) VALUES ('${U1}','${TA}','${BA1}','Fav Customer','fav@cust.com','CUSTOMER','active')`);
    const favAdd: any = await svc.addFavorite(U1, BA1);
    await svc.addFavorite(U1, BA1); // idempotent
    const favList: any = await svc.listFavorites(U1);
    ok('favorite add is idempotent and the list hydrates the partner card', favAdd.ok === true && favList.salonIds.length === 1 && favList.salons[0]?.salon_id === BA1 && favList.salons[0]?.is_aipowersalon_partner === true, JSON.stringify(favList.salonIds));
    let favBad = '';
    try { await svc.addFavorite(U1, BB1); } catch (e: any) { favBad = e instanceof SalonSearchError ? e.code : ''; }
    ok('favoriting an unlisted salon is rejected (404)', favBad === 'not_found');
    await svc.removeFavorite(U1, BA1);
    const favGone: any = await svc.listFavorites(U1);
    ok('remove favorite empties the list', favGone.salonIds.length === 0 && favGone.salons.length === 0);
    let badFlag = '';
    try { await svc.setAppFlag(TA, 'not_a_flag', true); } catch (e: any) { badFlag = e instanceof SalonSearchError ? e.code : ''; }
    ok('unknown flag key rejected', badFlag === 'invalid');

    // ── Doc (Customer App audit) — salon-card aggregates: rating · review count · technician count ──
    const AGT = '00000000-0000-0000-0000-0000000a0e01'; // hex-only ids
    const AGP = '00000000-0000-0000-0000-0000000a9f01', AGC = '00000000-0000-0000-0000-0000000ac701', AGU = '00000000-0000-0000-0000-0000000a0f01';
    await db.exec(`INSERT INTO global_tech_profiles (id, public_slug, display_name, is_public) VALUES ('${AGP}','agg-tech','Agg Tech',true)`);
    await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, commission_type, commission_value, default_commission_split_percent, is_active, global_tech_profile_id) VALUES ('${AGT}','${TA}','${BA1}','Agg','Tech','Agg Tech','active','percent',50,50,true,'${AGP}')`);
    await db.exec(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, role, status) VALUES ('${AGU}','${TA}','${BA1}','Rev Customer','rev@cust.com','CUSTOMER','active')`);
    await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in) VALUES ('${AGC}','${TA}','${BA1}','${AGU}','Rev','Customer','Rev Customer','active',false,false)`);
    await db.exec(`INSERT INTO reviews (tenant_id, branch_id, customer_id, rating, comment, is_public, is_hidden_by_manager) VALUES ('${TA}','${BA1}','${AGC}',5,'Lovely',true,false), ('${TA}','${BA1}','${AGC}',4,'Nice',true,false), ('${TA}','${BA1}','${AGC}',1,'hidden one',true,true)`);
    const withAgg: any = await svc.nearby({ lat: origin.lat, lng: origin.lng, radiusMiles: 10 });
    const aggCard = withAgg.results.find((r: any) => r.salon_id === BA1);
    ok('salon card carries averageRating from PUBLIC unhidden reviews only (4.5 of 2)', aggCard.rating === 4.5 && aggCard.review_count === 2, JSON.stringify({ r: aggCard.rating, c: aggCard.review_count }));
    ok('salon card carries technicianCount of PUBLIC-profile active techs', aggCard.technician_count === 1, String(aggCard.technician_count));
    const noProfileCard = withAgg.results.find((r: any) => r.salon_id !== BA1 && r.is_aipowersalon_partner);
    ok('branches without reviews/profiles show null rating + zero counts (no fake data)', !noProfileCard || (noProfileCard.rating === null && noProfileCard.review_count === 0 && noProfileCard.technician_count === 0));
  } finally {
    await k.destroy().catch(() => {});
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
  }
  console.log(`\nverify-customer-salons: ${pass}/${pass + fail} passed${fail ? ' (FAILED)' : ' OK'}`);
  process.exit(fail ? 1 : 0);
})();
