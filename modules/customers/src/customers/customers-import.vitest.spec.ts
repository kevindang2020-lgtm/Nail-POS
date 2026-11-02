import { describe, it, expect } from 'vitest';
import { InMemoryCustomersRepository, type CustomersContext } from './customers.repository';
import { CustomersService } from './customers.service';
import { parseImportBirthday, parseCustomerCsv, detectCustomerColumns, splitFullName, normalizeImportPhone } from './customers.dto';

const PERMS = ['pos.customers.view', 'pos.customers.create', 'pos.customers.edit', 'pos.customers.import'];
const owner = (over: Partial<CustomersContext> = {}): CustomersContext => ({ tenantId: 't_imp', branchId: 'b1', userId: 'u', role: 'OWNER', permissions: PERMS, ...over });
const svc = () => new CustomersService(new InMemoryCustomersRepository());

describe('birthday parsing', () => {
  it('ISO YYYY-MM-DD passes through', () => expect(parseImportBirthday('1990-03-05')).toBe('1990-03-05'));
  it('US M/D/YYYY reorders', () => expect(parseImportBirthday('3/5/1990')).toBe('1990-03-05'));
  it('2-digit year resolves sensibly', () => { expect(parseImportBirthday('3/5/95')).toBe('1995-03-05'); expect(parseImportBirthday('3/5/05')).toBe('2005-03-05'); });
  it('month/day only → ISO month-day, year unknown (Birthday Campaigns §05)', () => { expect(parseImportBirthday('03/05')).toBe('--03-05'); expect(parseImportBirthday('2/29')).toBe('--02-29'); });
  it('rejects a day the month does not have (02/30, 04/31, 02/29 in a non-leap year)', () => { expect(parseImportBirthday('02/30/1990')).toBeUndefined(); expect(parseImportBirthday('4/31/1990')).toBeUndefined(); expect(parseImportBirthday('2/29/1990')).toBeUndefined(); expect(parseImportBirthday('2/29/1992')).toBe('1992-02-29'); });
  it('a written month still parses, but never rolls over into the next month', () => { expect(parseImportBirthday('Jan 5 1990')).toBe('1990-01-05'); expect(parseImportBirthday('Feb 30 1990')).toBeUndefined(); });
  it('junk → undefined (never fails a row)', () => { expect(parseImportBirthday('not a date')).toBeUndefined(); expect(parseImportBirthday('')).toBeUndefined(); });
  it('rejects impossible dates', () => expect(parseImportBirthday('13/40/1990')).toBeUndefined());
});

describe('csv + column helpers', () => {
  it('parses quoted fields with embedded commas', () => {
    const g = parseCustomerCsv('name,phone\n"Doe, Jane",609-555-1212\n');
    expect(g[1][0]).toBe('Doe, Jane'); expect(g[1][1]).toBe('609-555-1212');
  });
  it('detects varied header spellings', () => {
    const cols = detectCustomerColumns(['First Name', 'Last Name', 'Mobile Phone', 'E-mail', 'DOB']);
    expect(cols.firstName).toBe(0); expect(cols.lastName).toBe(1); expect(cols.phone).toBe(2); expect(cols.email).toBe(3); expect(cols.birthday).toBe(4);
  });
  it('splits a single full-name column', () => expect(splitFullName('Mary Anne Smith')).toEqual({ firstName: 'Mary Anne', lastName: 'Smith' }));
  it('normalizes phones to digits/+', () => expect(normalizeImportPhone('(609) 555-1212')).toBe('6095551212'));
});

describe('import preview + commit', () => {
  const csv = [
    'first name,last name,phone,email,birthday',
    'Alice,Nguyen,609-555-0001,alice@example.com,1990-01-15',
    'Bob,Tran,(609) 555-0002,bob@example.com,2/29/1992',
    'Alice,Nguyen,6095550001,alice2@example.com,1990-01-15', // repeated phone in-file → duplicate
    ',,,,', // empty → dropped by parser (fully blank)
    'NoContact,,,,', // has a name only → valid create
  ].join('\n');

  it('preview classifies create vs duplicate and detects columns, writing nothing', async () => {
    const s = svc();
    const before = (await s.getState(owner())).kpisFull.totalCustomers;
    const p = await s.importPreview(owner(), csv);
    expect(p.detectedColumns.firstName).toBe('mapped');
    expect(p.detectedColumns.birthday).toBe('mapped');
    expect(p.toCreate).toBe(3);        // Alice, Bob, NoContact
    expect(p.duplicates).toBe(1);      // the repeated Alice phone
    const after = (await s.getState(owner())).kpisFull.totalCustomers;
    expect(after).toBe(before);        // dry run wrote nothing
  });

  it('commit inserts only the new rows and reports a summary', async () => {
    const s = svc();
    const before = (await s.getState(owner())).kpisFull.totalCustomers;
    const r = await s.importCommit(owner(), csv);
    expect(r.created).toBe(3);
    expect(r.duplicatesSkipped).toBe(1);
    const after = (await s.getState(owner())).kpisFull.totalCustomers;
    expect(after).toBe(before + 3);
  });

  it('dedups against EXISTING customers (re-running creates nothing new when rows have phone/email)', async () => {
    const s = svc();
    const contactable = [
      'first name,last name,phone,email',
      'Alice,Nguyen,609-555-0001,alice@example.com',
      'Bob,Tran,(609) 555-0002,bob@example.com',
    ].join('\n');
    await s.importCommit(owner(), contactable);
    const mid = (await s.getState(owner())).kpisFull.totalCustomers;
    const r2 = await s.importCommit(owner(), contactable);
    expect(r2.created).toBe(0);                 // everyone already exists (matched on phone/email)
    expect(r2.duplicatesSkipped).toBe(2);
    const after = (await s.getState(owner())).kpisFull.totalCustomers;
    expect(after).toBe(mid);                     // idempotent
  });

  it('a name-only contact (no phone/email) cannot be deduped, so re-import re-creates it', async () => {
    const s = svc();
    const nameOnly = 'name\nWalk In Guest\n';
    await s.importCommit(owner(), nameOnly);
    const r2 = await s.importCommit(owner(), nameOnly);
    expect(r2.created).toBe(1); // nothing to match on → not a duplicate
  });

  it('drops a malformed email but keeps the customer', async () => {
    const s = svc();
    const r = await s.importCommit(owner(), 'name,phone,email\nCarol Lee,609-555-0003,not-an-email\n');
    expect(r.created).toBe(1);
    expect(r.invalidEmailsDropped).toBe(1);
  });

  it('requires a name or phone column', async () => {
    await expect(svc().importPreview(owner(), 'favoritecolor\nblue\n')).rejects.toThrow();
  });
});

