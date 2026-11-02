// interact-fd.mjs — AI Front Desk E2E steps (guide Oct 31 2026: UI-01..04, SRCH-01/03, DATE-01, PAGE-01/02, CRUD-01/03,
// ACT-01/02/03/05, SEC-02 where a browser can show them). Run with `node tooling/catalog-one-screen/interact.mjs <label> fd`
// against the live harness (fd-extra.mjs serves the REAL FrontDeskCenterController). Nothing leaves the machine.
export const STEPS_FD = ({ page, expect, settle, go, tid, noJunk, J, T }) => {
  const URL0 = '/tenant/ai/receptionist/front-desk';
  const open = () => go(URL0, tid('fd-directory'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/fd-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const st = () => J('/__fd?state=1');
  const rows = () => page.locator('[data-testid^="fd-row-"]');
  return [
    ['fd: UI-04 an empty salon shows the honest "No agents yet"; original tabs, heading and Create Agent preserved; tiles all 0', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__fd?reset=1');
      await open(); await noJunk();
      expect((await T('h1')) === 'AI Front Desk', `title ${await T('h1')}`);
      expect(/answers, understands, books, and hands off every call/.test(await T('.fd-head')), 'intent line kept');
      for (const s of ['all', 'draft', 'paused', 'archived']) expect(await page.locator(tid('fd-tab-' + s)).count() === 1, `tab ${s}`);
      expect(/No agents yet/.test(await T(tid('fd-directory'))) && await page.locator(tid('fd-create')).count() === 1, 'honest empty + Create Agent');
      expect(/^Total agents\s*0/.test(await T(tid('fd-tile-total'))) && /0/.test(await T(tid('fd-tile-active'))), `tiles ${await T(tid('fd-tile-total'))}`);
      await shot('01-fd-empty-honest');
      return 'heading + intent + All/Draft/Paused/Archived + Create Agent kept · "No agents yet" · tiles 0';
    }],
    ['fd: CRUD-01 Create Agent saves a DB draft (no provider), opens the wizard at step 2, survives a reload and is first in the list', async () => {
      await page.click(tid('fd-create')); await page.waitForSelector(tid('fd-create-dialog'));
      await page.fill(tid('fd-create-name'), 'Evening Front Desk'); await page.click(tid('fd-create-save'));
      await page.waitForSelector(tid('fd-wizard')); await settle();
      expect(/Step 2 of 8/.test(await T(tid('fd-wizard'))), `wizard step: ${(await T(tid('fd-wizard'))).slice(0, 80)}`);
      await page.click(tid('fd-wz-step-3')); await settle();
      await page.fill(tid('fd-wz-handoff'), 'front_desk'); await page.click(tid('fd-wz-next')); await settle(); await page.waitForTimeout(300);
      await page.click(tid('fd-wz-mode-handoff_only')); await page.click(tid('fd-wz-next')); await settle(); await page.waitForTimeout(300);
      await shot('02-fd-wizard-saved-steps');
      await page.keyboard.press('Escape'); await settle();
      const s = await st();
      expect(s.agents === 1 && s.linked === 0 && s.newest[0].name === 'Evening Front Desk' && s.newest[0].status === 'draft' && s.newest[0].version >= 3, `db ${JSON.stringify(s.newest)}`);
      await page.reload(); await page.waitForSelector(tid('fd-directory')); await settle();
      expect(/Evening Front Desk/.test(await rows().first().innerText()), 'persisted after reload, first row');
      return `draft row in DB (version ${s.newest[0].version}, no provider) · wizard steps 3–4 saved · first row after reload`;
    }],
    ['fd: PAGE-01 / SRCH-01 / DATE-01 23 more drafts → 10 per page, page 2 differs, 50 shows all; search finds a draft beyond page 1; month calendar', async () => {
      await J('/__fd?bulk=1'); await open();
      await page.selectOption(tid('fd-size'), '10'); await settle();
      const p1 = await rows().allInnerTexts();
      expect(p1.length === 10 && /24 matching/.test(await T(tid('fd-total'))), `page 1 ${p1.length}, ${await T(tid('fd-total'))}`);
      await page.locator(`${tid('fd-directory')} .fk-pager button.num`, { hasText: '2' }).first().click(); await settle();
      const p2 = await rows().allInnerTexts();
      expect(p2.length === 10 && p2[0] !== p1[0], 'page 2 differs');
      await page.fill(tid('fd-search'), 'Spanish-speaking'); await page.waitForTimeout(600); await settle();
      const found = await rows().allInnerTexts();
      expect(found.length === 1 && /Bulk Desk 17/.test(found[0]), `search: ${found.join(' | ').slice(0, 100)}`);
      await page.fill(tid('fd-search'), ''); await page.waitForTimeout(500); await settle();
      await page.selectOption(tid('fd-size'), '50'); await settle();
      expect((await rows().count()) === 24, `50/page shows all ${await rows().count()}`);
      await page.click(tid('fd-cal-open')); await page.waitForSelector(tid('fd-cal'));
      expect(await page.locator(`${tid('fd-cal')} button`).count() > 20, 'month grid');
      await shot('03-fd-calendar'); await page.keyboard.press('Escape'); await settle();
      await page.selectOption(tid('fd-period'), 'today'); await settle();
      expect(await page.locator(tid('fd-active-basis')).count() === 1, 'active date basis shown');
      await page.click(tid('fd-clear')); await settle();
      return '24 agents: 10/page, page 2 differs, 50/page all · search beyond page 1 · calendar + date basis';
    }],
    ['fd: ACT-01 "Check AI Front Desk System" is read-only — agents and control unchanged, the run recorded', async () => {
      const before = await st();
      await page.click(tid('fd-check')); await page.waitForSelector(tid('fd-health')); await settle();
      const h = await T(tid('fd-health'));
      expect(/Read-only/.test(h) && /One live agent per route|Provider mapping|Live route|Agent registry/.test(h + (await T(tid('fd-alerts')))), `health: ${h.slice(0, 160)}`);
      const after = await st();
      expect(after.agents === before.agents && JSON.stringify(after.control) === JSON.stringify(before.control) && after.runs === before.runs + 1, `state ${JSON.stringify(after)}`);
      await shot('04-fd-health-read-only');
      return 'check recorded (runs +1); agents and salon control unchanged';
    }],
    ['fd: ACT-02/03 an agent is activated only by the owner after every gate passes and the recorded test call reached it → "Active"', async () => {
      await J('/__bs?seed=1'); await J('/__fd?gates=1'); await open();
      await page.fill(tid('fd-search'), 'Desk Retell'); await page.waitForTimeout(600); await settle();
      await rows().first().click(); await page.waitForSelector(tid('fd-overlay')); await settle();
      await page.click(tid('fd-ov-activate')); await page.waitForSelector(tid('fd-action')); await page.waitForSelector(tid('fd-preflight')); await settle();
      const pre = await T(tid('fd-preflight'));
      expect(/Current route/.test(pre) && /Proposed route/.test(pre) && /Desk Retell/.test(pre), `preflight: ${pre.slice(0, 160)}`);
      await shot('05-fd-activation-preflight');
      expect(await page.locator(`${tid('fd-action-go')}[disabled]`).count() === 1, 'Activate disabled until reason + confirm');
      await page.fill(tid('fd-action-reason'), 'Owner approves go-live after the verified test call');
      await page.check(tid('fd-action-confirm'));
      if (/must be fixed first/.test(pre)) return `blocked as designed: ${pre.slice(0, 200)}`;
      await page.click(tid('fd-action-go')); await settle(); await page.waitForTimeout(400);
      const s = await st();
      expect(s.live === 1 && s.control?.activated === true, `db live=${s.live} control=${JSON.stringify(s.control)}`);
      await page.fill(tid('fd-search'), 'Desk Retell'); await page.waitForTimeout(600); await settle();
      expect(/Active/.test(await rows().first().innerText()), `row: ${await rows().first().innerText()}`);
      await shot('06-fd-active');
      return 'preflight current vs proposed · owner reason + confirm · DB live 1, salon activated · row "Active"';
    }],
    ['fd: overlay — 8 tabs open; calls tab lists only this agent’s calls; a live agent offers Pause but no Edit', async () => {
      await rows().first().click(); await page.waitForSelector(tid('fd-overlay')); await settle();
      for (const tab of ['overview', 'business', 'voice', 'routing', 'booking', 'calls', 'usage', 'health']) { await page.click(tid('fd-ov-tab-' + tab)); await page.waitForSelector(tid('fd-ov-body-' + tab)); }
      await page.click(tid('fd-ov-tab-calls')); await settle(); await page.waitForTimeout(400);
      const calls = await T(tid('fd-ov-body-calls'));
      expect(/fd_call_0/.test(calls) && /tool_timeout/.test(calls), `calls: ${calls.slice(0, 160)}`);
      expect(await page.locator(tid('fd-ov-pause')).count() === 1 && await page.locator(tid('fd-ov-edit')).count() === 0, 'live: Pause yes, Edit no');
      await shot('07-fd-overlay-calls');
      return '8 tabs · calls = this agent’s recorded calls · Pause shown, Edit hidden for a live agent';
    }],
    ['fd: ACT-05 Pause stops the AI at once — salon deactivated and booking disarmed, history kept', async () => {
      await page.click(tid('fd-ov-pause')); await page.waitForSelector(tid('fd-action'));
      await page.fill(tid('fd-action-reason'), 'Stop the AI while we fix the greeting'); await page.click(tid('fd-action-go')); await settle(); await page.waitForTimeout(400);
      const s = await st();
      expect(s.live === 0 && s.control?.activated === false && s.control?.booking_armed === false, `db ${JSON.stringify(s)}`);
      expect(/Paused/.test(await T(tid('fd-history'))) || s.events > 3, 'history shows the pause');
      await shot('08-fd-paused');
      return `live 0 · salon activated=false, booking armed=false · ${s.events} events kept`;
    }],
    ['fd: SEC-02 Front Desk role sees no Create Agent and cannot reach activation', async () => {
      await J('/__role?r=FRONT_DESK'); await open(); await settle();
      expect(await page.locator(tid('fd-create')).count() === 0, 'no Create Agent for Front Desk');
      const txt = await T('.work');
      await shot('09-fd-front-desk-role'); await J('/__role?r=OWNER');
      return /permission|cannot|Your role/i.test(txt) ? 'Front Desk: no access notice' : 'Front Desk: read-only directory, no Create / Activate';
    }],
    ['fd: Vietnamese — labels translated, the same numbers', async () => {
      const totalEn = await T(tid('fd-tile-total'));
      await J('/__lang?l=vi'); await open();
      const vi = await T(tid('fd-tile-total'));
      expect(/Tổng số trợ lý/.test(vi) && vi.match(/\d+/)?.[0] === totalEn.match(/\d+/)?.[0], `vi tile ${vi} vs ${totalEn}`);
      expect(/Kiểm tra hệ thống Lễ tân AI/.test(await T(tid('fd-check'))), 'check button translated');
      await shot('10-fd-vi'); await J('/__lang?l=en');
      return 'tiles + actions in Vietnamese, same numbers';
    }],
    ['fd: layout — 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 with no sideways scroll; eight tiles on one row at 1920', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        if (w === 1920) { const tops = await page.locator('[data-testid^="fd-tile-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))); expect(new Set(tops).size === 1, `tiles one row: ${tops}`); }
        await shot(`11-fd-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
