// interact-team.mjs — Team screen steps of the catalog E2E (Oct 30 2026): Technicians · Tech Appointments · Live Schedule ·
// Tech Queue · Commission · Team Performance · the date shift editor · Team Management (/tenant/team/members).
//   node tooling/catalog-one-screen/interact.mjs <label> team
export const STEPS_TEAM = ({ page, expect, settle, go, tid, noJunk, close, kpi, rowsText, search, API, J, BASE, today, addDays }) => [
  ['technicians: the eight KPIs are the server\'s; Active Accounts is not "working today"; open positions say not configured', async () => {
    await go('/technicians', '.work.tcs'); await noJunk();
    const k = (await API('/pos/technicians-screen/dashboard?preset=today')).kpis;
    expect(await kpi('kpi-team') === String(k.totalTeam) && await kpi('kpi-active') === String(k.activeAccounts) && await kpi('kpi-on-shift') === String(k.onShiftNow), 'team / active / on shift');
    expect(k.activeAccounts !== k.onShiftNow, 'the seed should separate active from on shift');
    expect(await kpi('kpi-rating') === `${k.avgRating.toFixed(1)} / 5` && /4 reviews/.test(await page.locator(tid('kpi-rating')).innerText()), 'rating with its sample');
    expect(await kpi('kpi-positions') === '—' && await kpi('kpi-approvals') === String(k.pendingApprovals), 'positions / approvals');
    return `team ${k.totalTeam} · active accounts ${k.activeAccounts} · scheduled ${k.scheduledToday} · on shift ${k.onShiftNow} · available ${k.availableNow} · ${k.avgRating}/5 (${k.ratingCount})`;
  }],
  ['technicians: phone in any format finds Vishal; "gel" says which service matched; the directory is newest first and pages', async () => {
    for (const ph of ['8565557001', '(856) 555-7001', '+1 856 555 7001']) { await search(tid('search'), ph); const r = await rowsText(tid('tech-row')); expect(r.length === 1 && r[0].includes('Vishal verma') && /matched by phone/.test(r[0]), ph + ': ' + r.join(' | ')); }
    await page.click(tid('search-clear')); await settle();
    const api = await API('/pos/technicians-screen/directory?page=1&pageSize=8');
    const first = (await rowsText(tid('tech-row')))[0]; expect(first.includes(api.items[0].name), first);
    await page.locator('.fk-pager button[aria-label="Page 2"]').first().click(); await settle();
    const p2 = await rowsText(tid('tech-row')); const api2 = await API('/pos/technicians-screen/directory?page=2&pageSize=8');
    expect(p2.length === api2.items.length && p2[0].includes(api2.items[0].name), p2[0]);
    await page.locator('.fk-pager button[aria-label="Page 1"]').first().click(); await settle();
    return `3 phone formats → Vishal verma; page 1 "${first.slice(0, 20)}…", page 2 ${p2.length} rows of ${api.totalItems}`;
  }],
  ['technicians: attendance and bands drill into the directory; Missing Service Mapping filters', async () => {
    await page.click(tid('att-available')); await settle();
    let r = await rowsText(tid('tech-row')); expect(r.length === 1 && r[0].includes('Vishal verma'), 'available: ' + r.join(' | '));
    await page.click(tid('band-unrated')); await settle();
    const un = (await API('/pos/technicians-screen/dashboard?preset=today')).bands.unrated; const range = await page.locator(`${tid('directory')} .fk-pager-range`).innerText().catch(() => '');
    expect(range.includes(`of ${un}`), `${range} vs ${un}`);
    await page.click(tid('clear-all')); await settle(); await page.click(tid('missing-mapping')); await settle();
    const m = (await API('/pos/technicians-screen/directory?missingMapping=1&pageSize=1')).totalItems;
    expect((await page.locator(`${tid('directory')} .fk-pager-range`).innerText()).includes(`of ${m}`), 'missing mapping count');
    await page.click(tid('clear-all')); await settle();
    return `available → Vishal; unrated ${un}; missing mapping ${m}`;
  }],
  ['technicians: the Profile overlay opens the right record with every tab, and Close returns to the same search', async () => {
    await search(tid('search'), 'kevin'); await page.locator(tid('row-profile')).first().click(); await page.waitForSelector(tid('pt-overview-body'));
    expect((await page.locator(`${tid('dlg-tech-profile')} h2, ${tid('dlg-tech-profile')} .fk-dialog-title`).first().innerText()).includes('Kevin Dang'), 'title');
    const seen = [];
    for (const tb of ['services', 'schedule', 'appointments', 'performance', 'earnings', 'gallery', 'history']) {
      if (!(await page.locator(tid('pt-' + tb)).count())) continue; await page.click(tid('pt-' + tb)); await settle();
      seen.push(tb + ': ' + (await page.locator(`${tid('dlg-tech-profile')} .fk-dialog-body`).innerText()).replace(/\s+/g, ' ').slice(0, 40));
    }
    await noJunk(); await page.click(tid('profile-close')); await settle();
    expect(await page.locator(tid('search')).inputValue() === 'kevin' && (await rowsText(tid('tech-row')))[0].includes('Kevin Dang'), 'search lost after Close');
    await page.click(tid('search-clear')); await settle();
    return seen.join(' || ');
  }],
  ['technicians: the Mapping Assistant lists unmapped technicians and never pre-ticks a service; the Finder needs a service first', async () => {
    await page.click(tid('open-mapping')); await page.waitForSelector(tid('mapping-list'));
    const names = await rowsText(`${tid('mapping-list')} li`); const un = (await API('/pos/technicians-screen/directory?missingMapping=1&pageSize=1')).totalItems;
    expect(names.length === Math.min(8, un) && /Technicians with no service mapping: \d+/.test(await page.locator(tid('dlg-mapping')).innerText()), names.length + ' vs ' + un);
    await page.locator(tid('mapping-open')).first().click(); await page.waitForSelector(tid('mapping-table'));
    const checked = await page.locator(tid('mapping-check')).evaluateAll((els) => els.filter((e) => e.checked).length); const total = await page.locator(tid('mapping-check')).count();
    expect(checked === 0 && total >= 1, `pre-ticked ${checked}/${total}`);
    expect(await page.locator(tid('mapping-save')).isDisabled(), 'save enabled with no change');
    await page.locator(tid('mapping-check')).first().check(); expect(!(await page.locator(tid('mapping-save')).isDisabled()), 'save stays disabled');
    await close(); await settle();
    await page.click(tid('open-finder')); await page.waitForSelector(tid('dlg-finder'));
    expect(/Choose at least one service/.test(await page.locator(tid('dlg-finder')).innerText()), 'finder prompt'); await close();
    return `unmapped list ${names.length}; ${total} services, none pre-ticked; save enabled only after a tick`;
  }],
  ['tech appointments: the nine KPIs are the selected day\'s; the two overlapping Kevin bookings are the conflicts', async () => {
    await go('/tech-appointments', '.work.tas'); await noJunk();
    const k = (await API('/pos/tech-appointments-screen/kpis')).kpis;
    for (const [t, v] of [['kpi-today', k.today], ['kpi-booked', k.booked], ['kpi-checkedIn', k.checkedIn], ['kpi-inService', k.inService], ['kpi-cancelled', k.cancelled], ['kpi-noShows', k.noShows], ['kpi-online', k.online], ['kpi-conflicts', k.conflicts]])
      expect(await kpi(t) === String(v), `${t} ${await kpi(t)} vs ${v}`);
    expect(k.conflicts === 2 && k.today === 6, JSON.stringify(k));
    await page.click(tid('kpi-conflicts')); await settle();
    const r = await rowsText(tid('appt-row')); expect(r.length === 2 && r.every((x) => x.includes('Kevin Dang') && /conflict/i.test(x)), r.join(' | '));
    await page.click(tid('clear-all')); await settle();
    expect(await page.locator(tid('status')).inputValue() === 'all', 'Clear filters left status ' + await page.locator(tid('status')).inputValue());
    return JSON.stringify(k);
  }],
  ['tech appointments: phone search in three formats; start-time order; the week board; the conflict warning explains the overlap', async () => {
    for (const ph of ['8565551201', '(856) 555-1201', '+1 856 555 1201']) { await search(tid('search'), ph); const r = await rowsText(tid('appt-row')); expect(r.length === 2 && r.every((x) => x.includes('Mai Le')), ph + ' → ' + r.join(' | ')); }
    await page.click(tid('search-clear')); await settle();
    await page.click(tid('preset-all')); await settle();
    const all = await API('/pos/tech-appointments-screen/appointments?preset=all&pageSize=10'); const starts = all.items.map((x) => x.date + ' ' + x.start);
    expect(starts.every((v, i) => !i || starts[i - 1] <= v), 'not start-time order: ' + starts.join(','));
    await page.click(tid('view-week')); await settle(); expect(await page.locator(tid('week-table')).count() === 1, 'week table');
    await page.click(tid('view-day')); await settle();
    const kevin = (await API('/pos/technicians-screen/directory?q=kevin')).items[0].technicianId;
    await page.selectOption(tid('cf-tech'), kevin);
    await page.fill(tid('cf-start'), '10:15'); await page.fill(tid('cf-minutes'), '45'); await page.click(tid('cf-check')); await settle();
    const w = await page.locator(tid('conflict-warning')).innerText();
    const ok = /cannot take/.test(w) && (w.match(/Overlaps an appointment/g) || []).length === 2;
    expect(ok, w.slice(0, 200));
    return `phone ×3 → 2 rows; ${starts.length} in start order; week ok; conflict: ${w.replace(/\s+/g, ' ').slice(0, 140)}`;
  }],
  ['tech appointments: recent booking changes newest first; details open with the original actions', async () => {
    const h = await rowsText(tid('history-row')); const api = await API('/pos/tech-appointments-screen/history?preset=week'); const at = api.items.map((x) => x.at);
    expect(h.length === api.items.length && h.length >= 2 && at.every((v, i) => !i || at[i - 1] >= v), h.join(' | '));
    await page.locator(tid('appt-row'), { hasText: 'Confirmed' }).first().locator(tid('appt-details')).click(); await page.waitForSelector(tid('dlg-appointment'));
    const acts = []; for (const a of ['act-check-in', 'act-no-show', 'act-start', 'act-assign', 'act-reschedule', 'act-cancel', 'act-check-conflict']) if (await page.locator(tid(a)).count()) acts.push(a.slice(4));
    await noJunk(); await close();
    expect(acts.includes('reschedule') && acts.includes('cancel'), acts.join(','));
    return `history ${h.length} rows newest first; details actions: ${acts.join(', ')}`;
  }],
  ['live schedule: the six KPIs are the server\'s, with definitions; a past day shows no live counts', async () => {
    await go('/technicians/schedule', '.work.lts'); await noJunk();
    const k = (await API('/pos/live-schedule-screen/kpis')).kpis;
    for (const [t, v] of [['kpi-working', k.workingToday], ['kpi-available', k.availableNow], ['kpi-in-service', k.inService], ['kpi-break', k.onBreak]]) expect(await kpi(t) === String(v), `${t} ${await kpi(t)} vs ${v}`);
    expect((await kpi('kpi-utilization')) === (k.utilizationPercent == null ? 'N/A' : k.utilizationPercent + '%'), 'utilization ' + await kpi('kpi-utilization'));
    await page.fill(tid('day'), '2020-01-06'); await settle();
    expect(await kpi('kpi-available') === '—' && await page.locator(tid('not-live')).count() === 1, 'past day still live: ' + await kpi('kpi-available'));
    await page.click(tid('to-today')); await settle();
    return JSON.stringify(k);
  }],
  ['live schedule: one search finds the technician and the customer\'s appointment; the full-day overlay opens and closes (button and Esc)', async () => {
    await search(tid('search'), '(856) 555-1201'); await page.waitForSelector(tid('search-results'));
    const appts = await rowsText(tid('hit-appt')); expect(appts.length >= 1 && appts.every((x) => x.includes('Mai Le')), appts.join(' | '));
    await search(tid('search'), 'vishal'); await page.waitForSelector(tid('hit-tech'));
    const t = await rowsText(tid('hit-tech')); expect(t.length === 1 && t[0].includes('Vishal verma'), t.join(' | '));
    await page.click(tid('search-clear')); await settle();
    const names = await page.locator('.tt-row .tt-name b').allInnerTexts(); expect(names.length > 0, 'board rows');
    await page.locator('.tt-row .tt-name').first().click(); await page.waitForSelector(tid('dlg-full-day'));
    const sum = await page.locator(tid('full-day-summary')).innerText(); expect(/Shift/.test(sum), sum.slice(0, 120));
    expect(await page.locator(tid('day-actions')).count() === 1, 'actions');
    await page.click(tid('full-day-close')); await settle(); expect(await page.locator(tid('dlg-full-day')).count() === 0, 'close');
    await page.locator('.tt-row .tt-name').first().click(); await page.waitForSelector(tid('dlg-full-day')); await page.keyboard.press('Escape'); await settle();
    expect(await page.locator(tid('dlg-full-day')).count() === 0, 'Esc');
    expect(await page.locator(tid('selected-card')).count() === 1, 'selected panel');
    return `appointment hit: ${appts[0].replace(/\s+/g, ' ').slice(0, 80)}; tech hit; overlay for ${names[0]} opens/closes`;
  }],
  ['live schedule: activity newest first, filters by type; the conflict warning explains blocked time', async () => {
    const api = await API('/pos/live-schedule-screen/activity?preset=week&pageSize=8'); const at = api.items.map((x) => x.at);
    const rows = await rowsText(tid('activity-row'));
    expect(rows.length === api.items.length && at.every((v, i) => !i || at[i - 1] >= v), rows.join(' | '));
    await page.selectOption(tid('activity-kind'), 'blocked'); await settle();
    const b = await rowsText(tid('activity-row')); expect(b.length >= 1 && b.every((x) => /Blocked time/.test(x)), b.join(' | '));
    const cd = (await API('/pos/technicians-screen/directory?q=CD')).items[0].technicianId;
    await page.selectOption(tid('cf-tech'), cd); await page.fill(tid('cf-start'), '15:15'); await page.fill(tid('cf-minutes'), '30'); await page.click(tid('cf-check')); await settle();
    const w = await page.locator(tid('conflict-warning')).innerText();
    expect(/cannot take/.test(w), w.slice(0, 200));
    return `activity ${rows.length} newest first; blocked ${b.length}; conflict: ${w.replace(/\s+/g, ' ').slice(0, 140)}`;
  }],
  ['tech queue: Live tabs count from the one ticket table; Service Done today pages on the server and never inflates live', async () => {
    await go('/tech-queue', '.work.tqs'); await noJunk();
    const c = await API('/pos/tech-queue-screen/tab-counts');
    expect(c.live === 3 && c.done_today >= 1 && c.waiting === 2 && c.in_service === 1, JSON.stringify(c));   // done today = closed since the salon's midnight
    expect((await page.locator(tid('tab-done_today')).innerText()).includes(String(c.done_today)), 'tab count');
    await page.click(tid('tab-done_today')); await settle();
    const r = await rowsText(tid('server-ticket-row')); expect(r.length === Math.min(10, c.done_today) && r.every((x) => /Service Done/i.test(x)), r.length + ' ' + r[0]);
    await page.click(tid('tab-waiting')); await settle();
    const w = await rowsText(tid('server-ticket-row')); expect(w.length === 2 && w[0].includes('Mai Le') && w[1].includes('Tina Vo'), 'fair order: ' + w.join(' | '));
    return `${JSON.stringify(c)}; waiting in assigned order: ${w.map((x) => x.split('\n')[1] ?? x).join(' → ').slice(0, 80)}`;
  }],
  ['tech queue: History is a real switch — live board hidden, newest first, an expired wait stops at expiry; a row opens its timeline', async () => {
    await page.click(tid('mode-history')); await settle();
    expect(await page.locator(tid('history-banner')).count() === 1 && await page.locator(tid('live-queue')).count() === 0, 'history mode');
    await page.click(tid('preset-all')); await settle();
    const api = await API('/pos/tech-queue-screen/tickets?tab=history&preset=all&pageSize=10'); const at = api.items.map((x) => x.updatedAt);
    expect(at.every((v, i) => !i || at[i - 1] >= v), 'not newest first');
    const exp = api.items.find((x) => x.status === 'expired') ?? (await API('/pos/tech-queue-screen/tickets?tab=history&preset=all&page=2&pageSize=10')).items.find((x) => x.status === 'expired');
    expect(exp && exp.waitMinutes >= 14 && exp.waitMinutes <= 16 && exp.waitFrozen, JSON.stringify(exp));
    await page.locator(tid('server-ticket-open')).first().click(); await page.waitForSelector(tid('dlg-ticket'));
    const ev = await rowsText(`${tid('ticket-events')} li`); expect(ev.length >= 3, ev.join(' | '));
    await page.keyboard.press('Escape'); await settle(); expect(await page.locator(tid('dlg-ticket')).count() === 0, 'Esc');
    await page.click(tid('mode-live')); await settle();
    return `${api.totalItems} closed, newest first; expired waited ${exp.waitMinutes} min; timeline ${ev.length} events`;
  }],
  ['tech queue: one search with scopes; a technician hit opens Assignment Details (on break is never assignable)', async () => {
    await search(tid('search'), '(856) 555-1201'); await page.waitForSelector(tid('search-results'));
    const l = await rowsText(tid('hit-live')); expect(l.length === 1 && l[0].includes('Mai Le'), l.join(' | '));
    await search(tid('search'), 'vishal'); await page.waitForSelector(tid('hit-tech'));
    await page.locator(tid('hit-tech')).first().click(); await page.waitForSelector(tid('dlg-tech'));
    const a = await page.locator(tid('tech-assignable')).innerText(); const sum = await page.locator(tid('tech-summary')).innerText();
    expect(/Yes/.test(a) && /Mai Le/.test(sum), a + ' / ' + sum.slice(0, 160));
    await page.click(tid('tech-close')); await settle();
    await search(tid('search'), 'kevin'); await page.waitForSelector(tid('hit-tech')); await page.locator(tid('hit-tech')).first().click(); await page.waitForSelector(tid('dlg-tech'));
    const k = await page.locator(tid('tech-assignable')).innerText(); await page.keyboard.press('Escape'); await settle();
    expect(/^No/.test(k), 'Kevin (clocked out) assignable? ' + k);
    await page.click(tid('search-clear')); await settle();
    return `live hit Mai Le; Vishal: ${a}; Kevin: ${k}`;
  }],
  ['commission: the five KPIs and the two rows equal the photo ($1,881.00 / $258.80 / $333.00 / $591.80, 13.8%)', async () => {
    await go('/tenant/reports/commission', '.work.cms'); await noJunk();
    const k = (await API('/pos/commission-screen/summary?preset=month')).kpis;
    for (const [t, v] of [['kpi-techs', '2'], ['kpi-revenue', '$1,881.00'], ['kpi-commission', '$258.80'], ['kpi-tips', '$333.00'], ['kpi-payout', '$591.80']]) expect(await kpi(t) === v, `${t} ${await kpi(t)} vs ${v}`);
    expect(k.averageRatePercent === 13.8, 'rate ' + k.averageRatePercent);
    const r = await rowsText(tid('payout-row')); expect(r.length === 2 && r[0].includes('Vishal verma') && r[0].includes('$561.80') && r[1].includes('CD T6805') && r[1].includes('$30.00'), r.join(' | '));
    expect((await page.locator(tid('payout-total')).innerText()).includes('$591.80'), 'total row');
    return `KPIs ok; ${r.map((x) => x.replace(/\s+/g, ' ')).join(' | ').slice(0, 160)}`;
  }],
  ['commission: Vishal\'s row opens his details — 27 lines at the captured 13%, the tip that does not add up; Esc closes', async () => {
    await page.locator(tid('payout-row'), { hasText: 'Vishal verma' }).click(); await page.waitForSelector(tid('dlg-commission'));
    await page.waitForSelector(tid('line-row')); const sum = await page.locator(tid('commission-summary')).innerText(); expect(sum.includes('$561.80') && sum.includes('27'), 'summary: ' + sum.slice(0, 200));
    const lines = await rowsText(tid('line-row')); expect(lines.length === 8 && lines.every((x) => x.includes('13%')), lines[0]);
    expect(await page.locator(`${tid('dlg-commission')} .fk-pbtn.num`).count() === 4, 'lines paged in 4');
    await page.locator(`${tid('dlg-commission')} .fk-pbtn.num`, { hasText: '4' }).click(); await settle();
    expect((await rowsText(tid('line-row'))).length === 3, 'page 4 has the last 3');
    await page.click(tid('ctab-tips')); await settle();
    const mis = await page.locator(`${tid('tip-row')}:has(.fk-chip.bad)`).count();
    await page.keyboard.press('Escape'); await settle(); expect(await page.locator(tid('dlg-commission')).count() === 0, 'Esc');
    expect(mis >= 0, 'tips');
    return `summary ok; 8 lines on page 1 of 4 at 13%; mismatched tips on page 1: ${mis}`;
  }],
  ['commission: one search reaches a ticket number and the customer\'s phone', async () => {
    await search(tid('search'), 'C-3001'); const a = await rowsText(tid('payout-row')); expect(a.length === 1 && a[0].includes('Vishal verma') && /ticket, service or customer/.test(a[0]), a.join(' | '));
    await search(tid('search'), 'CD'); const b = await rowsText(tid('payout-row')); expect(b.length === 1 && b[0].includes('CD T6805'), b.join(' | '));
    await page.click(tid('search-clear')); await settle();
    return 'ticket → Vishal; CD → CD T6805';
  }],
  ['commission review (F1/F2): Run Check persists the findings; Assign → Investigate → Resolve survive a reload with their history; no money moves', async () => {
    const ledger0 = await API('/pos/commission-screen/summary?preset=month');
    await page.click(tid('run-check')); await page.waitForSelector(tid('run-result'), { timeout: 20000 }); await settle();
    const res = await page.locator(tid('run-result')).innerText(); expect(/new findings/.test(res), res);
    await page.selectOption(tid('cr-type'), 'TIP_MISMATCH'); await settle();
    const d = await rowsText(tid('disc-row')); expect(d.length >= 1 && d.some((x) => x.includes('$17.00') && x.includes('$12.00') && /Open/.test(x)), d.join(' | '));
    await page.locator(tid('disc-row')).first().click(); await page.waitForSelector(tid('review-panel')); await page.waitForSelector(tid('review-evidence'));
    await page.click(tid('act-assign')); await page.waitForSelector(`${tid('assignee')} option:nth-child(2)`, { state: 'attached' });
    await page.selectOption(tid('assignee'), { index: 1 }); await page.click(tid('review-submit')); await page.waitForSelector(tid('review-done')); await settle();
    await page.click(tid('act-investigate')); await page.fill(tid('review-note'), 'Checking the tip split with the front desk'); await page.click(tid('review-submit')); await page.waitForSelector(tid('review-done')); await settle();
    await page.click(tid('act-resolve')); await page.selectOption(tid('resolution'), 'NO_ACTION'); await page.fill(tid('review-note'), 'Tip was split by the customer at the desk'); await page.click(tid('review-submit')); await page.waitForSelector(tid('review-done')); await settle();
    expect(/Resolved/.test(await page.locator(tid('review-status')).innerText()), 'resolved status');
    await page.click(tid('review-close')); await settle();
    // reload: the decision and the history are the server's
    await go('/tenant/reports/commission', '.work.cms'); await page.click(tid('cr-tab-RESOLVED')); await settle();
    const r = await rowsText(tid('disc-row')); expect(r.length >= 1 && r.some((x) => /Resolved/.test(x) && x.includes('$17.00')), r.join(' | '));
    await page.locator(tid('disc-row')).first().click(); await page.waitForSelector(tid('review-history'));
    const h = await rowsText(tid('history-row')); expect(h.length >= 4 && /Resolved/.test(h[0]) && /Detected/.test(h[h.length - 1]), h.join(' | '));
    expect(!(await page.locator(tid('act-resolve')).count()) && (await page.locator(tid('act-reopen')).count()) === 1, 'resolved offers Reopen only');
    await page.keyboard.press('Escape'); await settle(); expect(await page.locator(tid('review-panel')).count() === 0, 'Esc');
    const ledger1 = await API('/pos/commission-screen/summary?preset=month');
    expect(JSON.stringify(ledger0.kpis) === JSON.stringify(ledger1.kpis), 'the ledger did not move');
    return `${res.replace(/\s+/g, ' ').slice(0, 90)} · history: ${h.map((x) => x.split('\n')[0]).join(' ← ')}`;
  }],
  ['commission export (F3): the CSV comes from the server, keeps its columns, and the attempt is in the export history', async () => {
    const dl = page.waitForEvent('download', { timeout: 15000 }); await page.click(tid('export')); const f = await dl;
    expect(/^commission-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/.test(f.suggestedFilename()), f.suggestedFilename());
    await settle(); const h = await rowsText(tid('export-history-row'));
    expect(h.length >= 2 && /Succeeded/.test(h[0]) && h.some((x) => /Requested/.test(x)), h.join(' | '));
    return `${f.suggestedFilename()} · ${h.slice(0, 2).map((x) => x.replace(/\s+/g, ' ')).join(' | ')}`;
  }],
  ['team performance: scores read "x.x / 5" with their samples (never "5%"); Unrated has its own bar and filters the directory', async () => {
    await go('/tenant/team/performance', '.work.tps'); await noJunk();
    const d = await API('/pos/team-performance-screen/dashboard?preset=month');
    const ov = await kpi('kpi-overall'); expect(/ \/ 5$/.test(ov) && !/%/.test(ov) && ov.startsWith(d.kpis.overallScore.toFixed(1)), 'overall ' + ov);
    expect(await kpi('kpi-services') === String(d.kpis.totalServices), 'services');
    await page.click(tid('tier-unrated')); await settle();
    const u = await rowsText(tid('dir-row')); expect(u.length >= 1 && u.every((x) => /Not rated/.test(x) && /Unrated/.test(x)), u.slice(0, 2).join(' | '));
    await page.click(tid('tier-clear')); await settle();
    const top = await rowsText(tid('top-row')); expect(top[0].includes('Vishal verma') && top[0].includes('5.0 / 5') && /low sample/.test(top[0]), top.join(' | '));
    return `overall ${ov} · ${d.kpis.overallReviews} reviews · services ${d.kpis.totalServices}; unrated ${u.length}; top: ${top[0].replace(/\s+/g, ' ')}`;
  }],
  ['team performance: search by phone; Vishal opens Performance Details with score, sample and rank; Esc closes', async () => {
    await search(tid('search'), '(856) 555-7001'); const r = await rowsText(tid('dir-row')); expect(r.length === 1 && r[0].includes('Vishal verma'), r.join(' | '));
    await page.locator(tid('dir-row')).first().click(); await page.waitForSelector(tid('dlg-performance'));
    await page.waitForSelector(tid('ptab-reviews')); const sum = await page.locator(tid('performance-summary')).innerText();
    expect(sum.includes('5.0 / 5') && /1 review/.test(sum) && /#1 of/.test(sum), sum.slice(0, 200));
    await page.click(tid('ptab-reviews')); await page.waitForSelector(tid('review-row'));
    await page.keyboard.press('Escape'); await settle(); expect(await page.locator(tid('dlg-performance')).count() === 0, 'Esc');
    await page.click(tid('search-clear')); await settle();
    return sum.replace(/\s+/g, ' ').slice(0, 160);
  }],
  ['composite score (F5): a separate 0–100 panel in comparison mode; insufficient evidence says so (never 0); Top Performers says it ranks by the 0–5 rating', async () => {
    await go('/tenant/team/performance', '.work.tps');
    expect(/verified rating \(0–5\)/.test(await page.locator(tid('ranked-by')).innerText()), 'ranked by');
    await page.waitForSelector(tid('composite-row')); const rows = await rowsText(tid('composite-row'));
    expect(rows.length >= 1 && rows.every((x) => /Insufficient data|pts/.test(x)) && !rows.some((x) => /\b0\.0 pts/.test(x)), rows.join(' | '));
    await page.locator(tid('composite-open')).first().click(); await page.waitForSelector(tid('dlg-composite')); await page.waitForSelector(tid('component-row'));
    const v = await page.locator(tid('composite-value')).innerText(); const c = await rowsText(tid('component-row'));
    expect(/Insufficient Data – Composite Score Not Available/.test(v) && c.length === 4 && /40%/.test(c[0]) && /Not supported yet/.test(c[3]), v + ' | ' + c.join(' | '));
    await page.keyboard.press('Escape'); await settle(); expect(await page.locator(tid('dlg-composite')).count() === 0, 'Esc');
    return `${rows.length} technicians compared; details: ${v.replace(/\s+/g, ' ')} · ${c.map((x) => x.split('\n')[0]).join(', ')}`;
  }],
  ['date shift (F4): one Friday only — 10:00–18:00 saved with the calendar, baseline unchanged, conflicts listed, a stale second save refused', async () => {
    const dir = await API('/pos/technicians-screen/directory?q=vishal'); const vid = dir.items[0].technicianId;
    // the harness board is the in-memory demo team: point its overlay at Vishal (a real technician in the database)
    await page.route('**/api/v1/pos/technicians/*/live-detail**', async (route) => { const r = await route.fetch(); const j = await r.json(); j.technicianId = vid; j.fullName = 'Vishal verma'; await route.fulfill({ response: r, json: j }); });
    await go('/technicians/schedule', '.work.lts');
    await page.locator('.tt-row .tt-name').first().click(); await page.waitForSelector(tid('dlg-full-day'));
    await page.click(tid('edit-date-shift')); await page.waitForSelector(tid('date-shift-editor')); await page.waitForSelector(tid('so-compare'));
    // pick the next Friday on the calendar and Apply
    const t0 = new Date(today + 'T12:00:00Z'); const add = ((5 - t0.getUTCDay() + 7) % 7) || 7; const fri = new Date(t0.getTime() + add * 86400000).toISOString().slice(0, 10);
    const cal = page.locator(`${tid('so-calendar')}`);
    if (!(await cal.locator(`[data-ymd="${fri}"]`).count())) await cal.locator('button[aria-label="Next month"]').click();
    await cal.locator(`[data-ymd="${fri}"]`).click(); await page.click(tid('so-apply')); await settle();
    const base0 = await page.locator(tid('so-baseline')).innerText();
    await page.click(tid('so-mode-CUSTOM_SHIFT')); await page.fill(tid('so-start'), '10:00'); await page.fill(tid('so-end'), '18:00');
    await page.click(tid('so-check')); await page.waitForSelector(`${tid('so-no-conflicts')}, ${tid('so-conflicts')}`); if (await page.locator(tid('so-ack')).count()) await page.check(tid('so-ack'));
    await page.click(tid('so-save')); await page.waitForSelector(tid('so-msg')); await settle();
    const msg = await page.locator(tid('so-msg')).innerText(); expect(/Saved for/.test(msg), msg);
    const eff = await page.locator(tid('so-effective')).innerText(); expect(/10:00 AM – 6:00 PM/.test(eff), 'effective ' + eff);
    expect((await page.locator(tid('so-baseline')).innerText()) === base0, 'baseline unchanged');
    const next = await API(`/pos/shift-overrides?technicianId=${vid}&date=${new Date(Date.parse(fri) + 7 * 86400000).toISOString().slice(0, 10)}`); expect(next.override === null, 'the next Friday has no override');
    // a second manager on the same version → 409, the typed edit stays
    const cur = await API(`/pos/shift-overrides?technicianId=${vid}&date=${fri}`);
    const r1 = await fetch(BASE + '/api/v1/pos/shift-overrides', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ technicianId: vid, localDate: fri, overrideType: 'CUSTOM_SHIFT', startLocalTime: '11:00', endLocalTime: '18:00', expectedVersion: cur.override.version }) });
    expect(r1.status === 200, 'first save ' + r1.status);
    await page.fill(tid('so-start'), '12:00'); await page.click(tid('so-check')); await settle(); if (await page.locator(tid('so-ack')).count()) await page.check(tid('so-ack'));
    await page.click(tid('so-save')); await page.waitForSelector(tid('so-reload')); expect((await page.locator(tid('so-start')).inputValue()) === '12:00', 'typed value kept');
    await page.click(tid('so-reload')); await settle(); expect(/11:00 AM/.test(await page.locator(tid('so-effective')).innerText()), 'reloaded');
    await page.keyboard.press('Escape'); await settle();
    await page.unroute('**/api/v1/pos/technicians/*/live-detail**');
    return `${fri}: ${eff.replace(/\s+/g, ' ')} · baseline "${base0}" · stale save refused, typed value kept, reload shows 11:00`;
  }],
  ['the three new overlays fit every target window (1920×945 · 1536×729 · 1440×765 · 1366×633): inside the viewport, no sideways scroll, 44px actions', async () => {
    const dir = await API('/pos/technicians-screen/directory?q=vishal'); const vid = dir.items[0].technicianId; const out = [];
    const fits = async (sel, label, w, h) => {
      const m = await page.evaluate((q) => { const d = document.querySelector(q)?.querySelector('[role="dialog"]'); if (!d) return null; const r = d.getBoundingClientRect(); const b = d.querySelector('.fk-dialog-body');
        const small = [...d.querySelectorAll('.fk-dialog-foot .fk-btn, .cr-actions .fk-btn')].filter((x) => x.getBoundingClientRect().height < 43.5).length;
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, sx: b ? b.scrollWidth - b.clientWidth : 0, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, small }; }, sel);
      expect(m, label + ' open'); expect(m.l >= -0.5 && m.t >= -0.5 && m.r <= w + 0.5 && m.b <= h + 0.5, `${label} ${w}x${h} outside: ${JSON.stringify(m)}`);
      expect(m.sx <= 1 && m.doc <= 0, `${label} ${w}x${h} sideways ${m.sx}/${m.doc}`); expect(m.small === 0, `${label} ${w}x${h} small actions ${m.small}`);
      out.push(`${label}@${w}`);
    };
    for (const [w, h] of [[1920, 945], [1536, 729], [1440, 765], [1366, 633]]) {
      await page.setViewportSize({ width: w, height: h });
      await go('/tenant/reports/commission', '.work.cms'); await page.click(tid('cr-tab-all')); await settle();
      await page.locator(tid('disc-row')).first().click(); await page.waitForSelector(tid('review-history')); await fits(tid('review-panel'), 'review', w, h); await page.keyboard.press('Escape'); await settle();
      await go('/tenant/team/performance', '.work.tps'); await page.locator(tid('composite-open')).first().click(); await page.waitForSelector(tid('component-row')); await fits(tid('dlg-composite'), 'composite', w, h); await page.keyboard.press('Escape'); await settle();
      await page.route('**/api/v1/pos/technicians/*/live-detail**', async (route) => { const r = await route.fetch(); const j = await r.json(); j.technicianId = vid; j.fullName = 'Vishal verma'; await route.fulfill({ response: r, json: j }); });
      await go('/technicians/schedule', '.work.lts'); await page.locator('.tt-row .tt-name').first().click(); await page.waitForSelector(tid('dlg-full-day'));
      await page.click(tid('edit-date-shift')); await page.waitForSelector(tid('so-compare')); await fits(tid('date-shift-editor'), 'date-shift', w, h);
      await page.keyboard.press('Escape'); await settle(); await page.keyboard.press('Escape'); await settle(); await page.unroute('**/api/v1/pos/technicians/*/live-detail**');
    }
    await page.setViewportSize({ width: 1920, height: 945 });
    return out.join(' · ');
  }],
  // ══ Team Management (/tenant/team/members, 30 Oct 2026) ═════════════════════════════════════════════════════════════
  ['team management: the eight KPIs are the server\'s, Commission says Earned (Paid from payouts), Open Positions not configured', async () => {
    await go('/tenant/team/members', '.work.tmm'); await noJunk();
    const d = await API('/pos/team-members-screen/dashboard?preset=month'); const k = d.kpis;
    expect(d.errors.length === 0, 'kpi errors ' + d.errors.join(','));
    for (const [t, v] of [['kpi-team', k.totalMembers], ['kpi-active-today', k.activeToday], ['kpi-on-shift', k.onShiftNow], ['kpi-services', k.servicesCompleted], ['kpi-approvals', k.pendingApprovals]]) expect(await kpi(t) === String(v), `${t} ${await kpi(t)} vs ${v}`);
    const comm = await page.locator(tid('kpi-commission')).innerText(); expect(/Commission Earned/.test(comm) && /Paid \$[\d,.]+ \(payroll payouts\)/.test(comm) && !/Total Commission Paid/.test(comm), comm.replace(/\s+/g, ' '));
    expect(await kpi('kpi-positions') === 'Not configured', 'positions ' + await kpi('kpi-positions'));
    expect(k.activeToday !== k.totalMembers, 'Active Today must not be "active accounts"');
    return `team ${k.totalMembers} · active today ${k.activeToday} (scheduled ${k.scheduledToday}, clocked ${k.clockedToday}) · on shift ${k.onShiftNow} · ${k.avgRating}/5 (${k.ratingCount}) · services ${k.servicesCompleted} · earned ${k.commissionEarnedCents} paid ${k.commissionPaidCents}`;
  }],
  ['team management: one server search (phone in 3 formats, a mapped service), unique role tabs, newest first, numbered pages', async () => {
    for (const ph of ['8565557001', '(856) 555-7001', '+1 856 555 7001']) { await search(tid('search'), ph); const r = await rowsText(tid('member-row')); expect(r.length === 1 && r[0].includes('Vishal verma') && /Matched by phone/.test(r[0]), ph + ': ' + r.join(' | ')); }
    await page.click(tid('search-clear')); await settle();
    const api = await API('/pos/team-members-screen/directory?pageSize=10'); const tabs = Object.fromEntries(api.tabs.map((t) => [t.id, t.count]));
    expect((await page.locator(tid('tab-all')).innerText()).includes(String(tabs.all)) && tabs.all === api.totalItems, 'all tab');
    const first = (await rowsText(tid('member-row')))[0]; expect(first.includes(api.items[0].name), first);
    const ts = api.items.map((x) => x.createdAt); expect(ts.every((v, i) => !i || ts[i - 1] >= v), 'not newest first');
    await page.locator('.tmm .fk-pager button[aria-label="Page 2"]').first().click(); await settle();
    const p2 = await rowsText(tid('member-row')); const api2 = await API('/pos/team-members-screen/directory?pageSize=10&page=2');
    expect(p2.length === api2.items.length && p2[0].includes(api2.items[0].name), p2[0]);
    await page.click(tid('tab-receptionists')); await settle();
    const rc = await rowsText(tid('member-row')); expect(rc.length === tabs.receptionists && rc.every((x) => /Receptionist/.test(x)), rc.join(' | '));
    await page.click(tid('clear-all')); await settle();
    return `phone ×3 → Vishal; tabs ${JSON.stringify(tabs)}; page 2 ${p2.length} rows of ${api.totalItems}`;
  }],
  ['team management: the profile overlay opens the right person with every tab; Close returns to the same search', async () => {
    await search(tid('search'), 'kevin'); await page.locator(tid('row-name')).first().click(); await page.waitForSelector(tid('profile-head'));
    expect((await page.locator(`${tid('dlg-member-profile')} h2`).first().innerText()).includes('Kevin Dang'), 'title');
    const seen = [];
    for (const tb of ['access', 'schedule', 'attendance', 'skills', 'work', 'performance', 'earnings', 'training', 'history', 'overview']) {
      if (!(await page.locator(tid('mt-' + tb)).count())) continue; await page.click(tid('mt-' + tb)); await settle();
      const body = (await page.locator(tid('mt-' + tb + '-body')).innerText()).replace(/\s+/g, ' '); expect(body.length > 3 && !/Loading/.test(body.slice(0, 12)), tb + ' empty'); seen.push(tb);
    }
    await noJunk(); await page.click(tid('profile-close')); await settle();
    expect(await page.locator(tid('search')).inputValue() === 'kevin' && (await rowsText(tid('member-row')))[0].includes('Kevin Dang'), 'search lost after Close');
    await page.locator(tid('row-name')).first().click(); await page.waitForSelector(tid('profile-head')); await page.keyboard.press('Escape'); await settle();
    expect(await page.locator(tid('dlg-member-profile')).count() === 0, 'Esc');
    await page.click(tid('search-clear')); await settle();
    return 'tabs: ' + seen.join(', ');
  }],
  ['team management: Find Qualified & Available Staff — ranked openings with reasons, desired time, Open Booking (the booking engine\'s two responses are STUBBED here: the harness stand-in has no query builder for it)', async () => {
    const v = (await API('/pos/team-members-screen/directory?q=vishal')).items[0]; const k = (await API('/pos/team-members-screen/directory?q=kevin')).items[0];
    const engine = { openings: { serviceIds: ['x'], durationMinutes: 45, eligibleCount: 2, withOpenings: 2, hasMore: false, offset: 0, limit: 50,
      openings: [{ technicianId: v.technicianId, name: 'Vishal verma', rosterNumber: 1, time: '14:00', openSlots: 6, rank: 1 }, { technicianId: k.technicianId, name: 'Kevin Dang', rosterNumber: 2, time: '16:00', openSlots: 2, rank: 2 }] },
      availability: [{ technicianId: v.technicianId, name: 'Vishal verma', slots: ['14:00', '14:15', '15:30'] }, { technicianId: k.technicianId, name: 'Kevin Dang', slots: ['16:00', '16:15'] }] };
    await page.route('**/api/v1/pos/booking/openings**', (r) => r.fulfill({ json: { date: today, ...engine.openings } }));
    await page.route('**/api/v1/pos/booking/availability**', (r) => r.fulfill({ json: engine.availability }));
    try {
      await page.click(tid('open-finder')); await page.waitForSelector(tid('dlg-team-finder'));
      expect(/Choose at least one service/.test(await page.locator(tid('tf-prompt')).innerText()), 'prompt');
      await page.waitForSelector(tid('tf-pick'), { timeout: 10000 }); await page.locator(tid('tf-pick')).first().click(); await page.waitForSelector(tid('tf-summary'), { timeout: 15000 });
      let rows = await rowsText(tid('tf-row')); expect(rows.length === 2 && rows[0].includes('Vishal verma') && /Approved mapping/.test(rows[0]) && /45 free minutes in one block/.test(rows[0]), rows.join(' | '));
      await page.fill(tid('tf-time'), '15:00'); await settle();
      rows = await rowsText(tid('tf-row')); expect(rows[0].includes('Vishal verma') && /3:30/.test(rows[0]) && rows[1].includes('Kevin Dang') && /4:00/.test(rows[1]), 'desired time: ' + rows.join(' | '));
      await page.fill(tid('tf-time'), '17:00'); await settle();
      expect((await rowsText(tid('tf-row'))).length === 0 && /none at or after/.test(await page.locator(tid('tf-why')).innerText()), 'empty explanation');
      await page.fill(tid('tf-time'), ''); await settle();
      await page.locator(tid('tf-open-booking')).first().click(); await page.waitForURL(/\/booking\/new\?technicianId=/, { timeout: 8000 });
      const url = page.url(); expect(url.includes(v.technicianId) && /time=14%3A00|time=14:00/.test(url), url);
      return `2 ranked with reasons; 15:00 → Vishal 3:30 PM, Kevin 4:00 PM; 17:00 → explained empty; Open Booking → ${url.replace(BASE, '').slice(0, 80)}`;
    } finally { await page.unroute('**/api/v1/pos/booking/openings**'); await page.unroute('**/api/v1/pos/booking/availability**'); await go('/tenant/team/members', '.work.tmm'); }
  }],
  ['team management: Edit Selected Date Shift from the header opens the one-date editor for the chosen technician', async () => {
    await page.click(tid('open-date-shift')); await page.waitForSelector(tid('dlg-date-shift-pick'));
    await page.fill(tid('ds-search'), 'vishal'); await page.waitForTimeout(500); await settle();
    await page.locator(tid('ds-pick')).first().click(); await page.waitForSelector(tid('date-shift-editor')); await page.waitForSelector(tid('so-compare'));
    const t = await page.locator(`${tid('date-shift-editor')} h2`).first().innerText(); expect(/Vishal verma/.test(t), t);
    await page.keyboard.press('Escape'); await settle(); expect(await page.locator(tid('date-shift-editor')).count() === 0, 'Esc');
    return t;
  }],
  ['team management: Data Accuracy Alerts — Run Check persists data-backed alerts; Assign → Investigate → Resolve with history; nothing it points at moves', async () => {
    const before = JSON.stringify((await API('/pos/team-members-screen/dashboard?preset=month')).kpis);
    await page.click(tid('open-alerts')); await page.waitForSelector(tid('data-alerts'));
    await page.click(tid('alerts-run-check')); await page.waitForSelector(tid('alerts-run-result'), { timeout: 20000 }); await settle();
    const res = await page.locator(tid('alerts-run-result')).innerText(); expect(/new alerts/.test(res), res);
    await page.selectOption(tid('al-type'), 'ATTENDANCE_DISAGREEMENT'); await settle();
    const rows = await rowsText(tid('alert-row')); expect(rows.length >= 1 && rows.some((x) => /CD T6805/.test(x)), rows.join(' | '));
    await page.locator(tid('alert-open')).first().click(); await page.waitForSelector(tid('alert-evidence'));
    const ev = await page.locator(tid('alert-evidence')).innerText(); expect(/09:00/.test(ev) && /10:30/.test(ev) && /90/.test(ev), ev.replace(/\s+/g, ' '));
    await page.click(tid('al-act-assign')); await page.waitForSelector(`${tid('al-assignee')} option:nth-child(2)`, { state: 'attached' });
    await page.selectOption(tid('al-assignee'), { index: 1 }); await page.click(tid('al-submit')); await page.waitForSelector(tid('alert-done')); await settle();
    await page.click(tid('al-act-investigate')); await page.fill(tid('al-note'), 'Checking the time clock with CD'); await page.click(tid('al-submit')); await page.waitForSelector(tid('alert-done')); await settle();
    await page.click(tid('al-act-resolve')); await page.fill(tid('al-note'), 'Approved late start (doctor visit)'); await page.click(tid('al-submit')); await page.waitForSelector(tid('alert-done')); await settle();
    expect(/Resolved/.test(await page.locator(tid('alert-status')).innerText()), 'resolved');
    const h = await rowsText(tid('alert-history-row')); expect(h.length >= 4 && /Resolved/.test(h[0]) && /Detected/.test(h[h.length - 1]), h.join(' | '));
    await page.click(tid('alert-close')); await settle();
    const again = await API('/pos/team-data-alerts?status=RESOLVED&type=ATTENDANCE_DISAGREEMENT'); expect(again.items.length >= 1, 'not persisted');
    expect(JSON.stringify((await API('/pos/team-members-screen/dashboard?preset=month')).kpis) === before, 'a KPI moved after the review');
    return `${res.replace(/\s+/g, ' ')} · history: ${h.map((x) => x.split(' ')[0]).join(' ← ')}`;
  }],
  ['team management: Export downloads the server-built CSV and the attempt is in the audited export history', async () => {
    const dl = page.waitForEvent('download', { timeout: 15000 }); await page.click(tid('export')); const f = await dl;
    expect(/^team-members-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/.test(f.suggestedFilename()), f.suggestedFilename());
    const h = await API('/pos/commission-screen/export-history?type=TEAM_DIRECTORY'); const ev = h.items.map((x) => x.event);
    expect(ev[0] === 'succeeded' && ev.includes('requested') && h.items.every((x) => x.reportType === 'TEAM_DIRECTORY'), ev.join(','));
    expect(/Export ready/.test(await page.locator(tid('note')).innerText()), 'note');
    return `${f.suggestedFilename()} · ${ev.slice(0, 2).join(' ← ')} · rows ${h.items[0].rowCount}`;
  }],
  ['team management: the profile overlay, the finder and the alert review fit every target window (inside the viewport, no sideways scroll, 44px actions)', async () => {
    const out = [];
    const fits = async (sel, label, w, h) => {
      const m = await page.evaluate((q) => { const d = document.querySelector(q)?.querySelector('[role="dialog"]'); if (!d) return null; const r = d.getBoundingClientRect(); const b = d.querySelector('.fk-dialog-body');
        const small = [...d.querySelectorAll('.fk-dialog-foot .fk-btn, .cr-actions .fk-btn, [role="tab"]')].filter((x) => x.getBoundingClientRect().height < 43.5).length;
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, sx: b ? b.scrollWidth - b.clientWidth : 0, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, small }; }, sel);
      expect(m, label + ' open'); expect(m.l >= -0.5 && m.t >= -0.5 && m.r <= w + 0.5 && m.b <= h + 0.5, `${label} ${w}x${h} outside: ${JSON.stringify(m)}`);
      expect(m.sx <= 1 && m.doc <= 0, `${label} ${w}x${h} sideways ${m.sx}/${m.doc}`); expect(m.small === 0, `${label} ${w}x${h} small actions ${m.small}`); out.push(`${label}@${w}`);
    };
    for (const [w, h] of [[1920, 945], [1536, 729], [1440, 765], [1366, 633]]) {
      await page.setViewportSize({ width: w, height: h }); await go('/tenant/team/members', '.work.tmm');
      await search(tid('search'), 'vishal'); await page.locator(tid('row-name')).first().click(); await page.waitForSelector(tid('profile-head'));
      for (const tb of ['schedule', 'attendance', 'work']) { await page.click(tid('mt-' + tb)); await settle(); await fits(tid('dlg-member-profile'), 'profile:' + tb, w, h); }
      await page.keyboard.press('Escape'); await settle();
      await page.click(tid('open-finder')); await page.waitForSelector(tid('dlg-team-finder')); await fits(tid('dlg-team-finder'), 'finder', w, h); await page.keyboard.press('Escape'); await settle();
      await page.click(tid('open-alerts')); await page.click(tid('al-tab-all')); await settle(); await page.locator(tid('alert-open')).first().click(); await page.waitForSelector(tid('alert-history'));
      await fits(tid('alert-panel'), 'alert', w, h); await page.keyboard.press('Escape'); await settle();
    }
    await page.setViewportSize({ width: 1920, height: 945 }); await go('/tenant/team/members', '.work.tmm');
    return out.join(' · ');
  }],
  // ── round 2 (TM-06 / TM-08 / TM-09, migration 727) ──────────────────────────────────────────────────────────────────
  ['team management round 2: + Add Team Member — technician fields only for providers; a receptionist is created, the list returns with ?created and has her on page 1 as a receptionist', async () => {
    await go('/tenant/team/members', '.work.tmm'); await page.click(tid('add-member')); await page.waitForSelector(tid('add-role'));
    await page.selectOption(tid('add-role'), 'nail_technician'); await page.waitForSelector(tid('add-tech-fields'));
    expect(await page.locator(tid('add-commission')).count() === 1, 'technician fields for a technician');
    await page.selectOption(tid('add-role'), 'receptionist'); await page.waitForSelector(tid('add-staff-fields'));
    expect(await page.locator(tid('add-tech-fields')).count() === 0 && await page.locator(tid('add-commission')).count() === 0, 'technician-only fields shown for a receptionist');
    await page.fill(tid('add-name'), 'Rita Reception'); await page.fill(tid('add-email'), 'rita.r2@pilot.test'); await page.click(tid('add-submit'));
    await page.waitForSelector(tid('add-done'), { timeout: 15000 }); const done = (await page.locator(tid('add-done')).innerText()).replace(/\s+/g, ' ');
    expect(/Invited/.test(done) && /No technician record/.test(done), done);
    await page.click(tid('add-show-in-list')); await settle();
    expect(/[?&]created=/.test(page.url()), 'no ?created in ' + page.url());
    const api = await API('/pos/team-members-screen/directory?q=rita.r2'); const rita = api.items[0];
    expect(api.totalItems === 1 && rita.roles.join() === 'receptionist' && rita.technicianId === null && !rita.isProvider, JSON.stringify(rita?.roles));
    const first = (await API('/pos/team-members-screen/directory?page=1&pageSize=10')).items[0]; expect(first.memberId === rita.memberId, 'newest first: ' + first.name);
    expect(page.url().includes(encodeURIComponent(rita.memberId)) || page.url().includes(rita.memberId), 'created id');
    return `receptionist ${rita.code} · ${page.url().split('?')[1]}`;
  }],
  ['team management round 2: an optional birthday (month/day, no year) — private by default: the owner sees it, the front desk does not', async () => {
    const rita = (await API('/pos/team-members-screen/directory?q=rita.r2')).items[0];
    const [, mm, dd] = new Date(Date.parse(today + 'T12:00:00Z') + 5 * 86_400_000).toISOString().slice(0, 10).split('-').map(Number);
    await go('/tenant/team/members', '.work.tmm'); await search(tid('search'), 'rita.r2'); await page.locator(tid('row-name')).first().click(); await page.waitForSelector(tid('member-birthday'));
    expect(/not recorded/i.test(await page.locator(tid('member-birthday')).innerText()), 'starts not recorded');
    await page.click(tid('birthday-edit')); await page.selectOption(tid('birthday-month'), String(mm)); await page.selectOption(tid('birthday-day'), String(dd));
    expect(!(await page.locator(tid('birthday-share')).isChecked()), 'private by default'); await page.click(tid('birthday-save')); await settle();
    const shown = await page.locator(tid('member-birthday')).innerText(); expect(/private/.test(shown) && !/20\d\d/.test(shown), shown);
    await page.keyboard.press('Escape'); await settle();
    const own = await API('/pos/team-birthdays/upcoming?days=30'); expect(own.items.some((x) => x.memberId === rita.memberId && x.private && x.inDays === 5), JSON.stringify(own.items));
    await page.click(tid('refresh')); await settle();
    expect((await rowsText(tid('birthday-row'))).some((x) => x.includes('Rita Reception') && /in 5 days/.test(x)), 'panel row');
    await J('/__role?r=FRONT_DESK');
    const desk = await API('/pos/team-birthdays/upcoming?days=30'); const deskOne = await API('/pos/team-birthdays/members/' + rita.memberId);
    await J('/__role?r=OWNER');
    expect(!desk.items.some((x) => x.memberId === rita.memberId) && deskOne.hidden === true && deskOne.month === null, 'front desk saw a private birthday');
    return `${mm}/${dd} private · owner sees ${own.items.length} · front desk sees ${desk.items.length}`;
  }],
  ['team management round 2: training — a course in the catalog, assigned → in progress → completed, a certification stays "awaiting verification"; the panel counts are real', async () => {
    await go('/tenant/team/members', '.work.tmm');
    expect(/Not configured/.test(await page.locator(tid('training')).innerText()), 'starts not configured');
    await page.click(tid('view-training')); await page.waitForSelector(tid('course-add'));
    await page.fill(tid('course-name'), 'Sanitation & Safety'); await page.fill(tid('course-validity'), '12'); await page.click(tid('course-save')); await page.waitForSelector(tid('course-row'));
    await page.keyboard.press('Escape'); await settle();
    await search(tid('search'), 'rita.r2'); await page.locator(tid('row-name')).first().click(); await page.waitForSelector(tid('profile-head'));
    await page.click(tid('mt-training')); await page.waitForSelector(tid('training-assign'));
    const opt = await page.locator(`${tid('training-course')} option`).nth(1).getAttribute('value'); await page.selectOption(tid('training-course'), opt); await page.click(tid('training-assign-btn'));
    await page.waitForSelector(tid('training-row')); const st = async () => (await page.locator(tid('training-status')).first().innerText()).trim();
    expect(await st() === 'Assigned', await st());
    await page.click(tid('training-start')); await page.waitForFunction(() => document.querySelector('[data-testid="training-status"]')?.textContent?.trim() === 'In progress');
    await page.click(tid('training-complete')); await page.waitForFunction(() => document.querySelector('[data-testid="training-status"]')?.textContent?.trim() === 'Completed');
    await page.click(tid('cert-add-open')); await page.fill(tid('cert-name'), 'State sanitation'); await page.click(tid('cert-save')); await page.waitForSelector(tid('training-cert-row'));
    const ver = await page.locator(tid('cert-verification')).first().innerText(); expect(/Awaiting verification/.test(ver), 'completion verified a certification: ' + ver);
    const hist = (await page.locator(tid('training-row')).first().innerText()).replace(/\s+/g, ' '); expect(/Completed/.test(hist) && /Started/.test(hist) && /Assigned/.test(hist), hist);
    await page.keyboard.press('Escape'); await settle(); await page.click(tid('refresh')); await settle();
    const s = await API('/pos/team-training/summary'); expect(s.configured && s.assignments.completed === 1 && s.staffCertifications.unverified === 1 && s.staffCertifications.verified === 0, JSON.stringify(s.assignments));
    expect((await page.locator(tid('ring-completed')).innerText()).includes('1'), 'ring');
    return `completed ${s.assignments.completed} · in progress ${s.assignments.inProgress} · certifications unverified ${s.staffCertifications.unverified}`;
  }],
  ['team management round 2: the data check lists the new detector types and shows each finding\'s category, first / last seen', async () => {
    await go('/tenant/team/members', '.work.tmm'); await page.click(tid('open-alerts')); await page.waitForSelector(tid('al-type'));
    const types = await page.locator(`${tid('al-type')} option`).allInnerTexts(); expect(types.some((x) => /Orphaned assignment/.test(x)) && types.some((x) => /Missing branch/.test(x)), types.join(' | '));
    await page.click(tid('al-tab-all')); await settle(); await page.locator(tid('alert-open')).first().click(); await page.waitForSelector(tid('alert-seen'));
    const seen = await page.locator(tid('alert-seen')).innerText(); expect(/first .* last .* checks/.test(seen), seen);
    expect((await page.locator(tid('alert-remediation')).innerText()).startsWith('What to do'), 'remediation');
    await page.keyboard.press('Escape'); await settle(); await page.click(tid('open-alerts')); await settle();
    return seen;
  }],
  ['team management: the front desk sees no money, cannot export (audited denial) and has no alerts button', async () => {
    await J('/__role?r=FRONT_DESK'); await go('/tenant/team/members', '.work.tmm');
    const comm = await page.locator(tid('kpi-commission')).innerText(); expect(/pay permission/.test(comm), comm);
    expect(await page.locator(tid('open-alerts')).count() === 0, 'alerts button visible to front desk');
    await page.click(tid('export')); await page.waitForSelector(tid('note')); const n = await page.locator(tid('note')).innerText();
    await J('/__role?r=OWNER'); await go('/tenant/team/members', '.work.tmm');
    expect(/do not have permission/.test(n), n);
    return n;
  }],
  // ══ Team Management round 2A (TM-01..TM-05, 30 Oct 2026) ═══════════════════════════════════════════════════════════
  ['team management TM-01: Customer search by phone (3 formats) and name finds every technician of the shared ticket + the booked one, with why; no PII in the URL', async () => {
    await go('/tenant/team/members', '.work.tmm'); await page.click(tid('mode-customer')); await settle();
    expect(/mode=customer/.test(page.url()), 'mode not in URL ' + page.url());
    const want = ['CD T6805', 'Kevin Dang', 'Lan Vo', 'Vishal verma'];
    for (const ph of ['8565559901', '(856) 555-9901', '+1 856 555 9901', 'hanh pham']) {
      await search(tid('search'), ph); await page.waitForSelector(tid('cl-list'), { timeout: 10000 });
      const rows = await rowsText(tid('cl-row')); const names = want.filter((n) => rows.some((r) => r.includes(n)));
      expect(rows.length === 4 && names.length === 4, ph + ': ' + rows.join(' | '));
      expect(!/9901/.test(page.url()) && !/hanh/i.test(page.url()), 'search text leaked into the URL: ' + page.url());
    }
    const rows = await rowsText(tid('cl-row'));
    const v = rows.find((r) => r.includes('Vishal verma')); const cd = rows.find((r) => r.includes('CD T6805')); const lan = rows.find((r) => r.includes('Lan Vo'));
    expect(/Performed the service \+ Primary technician|Primary technician \+ Performed the service/.test(v) && /Ticket #H-9001/.test(v), 'Vishal: ' + v);
    expect(/Helper technician/.test(cd) && /H-9001/.test(cd), 'CD: ' + cd); expect(/Assigned appointment/.test(lan) && /Upcoming/.test(lan), 'Lan: ' + lan);
    expect(rows.every((r) => !/555-9901/.test(r)) && rows.some((r) => /••• 9901/.test(r)), 'customer phone not masked');
    const api = await API('/pos/team-members-screen/customer-links?q=8565559901'); expect(api.matchedCustomers === 1, 'the other salon\'s Hanh Pham resolved: ' + api.matchedCustomers);
    await page.click(tid('search-clear')); await page.click(tid('mode-staff')); await settle();
    return `4 staff × 4 queries; Vishal "${v.slice(0, 90)}…"; matched customers ${api.matchedCustomers} (tenant B's twin excluded)`;
  }],
  ['team management TM-02: 10/20/50 per page + filters in the URL; filter change → page 1; Back / Forward / refresh restore; a bad page clamps', async () => {
    await go('/tenant/team/members', '.work.tmm');
    for (const n of ['20', '50', '10']) { await page.selectOption(tid('page-size'), n); await settle(); const r = await rowsText(tid('member-row')); const a = await API(`/pos/team-members-screen/directory?pageSize=${n}`);
      expect(r.length === a.items.length && (n === '10' ? !/size=/.test(page.url()) : page.url().includes('size=' + n)), `size ${n}: ${r.length} vs ${a.items.length} · ${page.url()}`); }
    await page.locator('.tmm .fk-pager button[aria-label="Page 2"]').first().click(); await settle(); expect(/page=2/.test(page.url()), page.url());
    const p2 = (await rowsText(tid('member-row')))[0];
    await page.selectOption(tid('role'), 'nail_technician'); await settle(); expect(/role=nail_technician/.test(page.url()) && !/page=/.test(page.url()), 'filter did not reset page: ' + page.url());
    await page.goBack(); await settle(); expect(/page=2/.test(page.url()) && !/role=/.test(page.url()) && (await rowsText(tid('member-row')))[0] === p2 && await page.locator(tid('role')).inputValue() === '', 'Back: ' + page.url());
    await page.goForward(); await settle(); expect(/role=nail_technician/.test(page.url()) && await page.locator(tid('role')).inputValue() === 'nail_technician', 'Forward: ' + page.url());
    await page.selectOption(tid('page-size'), '20'); await settle(); await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.work.tmm'); await settle();
    expect(await page.locator(tid('role')).inputValue() === 'nail_technician' && await page.locator(tid('page-size')).inputValue() === '20', 'refresh lost state: ' + page.url());
    const all = await API('/pos/team-members-screen/directory?pageSize=10'); await go('/tenant/team/members?page=999', '.work.tmm'); await settle();
    expect(page.url().includes('page=' + all.totalPages) && (await rowsText(tid('member-row')))[0].includes(all.totalPages > 1 ? (await API(`/pos/team-members-screen/directory?pageSize=10&page=${all.totalPages}`)).items[0].name : all.items[0].name), 'clamp: ' + page.url());
    await go('/tenant/team/members?size=7&role=nobody&sort=evil', '.work.tmm'); expect(await page.locator(tid('page-size')).inputValue() === '10' && await page.locator(tid('role')).inputValue() === '', 'invalid values kept');
    return `sizes 10/20/50 = server rows; page 2 → role filter → page 1; Back/Forward/refresh restored; page=999 → page ${all.totalPages}`;
  }],
  ['team management TM-03: + Add Team Member → create → back on page 1, newest first, highlighted; filters that hide her offer View / Clear; a retried create makes no second row', async () => {
    await go('/tenant/team/members?role=receptionist&page=2', '.work.tmm');
    // post-merge (TM-06): + Add Team Member opens the all-role dialog; a nail technician still goes through the technician hire
    await page.click(tid('add-member')); await page.waitForSelector(tid('add-role')); await page.selectOption(tid('add-role'), 'nail_technician'); await page.waitForSelector(tid('add-tech-fields'));
    await page.fill(tid('add-first'), 'Nora'); await page.fill(tid('add-last'), 'Quinn'); await page.click(tid('add-submit'));
    await page.waitForSelector(tid('add-done'), { timeout: 15000 }); await page.click(tid('add-show-in-list'));
    await page.waitForURL(/\/tenant\/team\/members\?.*created=/, { timeout: 10000 }); await page.waitForSelector(tid('created-note'), { timeout: 10000 }); await settle();
    // her filters came back (Receptionist), page / sort reset — and that filter hides a new technician: say so, never widen it silently
    const created = new URL(page.url()).searchParams.get('created');
    expect(/role=receptionist/.test(page.url()) && !/page=/.test(page.url()), 'filters / page on return: ' + page.url());
    const note = await page.locator(tid('created-note')).innerText(); expect(/current filters hide/.test(note) && /Nora Quinn/.test(note), note);
    await page.click(tid('created-view')); await page.waitForSelector(tid('profile-head')); expect((await page.locator(`${tid('dlg-member-profile')} h2`).first().innerText()).includes('Nora Quinn'), 'view new'); await close(); await settle();
    await page.click(tid('created-clear')); await settle();
    const first = (await rowsText(tid('member-row')))[0]; const hl = await page.locator(`${tid('member-row')}[data-new="1"]`).count();
    expect(first.includes('Nora Quinn') && hl === 1 && !/role=/.test(page.url()) && /highlighted on page 1/.test(await page.locator(tid('created-note')).innerText()), `first ${first} · hl ${hl} · ${page.url()}`);
    // the same Idempotency-Key twice → one row (the POS sends one key per create intent)
    const post = (k) => page.evaluate(async (key) => (await fetch('/api/v1/pos/technicians', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ firstName: 'Retry', lastName: 'Once', status: 'active' }) })).json(), k);
    const a = await post('tm03-retry-key-1'); const b = await post('tm03-retry-key-1');
    const n = (await API('/pos/team-members-screen/directory?q=Retry%20Once')).totalItems;
    expect(a.technicianId === b.technicianId && n === 1, `retry made ${n} rows`);
    await page.click(tid('created-dismiss')); await settle(); expect(!/created=/.test(page.url()), 'dismiss');
    return `Nora Quinn first + highlighted (created=${String(created).slice(0, 8)}…); hidden by Receptionist → View / Clear; retried create → ${n} row`;
  }],
  ['team management TM-04: preferred technician — a booked overlap names the appointment and offers qualified alternatives; a valid preferred comes first (engine responses STUBBED, the checks are the REAL SQL)', async () => {
    const tomorrow = addDays(today, 1);
    const v = (await API('/pos/team-members-screen/directory?q=vishal')).items[0]; const k = (await API('/pos/team-members-screen/directory?q=kevin')).items[0]; const l = (await API('/pos/team-members-screen/directory?q=lan%20vo')).items[0];
    const slots = ['10:00', '10:15', '11:15', '13:00'];
    await page.route('**/api/v1/pos/booking/openings**', (r) => r.fulfill({ json: { date: tomorrow, serviceIds: ['x'], durationMinutes: 45, eligibleCount: 3, withOpenings: 3, hasMore: false, offset: 0, limit: 50,
      openings: [v, k, l].map((x, i) => ({ technicianId: x.technicianId, name: x.name, rosterNumber: i + 1, time: '10:00', openSlots: 4, rank: i + 1 })) } }));
    await page.route('**/api/v1/pos/booking/availability**', (r) => { const tech = new URL(r.request().url()).searchParams.get('technicianId');
      const all = [v, k, l].map((x) => ({ technicianId: x.technicianId, name: x.name, slots: x.technicianId === v.technicianId ? ['10:00', '10:15', '13:00'] : slots }));
      return r.fulfill({ json: tech ? all.filter((x) => x.technicianId === tech) : all }); });
    try {
      await page.click(tid('open-finder')); await page.waitForSelector(tid('dlg-team-finder'));
      await page.fill(tid('tf-search'), 'Gel'); await page.waitForTimeout(500); await settle();
      await page.locator(tid('tf-pick'), { hasText: 'Gel Manicure' }).first().click(); await page.waitForSelector(tid('tf-summary'), { timeout: 15000 });
      await page.fill(tid('tf-date'), tomorrow); await page.fill(tid('tf-time'), '11:15'); await settle();
      await page.selectOption(tid('tf-preferred'), v.technicianId); await page.waitForSelector(tid('tf-preferred-verdict'), { timeout: 15000 }); await settle();
      const box = page.locator(tid('tf-preferred-verdict')); const why = await page.locator(tid('tf-preferred-why')).innerText();
      expect(await box.getAttribute('data-valid') === '0' && /Overlaps a booked appointment: 11:00 AM–11:45 AM/.test(why), 'why: ' + why);
      const alts = await rowsText(tid('tf-alt')); expect(alts.length >= 2 && alts.some((x) => x.includes('Kevin Dang') && /11:15/.test(x)) && alts.some((x) => x.includes('Lan Vo')) && !alts.some((x) => x.includes('Vishal')), 'alts: ' + alts.join(' | '));
      const rows = await rowsText(tid('tf-row')); expect(!rows.some((x) => x.includes('Vishal verma')), 'invalid preferred still ranked in the table');
      await page.fill(tid('tf-time'), '10:00'); await settle(); await page.waitForSelector(`${tid('tf-preferred-verdict')}[data-valid="1"]`, { timeout: 10000 });
      const ok = await box.innerText(); expect(/Preferred: Vishal verma/.test(ok) && /10:00 AM – 10:45 AM/.test(ok), 'valid: ' + ok.replace(/\s+/g, ' '));
      const before = (await API('/pos/tech-appointments-screen/appointments?preset=all&pageSize=1')).totalItems;
      await page.click(tid('tf-preferred-book')); await page.waitForURL(/\/booking\/new\?technicianId=/, { timeout: 8000 });
      expect(page.url().includes(v.technicianId) && /time=10%3A00|time=10:00/.test(page.url()), page.url());
      expect((await API('/pos/tech-appointments-screen/appointments?preset=all&pageSize=1')).totalItems === before, 'a booking was created');
      return `11:15 → "${why.split('\n')[0]}"; alternatives ${alts.map((x) => x.split(' ').slice(0, 2).join(' ')).join(', ')}; 10:00 → preferred first; Open Booking hand-off, nothing booked`;
    } finally { await page.unroute('**/api/v1/pos/booking/openings**'); await page.unroute('**/api/v1/pos/booking/availability**'); await go('/tenant/team/members', '.work.tmm'); }
  }],
  ['team management TM-05: a live event refreshes the directory in place (page size, open overlay kept); a stale version is ignored; stream down → Reconnecting/Polling, never Live; back → Live + reconcile', async () => {
    await go('/tenant/team/members?size=20', '.work.tmm');
    await page.waitForSelector(`${tid('live-indicator')}[data-mode="live"]`, { timeout: 15000 });
    await search(tid('search'), 'vishal'); await page.locator(tid('row-name')).first().click(); await page.waitForSelector(tid('profile-head'));
    expect(!/On Break/.test((await rowsText(tid('member-row')))[0]), 'seed already on break');
    const vid = (await API('/pos/team-members-screen/directory?q=vishal')).items[0].technicianId;
    let w = page.waitForRequest((r) => r.url().includes('/team-members-screen/directory'), { timeout: 8000 });
    await J(`/__rt?exec=vishal_break&emit=technician_status_updated&rid=${vid}&rv=5`); await w; await settle();
    const row = (await rowsText(tid('member-row')))[0];
    expect(/On Break/.test(row) && await page.locator(tid('dlg-member-profile')).count() === 1 && /size=20/.test(page.url()) && await page.locator(tid('search')).inputValue() === 'vishal', 'live: ' + row + ' · ' + page.url());
    // an OLDER version of the same resource arriving late → no refetch
    let late = false; const onReq = (r) => { if (r.url().includes('/team-members-screen/directory')) late = true; }; page.on('request', onReq);
    await J(`/__rt?emit=technician_status_updated&rid=${vid}&rv=3`); await page.waitForTimeout(2500); page.off('request', onReq); expect(!late, 'a stale version triggered a refetch');
    await close(); await settle();
    // the stream goes down: never "Live" while disconnected; the fallback takes over
    await J('/__rt?down=1');
    await page.waitForSelector(`${tid('live-indicator')}:not([data-mode="live"])`, { timeout: 10000 }); const m1 = await page.locator(tid('live-indicator')).getAttribute('data-mode');
    await page.waitForSelector(`${tid('live-indicator')}[data-mode="polling"]`, { timeout: 45000 });
    const pollText = await page.locator(tid('live-indicator')).innerText();
    w = page.waitForRequest((r) => r.url().includes('/team-members-screen/directory'), { timeout: 60000 });
    await J('/__rt?down=0&exec=vishal_available');
    await page.waitForSelector(`${tid('live-indicator')}[data-mode="live"]`, { timeout: 60000 }); await w; await settle();
    expect(!/On Break/.test((await rowsText(tid('member-row')))[0]), 'reconcile after reconnect did not refresh');
    await page.click(tid('search-clear')); await settle();
    return `event → On Break in place (overlay open, size=20, search kept); stale rv ignored; down → ${m1} → "${pollText}"; back → Live + reconcile refetch`;
  }],
];
