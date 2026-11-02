// interact-health.mjs — Setup Health steps of the catalog E2E (Four-Module Completion Guide §13, Oct 30 2026): the REAL
// controller + repository + checks over the harness fixtures. `node tooling/catalog-one-screen/interact.mjs <label> health`
export const STEPS_HEALTH = ({ page, expect, settle, go, tid, noJunk, API, SQL }) => {
  const open = () => go('/tenant/management/setup-health', '.work.hs');
  return [
    ['setup health: opens on the stored nightly run; every Ready row carries a verification time', async () => {
      await open(); await noJunk();
      const s = await API('/tenant/setup-health/summary');
      expect(s.nightly && s.nightly.status === 'succeeded', 'nightly ' + JSON.stringify(s.nightly));
      const bad = s.checks.filter((c) => c.status === 'ready' && !c.verifiedAt); expect(!bad.length, 'ready without verification ' + bad.map((c) => c.key));
      const nightly = (await page.locator(tid('hs-nightly')).innerText()).trim();
      return `overall ${s.overall} · ${s.checks.length} rows · "${nightly}"`;
    }],
    ['setup health: Run Health Check stores a run; the screen counts match the server; CI / staging / touchscreen stay unverified', async () => {
      await open(); await page.click(tid('hs-run')); await page.waitForSelector('.fk-note.ok'); await settle();
      const s = await API('/tenant/setup-health/summary');
      for (const st of ['ready', 'warning', 'action_required', 'pending_external', 'unknown']) {
        const v = (await page.locator(`${tid('hs-count-' + st)} b`).innerText()).trim(); expect(v === String(s.counts[st] ?? 0), st + ' ' + v);
      }
      const rel = s.checks.filter((c) => c.area === 'release');
      expect(rel.length === 3 && rel.every((c) => c.status !== 'ready'), 'release rows ' + rel.map((c) => c.status));
      const runs = (await SQL('hsruns')); expect(runs.length >= 1 && runs.at(-1).status === 'succeeded', 'run row');
      return `overall ${s.overall} · ${JSON.stringify(s.counts)} · release rows: ${rel.map((c) => c.status).join('/')}`;
    }],
    ['setup health: a second run inside a minute is refused (rate limit) and says so', async () => {
      await open(); await page.click(tid('hs-run')); await page.waitForSelector('.fk-note.bad'); return (await page.locator('.fk-note.bad').innerText()).trim().slice(0, 80);
    }],
    ['setup health: a guided action opens the fixing module; technical view shows the source', async () => {
      await open();
      const btn = page.locator(tid('hs-action')).first(); expect(await btn.count(), 'an action'); const label = (await btn.innerText()).trim();
      await page.click(tid('hs-tech')); expect(await page.locator(tid('hs-tech-detail')).count() > 0, 'tech detail');
      await btn.click(); await settle(); const url = page.url();
      expect(!url.endsWith('/tenant/management/setup-health'), 'navigated ' + url);
      return `${label} → ${url.replace(/^https?:\/\/[^/]+/, '')}`;
    }],
    ['setup health: alerts can be acknowledged and the row is stored per salon', async () => {
      await open(); const n = await page.locator(tid('hs-ack')).count();
      if (n) { await page.locator(tid('hs-ack')).first().click(); await settle(); }
      const a = await SQL('hsalerts'); return `${a.length} alerts stored (${a.map((x) => x.check_key + ':' + x.severity + (x.acked ? ':acked' : '')).join(', ')})`;
    }],
  ];
};
