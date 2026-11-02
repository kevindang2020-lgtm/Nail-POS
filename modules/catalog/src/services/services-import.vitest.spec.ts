import { describe, it, expect } from 'vitest';
import { InMemoryServicesRepository, type ServicesContext } from './services.repository';
import { ServicesService } from './services.service';
import { parsePriceCents, parseCsv } from './services.dto';

const PERMS = ['pos.services.view', 'pos.services.create', 'pos.services.edit', 'pos.services.import', 'pos.services.export', 'pos.services.archive'];
const ctx: ServicesContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS };
const mk = () => new ServicesService(new InMemoryServicesRepository());

describe('price + CSV parsing helpers', () => {
  it('parses prices as dollars ($, decimal, or plain integer all mean dollars)', () => {
    expect(parsePriceCents('60.00')).toBe(6000);
    expect(parsePriceCents('$60')).toBe(6000);
    expect(parsePriceCents('1,250.50')).toBe(125050);
    expect(parsePriceCents('80')).toBe(8000);   // plain integer = dollars (no cents footgun)
    expect(parsePriceCents('abc')).toBeNull();
    expect(parsePriceCents('')).toBeNull();
  });
  it('parses quoted CSV fields with embedded commas', () => {
    const t = parseCsv('Name,Price\n"Mani, Deluxe",60.00\n');
    expect(t[1][0]).toBe('Mani, Deluxe');
    expect(t[1][1]).toBe('60.00');
  });
});

describe('services CSV import — preview (read-only)', () => {
  it('classifies create / update / error and resolves categories without writing', async () => {
    const svc = mk();
    const cats = await svc.listCategories(ctx);
    const existingCat = cats[0].name;
    const existingSvc = (await svc.list(ctx)).items[0].serviceName;
    const before = (await svc.list(ctx)).items.length;

    const csv = [
      'Name,Category,Price,Duration,Status',
      `New Gel Mani,${existingCat},45.00,40,active`,          // create (existing category)
      `Brand New Service,Sparkle Lab,75,50,active`,           // create (new category "Sparkle Lab")
      `${existingSvc},${existingCat},99.00,30,active`,        // update (matches existing service by name)
      `Bad Row,${existingCat},notaprice,30,active`,           // error (bad price)
    ].join('\n');

    const p = await svc.importPreview(ctx, csv);
    expect(p.ok).toBe(true);
    expect(p.totalRows).toBe(4);
    expect(p.willCreate).toBe(2);
    expect(p.willUpdate).toBe(1);
    expect(p.errorCount).toBe(1);
    expect(p.willCreateCategories).toContain('Sparkle Lab');
    // preview shows the parsed price so the unit can be sanity-checked
    expect(p.rows.find((r) => r.name === 'New Gel Mani')?.priceDisplay).toBe('$45.00');
    expect(p.rows.find((r) => r.name === 'Bad Row')?.action).toBe('error');
    // nothing was written
    expect((await svc.list(ctx)).items.length).toBe(before);
  });

  it('rejects a CSV missing required columns', async () => {
    const p = await mk().importPreview(ctx, 'Foo,Bar\n1,2');
    expect(p.ok).toBe(false);
    expect(p.message).toMatch(/Name, Price, and Duration/);
  });
});

describe('services CSV import — commit', () => {
  it('creates new services + categories, updates matches, skips errors', async () => {
    const svc = mk();
    const cats = await svc.listCategories(ctx);
    const existingCat = cats[0].name;
    const existingSvc = (await svc.list(ctx)).items[0].serviceName;
    const beforeCount = (await svc.list(ctx)).items.length;

    const csv = [
      'Name,Category,Price,Duration,Status',
      `New Gel Mani,${existingCat},45.00,40,active`,
      `Brand New Service,Sparkle Lab,75.00,50,active`,
      `${existingSvc},${existingCat},99.00,30,active`,
      `Bad Row,${existingCat},notaprice,30,active`,
    ].join('\n');

    const res = await svc.importCommit(ctx, csv);
    expect(res.ok).toBe(true);
    expect(res.created).toBe(2);
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(1);     // the bad-price row
    expect(res.failed).toBe(0);
    expect(res.createdCategories).toContain('Sparkle Lab');

    // the two new services now exist
    const after = await svc.list(ctx);
    expect(after.items.length).toBe(beforeCount + 2);
    const gel = after.items.find((s) => s.serviceName === 'New Gel Mani');
    expect(gel?.priceCents).toBe(4500);
    expect(gel?.durationMinutes).toBe(40);
    // the updated service took the new price
    const updated = after.items.find((s) => s.serviceName === existingSvc);
    expect(updated?.priceCents).toBe(9900);
  });

  it('round-trips: a re-imported export (dollar prices) updates in place, creating nothing', async () => {
    const svc = mk();
    const exported = await svc.export(ctx);            // headers: Id,Name,Category,Price($),Duration,Status,...
    const before = (await svc.list(ctx)).items.length;
    const res = await svc.importCommit(ctx, exported.csv);
    expect(res.created).toBe(0);                        // everything matches by Id/Name
    expect(res.updated).toBe(before);
    expect((await svc.list(ctx)).items.length).toBe(before);
  });
});