describe('import — update existing mode', () => {
  const findByPhone = async (s: CustomersService, ctx: CustomersContext, digits: string) => {
    const items = (await s.list(ctx)).items;
    return items.find((c) => (c.phone || '').replace(/[^\d+]/g, '').endsWith(digits));
  };
  const findByName = async (s: CustomersService, ctx: CustomersContext, name: string) => {
    const items = (await s.list(ctx)).items as any[];
    return items.find((c) => String(c.fullName || c.displayName || '').includes(name));
  };

  it('fills a missing email/birthday on a re-import (does not create a duplicate)', async () => {
    const s = svc(); const ctx = owner();
    await s.importCommit(ctx, 'first name,last name,phone\nDana,Wu,609-555-7001\n'); // phone only, no email/birthday
    const r = await s.importCommit(ctx, 'first name,last name,phone,email,birthday\nDana,Wu,(609) 555-7001,dana@example.com,1992-03-04\n', { updateExisting: true });
    expect(r.created).toBe(0); expect(r.updated).toBe(1); expect(r.duplicatesSkipped).toBe(0);
    const c = await findByPhone(s, ctx, '5557001');
    expect(c?.email).toBe('dana@example.com'); // email was filled
  });

  it('never overwrites a value the customer already has', async () => {
    const s = svc(); const ctx = owner();
    await s.importCommit(ctx, 'first name,last name,phone,email\nEli,Park,609-555-7002,original@example.com\n');
    const r = await s.importCommit(ctx, 'first name,last name,phone,email\nEli,Park,609-555-7002,changed@example.com\n', { updateExisting: true });
    expect(r.updated).toBe(0); expect(r.duplicatesSkipped).toBe(1); // email already present → nothing to fill
    const c = await findByPhone(s, ctx, '5557002');
    expect(c?.email).toBe('original@example.com'); // unchanged
  });

  it('fills a missing phone when the row matches an existing customer by email', async () => {
    const s = svc(); const ctx = owner();
    await s.importCommit(ctx, 'first name,last name,email\nFinn,Yu,finn@example.com\n'); // email only, no phone
    const r = await s.importCommit(ctx, 'first name,last name,phone,email\nFinn,Yu,609-555-7003,finn@example.com\n', { updateExisting: true });
    expect(r.created).toBe(0); expect(r.updated).toBe(1);
    const c = await findByName(s, ctx, 'Finn');
    expect((c?.phone || '').replace(/[^\d+]/g, '')).toContain('5557003'); // phone was filled
  });

  it('will not move an email that already belongs to a different customer', async () => {
    const s = svc(); const ctx = owner();
    await s.importCommit(ctx, 'first name,last name,phone\nGray,Ito,609-555-7004\n');         // A: phone, no email
    await s.importCommit(ctx, 'first name,last name,email\nHana,Cho,shared@example.com\n');    // B: owns the email
    const r = await s.importCommit(ctx, 'first name,last name,phone,email\nGray,Ito,609-555-7004,shared@example.com\n', { updateExisting: true });
    expect(r.updated).toBe(0); expect(r.duplicatesSkipped).toBe(1); // email owned by B → not filled onto A
    const a = await findByPhone(s, ctx, '5557004');
    expect(a?.email || '').toBe(''); // A still has no email
  });

  it('preview reports a toUpdate count, and is unaffected when the flag is off', async () => {
    const s = svc(); const ctx = owner();
    await s.importCommit(ctx, 'first name,last name,phone\nIvy,Lim,609-555-7005\n');
    const csv2 = 'first name,last name,phone,email\nIvy,Lim,609-555-7005,ivy@example.com\n';
    const pOn = await s.importPreview(ctx, csv2, { updateExisting: true });
    expect(pOn.toUpdate).toBe(1); expect(pOn.toCreate).toBe(0);
    const pOff = await s.importPreview(ctx, csv2);
    expect(pOff.toUpdate).toBe(0); expect(pOff.duplicates).toBe(1); // off → still skipped
  });
});
