// bd-extra.mjs — Marketing & Growth → Birthday Campaigns in the catalog harness (Birthday Campaigns guide, Oct 31 2026,
// migration 750). The REAL BirthdayCenterController → BirthdayCenter → SQL on the seeded TEST database. Tooling only — never
// shipped. Nothing leaves the machine: the assistant only saves an UNSENT audience + a Campaign Center DRAFT.
// Controls (GET /__bd?…): seed=1 → the guide's cases (current-month birthdays in several birth years, a month/day-only
// birthday, an opted-out and a no-consent customer, Feb 29, Dec 31 / Jan 2, one birthday two days from today, two with no
// birthday, 12 more this month for paging) · state=1 → DB truth by independent SQL · reset=1 → this section's rows removed.
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { SegmentsRepository } from '../../modules/customers/src/segments/segments.repository.ts';
import { CampaignCenter } from '../../modules/communications/src/campaigns/campaign-center.ts';
import { BirthdayCenter } from '../../modules/reports/src/birthdays/birthday-center.ts';
import { BirthdayCenterController } from '../../modules/reports/src/birthdays/birthday-center.controller.ts';

const P = 'e7500000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
const C = { ava: pid(101), ben: pid(102), cat: pid(103), eve: pid(104), leap: pid(105), dee: pid(106), jan: pid(107), soon: pid(108), nora: pid(109), ned: pid(110) };
const EXTRA = Array.from({ length: 12 }, (_, i) => pid(200 + i));
export const BD = { ...C };

export function bdExtra(db, pg) {
  const ret = new RetentionRepository(db);
  const center = new BirthdayCenter(db, ret, new SegmentsRepository(db, ret), new CampaignCenter(db, async () => { throw new Error('the harness never launches'); }));
  const ctl = new BirthdayCenterController(center);
  const q = (s, p = []) => pg.query(s, p);
  const ids = [...Object.values(C), ...EXTRA];
  return {
    routes: (routesOf) => routesOf('modules/reports/src/birthdays/birthday-center.controller.ts', '/pos/birthdays', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from birthday_message_claims where tenant_id = $1`, [T]);
        await q(`delete from tenant_birthday_settings where tenant_id = $1`, [T]);
        await q(`delete from campaign_recipients where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from segment_audience_members where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from notification_opt_outs where tenant_id = $1 and address like '+1609555780%'`, [T]);
        await q(`delete from customers where tenant_id = $1 and id = any($2::uuid[])`, [T, ids]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const tz = (await q(`select coalesce(timezone, 'America/New_York') as tz from branches where id = $1`, [B])).rows[0]?.tz ?? 'America/New_York';
        const today = (await q(`select (now() at time zone $1)::date::text as d`, [tz])).rows[0].d;
        const mm = today.slice(5, 7);
        const cust = (cid, name, birthday, o = {}) => q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in,
            birthday, birthday_year_known, status, created_at) values ($1,$2,$3,split_part($4,' ',1),split_part($4,' ',2),$4,$5,$6,$7,$8,$9::date,$10,'active', now() - make_interval(days => $11)) on conflict (id) do nothing`,
          [cid, T, B, name, o.phone ?? null, o.email ?? null, o.sms ?? true, !!o.email, birthday, o.yearKnown ?? true, o.age ?? 100]);
        // this month's birthdays: three birth years, a month/day-only one; day 15 / 01 / 05 always exist
        await cust(C.ava, 'Bd Ava', `1990-${mm}-15`, { phone: '+16095578001', email: 'bd-ava@pilot.test' });
        await cust(C.ben, 'Bd Ben', `1975-${mm}-01`, { phone: '+16095578002' });
        await cust(C.cat, 'Bd Cat', `2001-${mm}-05`, { phone: '+16095578003', sms: false });
        await cust(C.eve, 'Bd Eve', `2000-${mm}-12`, { phone: '+16095578004', yearKnown: false });
        await cust(C.leap, 'Bd Leap', '1992-02-29', { phone: '+16095578005' });
        await cust(C.dee, 'Bd Dee', '1980-12-31', { phone: '+16095578006' });
        await cust(C.jan, 'Bd Jan', '1980-01-02', { phone: '+16095578007' });
        // two days from today, in a real past birth year (Feb 29 never lands here: a non-leap stand-in is used)
        const soon = (await q(`select to_char((now() at time zone $1)::date + 2, 'MM-DD') as md`, [tz])).rows[0].md;
        await cust(C.soon, 'Bd Soon', `1988-${soon === '02-29' ? '02-28' : soon}`, { phone: '+16095578008' });
        await cust(C.nora, 'Bd Nora', null, { phone: '+16095578009', age: 3 });
        await cust(C.ned, 'Bd Ned', null, { phone: '+16095578010', age: 2 });
        for (let i = 0; i < EXTRA.length; i++) await cust(EXTRA[i], `Bd X${String(i).padStart(2, '0')}`, `199${i % 10}-${mm}-${String((i % 27) + 1).padStart(2, '0')}`, { phone: '+160955781' + String(i).padStart(2, '0') });
        await q(`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values ($1,'sms','+16095578002','stop','all') on conflict do nothing`, [T]);
        return { seeded: ids.length, month: mm };
      }
      if (sp.get('state')) {
        const tz = (await q(`select coalesce(timezone, 'America/New_York') as tz from branches where id = $1`, [B])).rows[0]?.tz ?? 'America/New_York';
        const pol = (await q(`select feb29_policy from tenant_birthday_settings where tenant_id = $1`, [T])).rows[0]?.feb29_policy ?? 'feb28';
        // independent of the repository: month/day straight from the DATE, the salon's today, a 7-day window by generate_series
        const r = (await q(`with d as (select (now() at time zone $2)::date as today),
              cc as (select c.* from customers c where c.tenant_id = $1 and c.archived_at is null and c.status <> 'archived' and (c.branch_id = $3 or c.branch_id is null))
            select (select count(*) from cc, d where cc.birthday is not null and extract(month from cc.birthday) = extract(month from d.today))::int as this_month,
                   (select count(*) from cc, d where cc.birthday is not null and to_char(cc.birthday, 'MM-DD') in (select to_char(g, 'MM-DD') from generate_series(d.today, d.today + 6, interval '1 day') g))::int as next7,
                   (select count(*) from cc where cc.birthday is null)::int as missing,
                   (select count(*) from cc)::int as total`, [T, tz, B])).rows[0];
        const other = (await q(`select (select count(*)::int from notifications where tenant_id = $1) as notifications,
            (select count(*)::int from birthday_message_claims where tenant_id = $1) as claims,
            (select count(*)::int from campaigns where tenant_id = $1 and status = 'draft' and occasion = 'birthday') as birthday_drafts,
            (select row_to_json(x) from (select to_char(birthday, 'YYYY-MM-DD') as birthday, birthday_year_known as year_known, birthday_source as source from customers where id = $2) x) as nora`, [T, C.nora])).rows[0];
        return { policy: pol, thisMonth: r.this_month, next7: r.next7, missing: r.missing, total: r.total, ...other };
      }
      return { error: 'unknown control' };
    },
  };
}
