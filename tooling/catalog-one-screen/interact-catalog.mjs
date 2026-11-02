// interact-catalog.mjs — Services & Products · Service Pricing · Service Categories · Add-Ons steps of the catalog E2E
// (Oct 30 2026). extra.mjs reshapes the catalog into the photo's (6 services, Nails 4 / CD 4432 1 / CD 6805 1, French tips on
// four services) and adds paid tickets with service, add-on and retail lines.
//   node tooling/catalog-one-screen/interact.mjs <label> catalog
export const STEPS_CATALOG = ({ page, expect, settle, go, tid, noJunk, close, kpi, rowsText, search, API, SQL, J }) => {
  const money = (c) => '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return [
    ['services: the ten KPIs are the server\'s; margin and package sales say why they are "—"; no cookie branch overrides', async () => {
      await go('/services', '.work.svp'); await noJunk();
      const d = (await API('/pos/catalog/dashboard?preset=month')).kpis;
      expect(await kpi('kpi-total-services') === String(d.totalServices) && d.totalServices === 6, 'total services ' + d.totalServices);
      expect(await kpi('kpi-avg-price') === '$66.33', 'avg ' + await kpi('kpi-avg-price'));
      expect(await kpi('kpi-online') === String(d.onlineBookable), 'online');
      expect(await kpi('kpi-margin') === '—' && await kpi('kpi-packages') === '—', 'honest dashes');
      expect(await kpi('kpi-add-on-conversion') === `${d.addOnConversionPct}%`, 'conversion ' + await kpi('kpi-add-on-conversion'));
      expect(await kpi('kpi-retail-today') === money(d.retailRevenueTodayCents), 'retail today');
      const cookies = await page.context().cookies(); expect(!cookies.some((c) => /branchOverrides/.test(c.name)), 'a demo cookie is back');
      return `6 services · $66.33 · online ${d.onlineBookable} · top ${d.topCategory} (${d.topCategoryBasis}) · conversion ${d.addOnConversionPct}% · retail today ${money(d.retailRevenueTodayCents)}`;
    }],
    ['services: the branch panel shows each branch\'s own row (Voorhees Gel Manicure $60) for the selected service', async () => {
      const gel = (await rowsText(tid('service-row'))).findIndex((r) => r.startsWith('Gel Manicure'));
      expect(gel >= 0, 'Gel Manicure not on page 1');
      await page.locator(tid('service-row')).nth(gel).click(); await settle();
      const b = await rowsText(tid('branch-row'));
      expect(b.some((r) => r.includes('Cherry Hill') && r.includes('$55.00')) && b.some((r) => r.includes('Voorhees') && r.includes('$60.00')), b.join(' | '));
      return b.join(' | ');
    }],
    ['services: a phone search in any format finds what the customer was charged; the technician scope finds Bao\'s services', async () => {
      const seen = [];
      for (const q of ['(856) 555-1201', '856-555-1201', '8565551201']) {
        await search(tid('search'), q); const r = await rowsText(tid('customer-history-row'));
        expect(r.length >= 1 && r.every((x) => /••• 1201/.test(x)), `${q}: ${r.join(' | ')}`); seen.push(`${q} → ${r.length}`);
      }
      await page.selectOption(tid('scope'), 'technicians'); await search(tid('search'), 'bao'); const t = await rowsText(tid('service-row'));
      expect(t.length === 1 && t[0].startsWith('Gel Manicure'), 'tech ' + t.join(' | '));
      await page.selectOption(tid('scope'), 'all'); await page.click(tid('search-clear')); await settle();
      return seen.join(', ') + `; technician "bao" → ${t[0]}`;
    }],
    ['services: Create Bundle saves a real bundle with real items; it shows in the panel', async () => {
      await page.click(tid('bundle-new')); await page.waitForSelector(tid('dlg-bundle'));
      await page.fill(tid('bundle-name'), 'Mani + Pedi'); await page.fill(tid('bundle-price'), '95');
      await page.fill(tid('bundle-find'), 'manicure'); await settle();
      await page.locator(`${tid('dlg-bundle')} .cg-pick button`, { hasText: 'Gel Manicure' }).first().click();
      await page.fill(tid('bundle-find'), 'pedicure'); await settle();
      await page.locator(`${tid('dlg-bundle')} .cg-pick button`, { hasText: 'Classic Pedicure' }).first().click();
      await page.click(tid('bundle-save')); await settle();
      const list = await rowsText(`${tid('bundle-list')} li`); expect(list.some((r) => r.includes('Mani + Pedi') && r.includes('$95.00')), list.join(' | '));
      return list.join(' | ');
    }],
    ['pricing: the four cards are the whole catalog; "$50" filters the list and the cards say so without changing', async () => {
      await go('/tenant/services/pricing', '.work.cgp'); await noJunk();
      const cards = ['kpi-services', 'kpi-average', 'kpi-lowest', 'kpi-highest']; const v = []; for (const c of cards) v.push(await kpi(c));
      expect(v.join(' ') === '6 $66.33 $45.00 $150.00', v.join(' '));
      await search(tid('search'), '$50'); const r = await rowsText(tid('pricing-row'));
      expect(r.length === 2 && r.every((x) => x.includes('$50.00')), r.join(' | '));
      const after = []; for (const c of cards) after.push(await kpi(c)); expect(after.join() === v.join(), 'cards moved with the filter');
      expect(/Filtered list: 2/.test(await page.locator(tid('kpi-services')).innerText()), 'no filtered sub-line');
      await page.click(tid('search-clear')); await settle();
      return `${v.join(' · ')}; "$50" → ${r.length} rows (cards unchanged)`;
    }],
    ['pricing: Edit Pricing refuses without a reason, saves with one (Classic Pedicure stays 50 min), records history, refuses a stale save', async () => {
      await search(tid('search'), 'classic pedicure');
      await page.locator(tid('row-edit-pricing')).first().click(); await page.waitForSelector(tid('dlg-pricing'));
      await page.fill(tid('pricing-price'), '52.00'); await page.click(tid('pricing-save')); await settle();
      expect(await page.locator(tid('pricing-error')).count() === 1, 'saved without a reason');
      await page.fill(tid('pricing-reason'), 'Supplier price increase'); await page.click(tid('pricing-save')); await settle();
      const row = (await rowsText(tid('pricing-row')))[0]; expect(row.includes('$52.00') && row.includes('50 min'), row);
      const h = await SQL('changes'); expect(h[0].field === 'price_cents' && h[0].old_value === '4800' && h[0].new_value === '5200' && h[0].reason === 'Supplier price increase' && h[0].source === 'pricing_editor', JSON.stringify(h[0]));
      expect(!h.some((x) => x.field === 'duration_minutes'), 'duration was changed');
      const svc = (await API('/pos/catalog/services?q=classic%20pedicure')).items[0];
      const stale = await fetch(page.url().replace(/\/tenant.*$/, '') + `/api/v1/pos/catalog/services/${svc.serviceId}/pricing`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ priceCents: 5300, reason: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }) });
      const sj = await stale.json(); expect(stale.status === 409 && sj.code === 'CATALOG_EDIT_CONFLICT', `${stale.status} ${sj.code}`);
      await page.click(tid('tab-history')); await settle();
      const hr = await rowsText(tid('change-row')); expect(hr[0]?.includes('Classic Pedicure') && hr[0].includes('$48.00') && hr[0].includes('$52.00'), hr[0]);
      await page.click(tid('tab-list')); await page.click(tid('search-clear')); await settle();
      return `${row}; history: ${hr[0]}; stale save → 409 ${sj.code}`;
    }],
    ['categories: two cards, chart + Breakdown 66.7 / 16.7 / 16.7; CD 4432, CD 6805 and the hair services are flagged, not fixed', async () => {
      await go('/tenant/services/categories', '.work.cgc'); await noJunk();
      expect(await kpi('kpi-categories') === '3' && await kpi('kpi-total-services') === '6', 'cards');
      const b = await rowsText(tid('breakdown-row')); expect(b.join('|') === 'Nails 4 66.7%|CD 4432 1 16.7%|CD 6805 1 16.7%', b.join('|'));
      const rv = await rowsText(`${tid('review-list')} li`);
      expect(rv.some((x) => x.includes('CD 4432')) && rv.some((x) => x.includes('CD 6805')) && rv.some((x) => x.includes('Haircut')) && rv.some((x) => x.includes('Hair Coloring')), rv.join(' | '));
      await search(tid('search'), 'gel'); const d = await rowsText(tid('category-row')); expect(d.length === 1 && d[0].includes('Nails') && d[0].includes('Gel Manicure'), d.join(' | '));
      await page.click(tid('search-clear')); await settle();
      return `${b.join(' · ')}; review ${rv.length}; "gel" → ${d[0]}`;
    }],
    ['categories: Manage Services previews, needs a reason, then moves Haircut + Hair Coloring (prices and times unchanged)', async () => {
      const before = (await API('/pos/catalog/services?q=hair')).items.map((s) => `${s.name}:${s.priceCents}:${s.durationMinutes}`).sort();
      const nails = (await rowsText(tid('category-row'))).findIndex((r) => r.startsWith('Nails'));
      await page.locator(tid('category-row')).nth(nails).click(); await page.waitForSelector(tid('dlg-category-details'));
      await page.click(tid('manage-services')); await page.waitForSelector(tid('reassign'));
      const labels = await page.locator(`${tid('reassign')} li`).allInnerTexts();
      for (const n of ['Haircut', 'Hair Coloring']) await page.locator(`${tid('reassign')} li`).nth(labels.findIndex((l) => l.trim().startsWith(n + '\n') || l.trim().startsWith(n + ' ') || l.trim().split('\n')[0].trim() === n)).locator('input').check();
      const opts = await page.locator(`${tid('move-to')} option`).allInnerTexts(); await page.selectOption(tid('move-to'), { label: opts.find((o) => o === 'CD 6805') });
      await page.click(tid('move-preview-btn')); await settle(); const pv = await page.locator(tid('move-preview')).innerText();
      expect(/Nails/.test(pv) && /CD 6805/.test(pv) && /Haircut/.test(pv) && /Hair Coloring/.test(pv), pv);
      await page.click(tid('move-confirm')); await settle(); expect(await page.locator(tid('move-error')).count() === 1, 'moved without a reason');
      await page.fill(tid('move-reason'), 'Hair services were filed under Nails'); await page.click(tid('move-preview-btn')); await settle(); await page.click(tid('move-confirm')); await settle();
      await close(); await settle();
      const b = await rowsText(tid('breakdown-row')); expect(b.join('|') === 'Nails 2 33.3%|CD 4432 1 16.7%|CD 6805 3 50.0%', b.join('|'));
      const after = (await API('/pos/catalog/services?q=hair')).items.map((s) => `${s.name}:${s.priceCents}:${s.durationMinutes}`).sort();
      expect(after.join() === before.join(), `${before} → ${after}`);
      const h = (await SQL('changes')).filter((x) => x.source === 'reassignment'); expect(h.length === 2 && h.every((x) => x.reason === 'Hair services were filed under Nails'), JSON.stringify(h));
      return `${pv.replace(/\s+/g, ' ').slice(0, 120)} → ${b.join(' · ')}`;
    }],
    ['add-ons: four cards, eight columns; French tips is one add-on on four services; the hair rows are flagged (kept)', async () => {
      await go('/tenant/services/add-ons', '.work.cga'); await noJunk();
      const v = []; for (const c of ['kpi-total', 'kpi-active', 'kpi-services', 'kpi-avg']) v.push(await kpi(c)); expect(v.join(' ') === '4 4 4 $10.00', v.join(' '));
      const head = (await rowsText(`${tid('add-ons-table')} thead th`)).map((x) => x.toUpperCase());
      for (const h of ['ADD-ON', 'SERVICE', 'CATEGORY', 'PRICE', '+ TIME', 'TAXABLE', 'STATUS', 'ACTIONS']) expect(head.includes(h), 'column ' + h + ' in ' + head.join(','));
      const rows = await rowsText(tid('add-on-row')); expect(rows.length === 4 && rows.every((r) => r.includes('French tips') && r.includes('$10.00')), rows.join(' | '));
      expect(await page.locator(tid('review-flag')).count() === 2, 'flags');
      for (const l of ['link-services', 'link-categories', 'link-pricing']) expect(await page.locator(tid(l)).count() === 1, l);
      return `${v.join(' · ')}; ${rows.length} offerings, 2 flagged`;
    }],
    ['add-ons: editing one offering changes only that service; a new add-on must name its services; archive + restore one offering', async () => {
      const rows = await rowsText(tid('add-on-row')); const cut = rows.findIndex((r) => r.includes('Haircut'));
      await page.locator(tid('row-edit')).nth(cut).click(); await page.waitForSelector(tid('dlg-add-on-edit'));
      expect(await page.locator(tid('scope-offering')).getAttribute('aria-checked') === 'true', 'default scope is not the offering');
      await page.fill(tid('edit-price'), '12.00'); await page.fill(tid('edit-reason'), 'Longer on hair'); await page.click(tid('add-on-edit-save')); await settle();
      const a = (await API('/pos/catalog/add-ons?pageSize=10')).items.map((x) => `${x.serviceName}:${x.priceCents}`).sort();
      expect(a.join() === 'Classic Pedicure:1000,Gel Manicure:1000,Hair Coloring:1000,Haircut:1200', a.join());
      await page.click(tid('new-add-on')); await page.waitForSelector(tid('dlg-add-on-create'));
      await page.fill(tid('add-on-name'), 'Chrome powder'); await page.fill(tid('add-on-price'), '8'); await page.click(tid('add-on-save')); await settle();
      expect(await page.locator(tid('add-on-error')).count() === 1, 'created with no services');
      await page.fill(tid('svc-find'), 'gel'); await settle(); await page.locator(tid('svc-pick')).first().click(); await page.click(tid('add-on-save')); await settle();
      const made = (await SQL('addons')).filter((x) => x.name === 'Chrome powder'); expect(made.length === 1, 'chrome ' + made.length);
      const r2 = await rowsText(tid('add-on-row')); const cut2 = r2.findIndex((r) => r.includes('French tips') && r.includes('Haircut'));
      await page.locator(tid('row-archive')).nth(cut2).click(); await page.click(tid('archive-confirm')); await settle();
      let s = await API('/pos/catalog/add-ons/summary'); expect(s.activeOfferings === 4 && s.offerings === 5, JSON.stringify(s));
      const r3 = await rowsText(tid('add-on-row')); const cut3 = r3.findIndex((r) => r.includes('French tips') && r.includes('Haircut'));
      await page.locator(`${tid('add-on-row')} >> nth=${cut3}`).locator(tid('row-restore')).click(); await page.click(tid('archive-confirm')); await settle();
      s = await API('/pos/catalog/add-ons/summary'); expect(s.activeOfferings === 5, JSON.stringify(s));
      return `${a.join(', ')}; Chrome powder on 1 service; Haircut offering archived → restored (${s.activeOfferings}/${s.offerings})`;
    }],
  ];
};
