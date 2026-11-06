// customer-directory-search-fold.pgtest.vitest.spec.ts — F1 §79 (Nov 6 2026): customers.search_fold / search_digits
// (migration 822) are kept by a trigger and equal the fold the directory computed at query time before. If they ever
// drift, a customer stops being found — so the equality is checked on insert, on every searched column's update, and
// for rows the backfill touched.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

const T = 'f1e5ca1e-0000-4000-8000-0000000000f0', B = 'f1e5ca1e-0000-4000-8000-0000000000f1';
const QUERY_TIME_FOLD = `vi_fold(concat_ws(chr(1), coalesce(first_name, '') || ' ' || coalesce(last_name, ''), first_name, last_name, preferred_name,
  coalesce(nullif(phone_display, ''), nullif(normalized_phone, ''), ''), email))`;
const QUERY_TIME_DIGITS = `regexp_replace(coalesce(nullif(phone_display, ''), nullif(normalized_phone, ''), ''), '\\D', '', 'g') || chr(1)
  || regexp_replace(coalesce(normalized_phone, ''), '\\D', '', 'g')`;
let pg: any;
const drift = async () => (await pg.query(`select id, first_name from customers where tenant_id = $1
  and (search_fold is distinct from ${QUERY_TIME_FOLD} or search_digits is distinct from ${QUERY_TIME_DIGITS})`, [T])).rows;

describe('customers.search_fold (migration 822)', () => {
  beforeAll(async () => {
    pg = await migratedPglite();
    await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Fold LLC','Fold','cust-fold','CSF001','active')`, [T]);
    await pg.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
    await pg.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, preferred_name, phone_display, normalized_phone, email) values
      ($1,$2,'Đặng','Nguyễn Thị','Đặng Nguyễn Thị','Bé','(215) 555-0101','+12155550101','Dang@Example.test'),
      ($1,$2,'Ann','','Ann',null,null,'+12155550102',null),
      ($1,$2,'','Lê',' Lê',null,'',null,'le@example.test'),
      ($1,$2,'Mary  Jo','O''Neil','Mary Jo O''Neil','  MJ ','215.555.0104','+12155550104','mj@example.test'),
      ($1,$2,'Nguyễn','Trần','Nguyễn Trần',null,null,null,null)`, [T, B]);
  });

  it('every inserted row carries the same fold the directory computed at query time', async () => {
    expect(await drift()).toEqual([]);
    const r = (await pg.query(`select search_fold, search_digits from customers where tenant_id = $1 and first_name = 'Đặng'`, [T])).rows[0];
    expect(r.search_fold).toContain('dang nguyen thi');   // accents folded, lower-cased
    expect(r.search_digits).toBe('2155550101' + String.fromCharCode(1) + '12155550101');
  });

  it('follows an update of every searched column', async () => {
    for (const [col, val] of [['first_name', 'Huỳnh'], ['last_name', 'Phạm'], ['preferred_name', 'Bông'], ['phone_display', '(267) 555-0199'],
      ['normalized_phone', '+12675550199'], ['email', 'NEW@EXAMPLE.TEST']] as const) {
      await pg.query(`update customers set ${col} = $2 where tenant_id = $1 and first_name in ('Đặng', 'Huỳnh')`, [T, val]);
      expect(await drift()).toEqual([]);
    }
    const r = (await pg.query(`select search_fold from customers where tenant_id = $1 and first_name = 'Huỳnh'`, [T])).rows[0];
    expect(r.search_fold).toContain('huynh pham');
    expect(r.search_fold).toContain('bong');
  });

  it('an update that does not touch a searched column leaves it alone; a cleared column folds to the same as at query time', async () => {
    await pg.query(`update customers set notes = 'x' where tenant_id = $1`, [T]);
    await pg.query(`update customers set email = null, phone_display = null where tenant_id = $1 and first_name = 'Ann'`, [T]);
    expect(await drift()).toEqual([]);
  });

  it('the backfill expression (rows written before 822) gives the same value', async () => {
    await pg.query(`alter table customers disable trigger trg_customers_search_fold`);
    await pg.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,'Trịnh','Võ','Trịnh Võ','+12155550111')`, [T, B]);
    await pg.query(`alter table customers enable trigger trg_customers_search_fold`);
    expect((await drift()).map((x: any) => x.first_name)).toEqual(['Trịnh']);
    await pg.query(`update customers set search_fold = customer_search_fold(first_name, last_name, preferred_name, phone_display, normalized_phone, email),
      search_digits = customer_search_digits(phone_display, normalized_phone) where search_fold is null or search_digits is null`);
    expect(await drift()).toEqual([]);
  });
});
