// rv-extra.mjs — Marketing & Growth → Reviews in the catalog harness (Reviews & Reputation guide, Oct 30 2026, migration 752).
// The REAL ReviewsCenterController → ReviewsCenter → SQL on the seeded TEST database. Tooling only — never shipped. Nothing leaves
// the machine: no reply is published and no message is sent.
// Controls (GET /__rv?…): seed=1 → the photographed baseline (four 5★ star-only reviews for "Vishal verma", Sep 14 + Aug 31 ×3)
// plus the guide's extra cases (a linked customer with a comment and a visit, an anonymous review, a 1★ needing attention, a
// Google review, 24 older 4★ reviews for paging) · state=1 → DB truth by independent SQL · reset=1 → this section's rows removed.
import { ReviewsCenter } from '../../modules/customers/src/reviews/reviews-center.ts';
import { ReviewsCenterController } from '../../modules/customers/src/reviews/reviews-center.controller.ts';

const P = 'e7520000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
export const RV = { vishal: pid(1), lan: pid(2), ava: pid(101), linked: pid(301), anon: pid(302), low: pid(303), google: pid(304), ticket: pid(401), line: pid(402) };

export function rvExtra(db, pg) {
  const rc = new ReviewsCenter(db);
  const ctl = new ReviewsCenterController(rc);
  const q = (s, p = []) => pg.query(s, p);
  return {
    routes: (routesOf) => routesOf('modules/customers/src/reviews/reviews-center.controller.ts', '/pos/reviews-center', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`set session_replication_role = replica`);   // review_moderation_events is append-only by trigger — the harness reset only
        try { await q(`delete from review_moderation_events where tenant_id = $1 and review_id in (select id from reviews where tenant_id = $1 and id::text like 'e7520000-%')`, [T]); }
        finally { await q(`set session_replication_role = origin`); }
        await q(`delete from reviews where tenant_id = $1 and (id::text like 'e7520000-%' or technician_id = any($2::uuid[]))`, [T, [RV.vishal, RV.lan]]);
        await q(`delete from ticket_service_lines where tenant_id = $1 and id = $2`, [T, RV.line]);
        await q(`delete from tickets where tenant_id = $1 and id = $2`, [T, RV.ticket]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$3,$4,'Vishal','verma','Vishal verma'), ($2,$3,$4,'Lan','Tran','Lan Tran') on conflict (id) do nothing`, [RV.vishal, RV.lan, T, B]);
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1,$2,$3,'Rv','Ava','Rv Ava','+16095557301','rv-ava@pilot.test','active') on conflict (id) do nothing`, [RV.ava, T, B]);
        await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, paid_at, ticket_number) values ($1,$2,$3,$4,'paid',4500,'2026-10-01T15:00:00Z','97521') on conflict (id) do nothing`, [RV.ticket, T, B, RV.ava]);
        await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id)
          values ($1,$2,$3,$4,(select id from services where tenant_id = $2 order by created_at, id limit 1),'Gel Manicure',4500,45,4500,$5) on conflict (id) do nothing`, [RV.line, T, B, RV.ticket, RV.lan]);
        const rev = (id, o) => q(`insert into reviews (id, tenant_id, branch_id, rating, comment, technician_id, customer_id, ticket_id, ticket_service_line_id, source, external_review_id, is_public, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12::timestamptz) on conflict (id) do nothing`, [id, T, B, o.rating, o.comment ?? null, o.tech ?? null, o.customer ?? null, o.ticket ?? null, o.line ?? null, o.source ?? 'internal', o.ext ?? null, o.at]);
        // the photographed baseline
        await rev(pid(201), { rating: 5, tech: RV.vishal, at: '2026-09-14T16:00:00Z' });
        await rev(pid(202), { rating: 5, tech: RV.vishal, at: '2026-08-31T15:00:00Z' });
        await rev(pid(203), { rating: 5, tech: RV.vishal, at: '2026-08-31T16:00:00Z' });
        await rev(pid(204), { rating: 5, tech: RV.vishal, at: '2026-08-31T17:00:00Z' });
        // the guide's extra cases
        await rev(RV.linked, { rating: 4, comment: 'Lovely gel, will return', tech: RV.lan, customer: RV.ava, ticket: RV.ticket, line: RV.line, at: '2026-10-02T14:00:00Z' });
        await rev(RV.anon, { rating: 3, comment: 'ok visit', at: '2026-10-03T14:00:00Z' });
        await rev(RV.low, { rating: 1, comment: 'Polish chipped the next day', tech: RV.lan, at: '2026-10-04T14:00:00Z' });
        await rev(RV.google, { rating: 4, comment: 'Nice place', source: 'google', ext: 'accounts/9/locations/9/reviews/rv1', at: '2026-10-05T14:00:00Z' });
        for (let i = 0; i < 24; i++) await rev(pid(500 + i), { rating: 4, tech: RV.lan, comment: i === 0 ? 'needle-oldest' : null, at: new Date(Date.UTC(2026, 5, 1 + i, 12)).toISOString() });
        return { seeded: 32 };
      }
      if (sp.get('state')) {
        // independent of ReviewsCenter: the verified definition written out here
        const r = (await q(`select count(*)::int as total,
            count(*) filter (where rating between 1 and 5 and not coalesce(is_hidden_by_manager,false) and not coalesce(is_spam,false))::int as verified,
            round(avg(rating) filter (where rating between 1 and 5 and not coalesce(is_hidden_by_manager,false) and not coalesce(is_spam,false))::numeric, 1)::float as avg,
            count(*) filter (where coalesce(is_hidden_by_manager,false))::int as hidden,
            count(*) filter (where round(rating) = 1)::int as one_star,
            count(*) filter (where rating <= 2 and not coalesce(is_spam,false) and technician_response is null and response_status not in ('published','responded','no_response_required')
              and coalesce(resolution_status,'open') not in ('resolved','no_action')
              and not exists (select 1 from review_publications p where p.tenant_id = reviews.tenant_id and p.review_id = reviews.id and p.result = 'published'))::int as attention,
            count(*) filter (where created_at >= '2026-08-31T04:00:00Z' and created_at < '2026-09-15T04:00:00Z')::int as window_total,
            count(*) filter (where technician_id = $2 and created_at < '2026-09-15T04:00:00Z' and created_at >= '2026-08-31T04:00:00Z')::int as vishal_window,
            count(*) filter (where technician_id in (select id from technicians where tenant_id = $1 and full_name ilike '%vishal%'))::int as vishal_all
          from reviews where tenant_id = $1 and branch_id = $3`, [T, RV.vishal, B])).rows[0];
        const ev = (await q(`select count(*)::int as n from review_moderation_events where tenant_id = $1 and review_id in (select id from reviews where tenant_id = $1 and id::text like 'e7520000-%')`, [T])).rows[0];
        const low = (await q(`select is_hidden_by_manager as hidden, moderation_version as v from reviews where id = $1`, [RV.low])).rows[0];
        const linked = (await q(`select is_hidden_by_manager as hidden, moderation_version as v, comment from reviews where id = $1`, [RV.linked])).rows[0];
        const audits = (await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action like 'review.%'`, [T])).rows[0];
        return { ...r, events: ev.n, low, linked, audits: audits.n };
      }
      return { error: 'unknown control' };
    },
  };
}
