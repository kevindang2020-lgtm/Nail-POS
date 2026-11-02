// interact-aic.mjs — AI Calls E2E steps (guide Oct 31 2026, §22 where a browser can show them). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> aic` against the live harness (aic-extra.mjs serves the REAL
// AiCallsCenterController and seeds calls through the REAL provider-event merge). Nothing leaves the machine.
export const STEPS_AIC = ({ page, expect, settle, go, tid, noJunk, J, T }) => {
  const URL0 = '/tenant/ai/receptionist/calls';
  const open = (qs = '') => go(URL0 + qs, tid('aic-calls'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/aic-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const st = () => J('/__aic?state=1');
  const closeDlg = async () => { await page.keyboard.press('Escape'); await settle(); };
  const num = (s) => (String(s).match(/\d+/) ?? [''])[0];
  return [
    ['aic: P0 — no calls and no signing key: an honest empty state that says WHY, and the check shows each dependency separately', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__rcp?reset=1'); await J('/__aic?reset=1'); await J('/__aic?env=none');
      await open(); await noJunk();
      expect((await T('h1')) === 'Calls' && /Every call the AI receptionist handled/.test(await T('.aic-head')), 'original title + subtitle kept');
      const empty = await T(tid('aic-calls'));
      expect(/No calls yet/.test(empty) && /honest only if the AI answered no calls/.test(empty), `empty state: ${empty.slice(0, 160)}`);
      expect((await T(tid('aic-kpi-total'))).includes('0') && /—/.test(await T(tid('aic-kpi-bookings'))) && /—/.test(await T(tid('aic-kpi-avg'))), 'unknown shown as — not 0');
      await page.click(tid('aic-check')); await page.waitForSelector(tid('aic-check-webhook_signing'));
      expect(/Not configured/.test(await T(tid('aic-check-webhook_signing'))) && /Not configured/.test(await T(tid('aic-check-history'))), 'webhook + history not configured');
      expect(!/harness-signing-key/.test(await T(tid('aic-health'))), 'no secret shown');
      await shot('01-aic-empty-why'); await closeDlg();
      return 'title/subtitle preserved · empty state explains · signing key + history: Not configured';
    }],
    ['aic: signed provider events → history; summary cards equal an independent SQL count; AI-reported vs verified bookings', async () => {
      await J('/__aic?env=signed'); await J('/__aic?seed=1'); await open(); await noJunk();
      const s = await st();
      expect(num(await T(tid('aic-kpi-total'))) === String(s.total), `total card vs DB ${s.total}`);
      expect(num(await T(tid('aic-kpi-completed'))) === String(s.completed), `completed vs DB ${s.completed}`);
      expect(num(await T(tid('aic-kpi-failed'))) === String(s.failed_missed), `failed/missed vs DB ${s.failed_missed}`);
      const b = await T(tid('aic-kpi-bookings'));
      expect(/^Verified AI bookings\s*1/.test(b.replace(/\n/g, ' ')) && /AI reported booked: 2/.test(b), `bookings: ${b}`);
      expect(s.dup_rows === 1 && s.dup_deliveries === 2 && s.ooo_ok === 1, `duplicate → 1 row (2 deliveries); out-of-order converged: ${JSON.stringify(s)}`);
      await shot('02-aic-summary-history');
      return `total ${s.total} · completed ${s.completed} · failed/missed ${s.failed_missed} (= DB) · verified 1 vs AI-reported 2 · duplicate absorbed`;
    }],
    ['aic: history — newest first, 10/page, page 2 differs, search beyond page 1, stale call is Unknown, filter in URL (search text never)', async () => {
      await open();
      const rows = await page.locator(tid('aic-call-row')).allInnerTexts();
      expect(rows.length === 10 && /aic_stale/.test(rows[0]) === false, `page 1 rows ${rows.length}`);
      await page.locator(`${tid('aic-calls')} .fk-pager button.num`, { hasText: '2' }).first().click(); await settle();
      const second = await page.locator(tid('aic-call-row')).allInnerTexts();
      expect(second.length > 0 && second[0] !== rows[0], 'page 2 differs');
      await page.fill(tid('aic-search'), 'gel removal'); await page.waitForTimeout(600); await settle();
      const found = await page.locator(tid('aic-call-row')).allInnerTexts();
      expect(found.length === 1 && /aic_09/.test(found[0]), `search beyond page 1: ${found.join(' | ').slice(0, 120)}`);
      expect(!/gel/i.test(page.url()), 'search text not in the URL');
      await page.fill(tid('aic-search'), 'aic_stale'); await page.waitForTimeout(600); await settle();
      expect(await page.locator(tid('aic-status-unknown')).count() === 1, 'stale call shown as Unknown');
      await page.fill(tid('aic-search'), ''); await page.waitForTimeout(500); await settle();
      await page.selectOption(tid('aic-f-status'), 'failed'); await settle();
      expect(/status=failed/.test(page.url()), `status in URL: ${page.url()}`);
      const failed = await page.locator(tid('aic-call-row')).allInnerTexts();
      expect(failed.length === 1 && /aic_04/.test(failed[0]), `failed filter: ${failed.join(' | ').slice(0, 120)}`);
      await page.click(tid('aic-clear')); await settle();
      await page.selectOption(tid('aic-pagesize'), '20'); await settle();
      expect((await page.locator(tid('aic-call-row')).count()) === 20, '20 per page');
      await page.click(tid('aic-cal')); await page.waitForSelector(tid('aic-calendar'));
      expect(await page.locator(`${tid('aic-calendar')} button`).count() > 20, 'month grid');
      await shot('03-aic-calendar'); await closeDlg();
      return '10/page · page 2 differs · search finds aic_09 · stale = Unknown · status=failed kept in URL · 20/page · calendar';
    }],
    ['aic: overlay — tabs, failed tool ≠ booking, "booked" without proof flagged, recording honest, audited view, Close', async () => {
      const before = (await st()).views;
      await page.fill(tid('aic-search'), 'aic_05'); await page.waitForTimeout(600); await settle();
      await page.locator(tid('aic-open')).first().click(); await page.waitForSelector(tid('aic-overlay'));
      await page.click(tid('aic-tab-tools'));
      const tools = await T(tid('aic-tools'));
      expect(/create_appointment/.test(tools) && /SLOT_UNAVAILABLE/.test(tools) && /get_availability/.test(tools), `tools: ${tools.slice(0, 160)}`);
      await page.click(tid('aic-tab-booking'));
      expect(await page.locator(tid('aic-booking-note')).count() === 1, '"booked" without a linked appointment is flagged');
      await page.click(tid('aic-tab-recording'));
      expect(/no recording may be shown/.test(await T(tid('aic-recording'))), 'recording honest');
      await page.click(tid('aic-tab-audit'));
      expect(/call_started/.test(await T(tid('aic-events'))) && /Provider signature/.test(await T(tid('aic-events'))), 'event timeline with auth');
      await shot('04-aic-overlay');
      await page.click(tid('aic-ov-close')); await settle();
      expect(await page.locator(tid('aic-overlay')).count() === 0, 'closed');
      expect((await st()).views === before + 1, 'view audited');
      return 'tool failure shown · AI "booked" flagged · recording honest · events with auth · audited · closed';
    }],
    ['aic: Front Desk — transcript stays restricted; Check is read-only and recorded; Reconciliation lists the orphan event', async () => {
      await J('/__role?r=FRONT_DESK'); await page.goto('about:blank'); await open('?');
      await page.fill(tid('aic-search'), 'gel removal'); await page.waitForTimeout(600); await settle();
      await shot('05a-aic-front-desk-search');
      await page.locator(tid('aic-open')).first().click(); await page.waitForSelector(tid('aic-overlay'), { timeout: 8000 });
      await page.click(tid('aic-tab-summary'));
      expect(await page.locator(tid('aic-transcript-restricted')).count() === 1 && await page.locator(tid('aic-transcript-link')).count() === 0, 'transcript restricted');
      await page.click(tid('aic-ov-close')); await settle();
      await J('/__role?r=OWNER'); await open();
      const s0 = await st();
      await page.click(tid('aic-check')); await page.waitForSelector(tid('aic-check-webhook_signing'));
      const h = await T(tid('aic-health'));
      expect(/Blocked \(outside\)/.test(h) && /Evidence/.test(h) && /aic-/.test(h), 'distinct states with evidence + trace');
      await shot('05-aic-health');
      const s1 = await st();
      const cached = (await page.locator(tid('aic-health-cached')).count()) === 1;
      expect(cached ? s1.health_runs === s0.health_runs : s1.health_runs === s0.health_runs + 1, `run recorded once (or the 30-second cached result shown): ${s0.health_runs}→${s1.health_runs} cached=${cached}`);
      expect(s1.last_write === s0.last_write, 'no call record changed');
      await closeDlg();
      await page.click(tid('aic-recon-open')); await page.waitForSelector(tid('aic-recon'));
      expect(await page.locator(tid('aic-recon-orphan')).count() >= 1, 'orphan event listed');
      await shot('06-aic-reconciliation'); await closeDlg();
      return 'Front Desk: transcript restricted · check recorded, read-only · reconciliation shows the unresolved event';
    }],
    ['aic: Vietnamese on the Front Desk POS — labels translated, numbers unchanged', async () => {
      await open(); const en = await T(tid('aic-kpi-total'));
      await J('/__lang?l=vi'); await open();
      expect((await T('h1')) === 'Cuộc gọi', `title ${await T('h1')}`);
      const vi = await T(tid('aic-kpi-total'));
      expect(/Tổng cuộc gọi/.test(vi) && num(vi) === num(en), 'card translated, same number');
      await shot('07-aic-vi'); await J('/__lang?l=en');
      return 'title + cards in Vietnamese, same numbers';
    }],
    ['aic: layout — 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 with no sideways scroll', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        await shot(`08-aic-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
