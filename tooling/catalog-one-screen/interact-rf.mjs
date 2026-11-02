// interact-rf.mjs — Referral Program E2E steps (guide Oct 30 2026, §17–§18). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> rf` against the live harness (rf-extra.mjs serves the REAL
// ReferralProgramController; "pay" runs exactly what the checkout.completed consumer runs). Nothing leaves the machine.
export const STEPS_RF = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/marketing/referrals';
  const open = () => go(URL0, tid('rfp-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/rf-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).trim();
  const st = () => J('/__rf?state=1');
  const rows = () => page.locator(tid('rfp-row'));
  const closeDlg = async () => { if (await page.locator(tid('rfp-close')).count()) { await page.click(tid('rfp-close')); await settle(); } };
  const pickCustomer = async (name) => {
    if (await page.locator(tid('rfp-unpick')).count()) await page.click(tid('rfp-unpick'));
    await page.fill(tid('rfp-find'), name); await page.waitForSelector(tid('rfp-hit'));
    await page.locator(tid('rfp-hit'), { hasText: name }).first().click();
  };
  const recordFlow = async (code, name) => {
    await page.fill(tid('rfp-code'), code); await pickCustomer(name);
    await page.click(tid('rfp-check')); await page.waitForSelector(tid('rfp-verdict'));
    const verdict = await T(tid('rfp-verdict'));
    return verdict;
  };
  return [
    ['rf: P0 — KPIs equal the database (codes, total, pending); Rewards Paid is cash-only $0.00; the empty state is honest; no reward policy is invented', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__rf?reset=1'); await J('/__rf?seed=1');
      await open(); await noJunk();
      const s = await st();
      expect(Number(await kpiV('rfp-kpi-codes')) === s.codes, `codes KPI ${await kpiV('rfp-kpi-codes')} vs DB ${s.codes}`);
      expect(Number(await kpiV('rfp-kpi-total')) === s.referrals, `total KPI vs DB ${s.referrals}`);
      expect(Number(await kpiV('rfp-kpi-pending')) === s.pending_reward, 'pending reward = DB');
      expect((await kpiV('rfp-kpi-paid')) === '$0.00', 'Rewards Paid $0.00');
      expect(/no payout provider/i.test(await T(tid('rfp-kpi-paid'))), 'says why');
      expect(await page.locator(tid('rfp-no-policy')).count() === 1, 'no-policy hint');
      if (s.referrals === 0) expect(/No referrals recorded yet/.test(await T(tid('rfp-results'))), 'honest empty state');
      await shot('01-rf-kpis-1920');
      return `codes ${s.codes} (${s.codes_active} active) · referrals ${s.referrals} · pending ${s.pending_reward} = KPIs · Rewards Paid $0.00 (no payout provider)`;
    }],
    ['rf: Check Referral Eligibility is read-only — an unknown code and an existing customer are refused with reasons; nothing is written', async () => {
      await open(); const before = await st();
      const v1 = await recordFlow('NOPE99', 'Rf Nia');
      expect(/Not eligible/.test(v1) && /No referral code in this salon matches/.test(v1), v1);
      expect(await page.locator(tid('rfp-record-btn')).isDisabled(), 'Record disabled after a failed check');
      const v2 = await recordFlow('RFRITA', 'Rf Olga');
      expect(/Not eligible/.test(v2) && /2 completed visits/.test(v2), v2);
      const after = await st();
      expect(after.referrals === before.referrals && after.events === before.events, 'nothing written');
      await shot('02-rf-check-refused');
      return 'NOPE99 → unknown code · Olga → not a new customer (2 visits) · referrals and events unchanged';
    }],
    ['rf: Record Nia with RFRITA → ONE referral, newest first, overlay "Waiting for first visit"; the same tap again returns the same referral', async () => {
      await open(); const before = await st();
      const v = await recordFlow('rfrita', 'Rf Nia');
      expect(/Eligible to record/.test(v), v);
      await page.click(tid('rfp-record-btn')); await page.waitForSelector(tid('rfp-dialog'));
      expect(/Waiting for first visit/.test(await T(tid('rfp-dlg-state'))), await T(tid('rfp-dlg-state')));
      await shot('03-rf-recorded-overlay');
      await closeDlg();
      expect(/Rf Nia/.test(await rows().first().innerText()), 'newest first');
      // the same customer again (a second tap, a new key) → the existing referral, never a second one
      await page.fill(tid('rfp-code'), 'RFRITA'); await pickCustomer('Rf Nia'); await page.click(tid('rfp-check')); await page.waitForSelector(tid('rfp-verdict'));
      expect(/Already recorded/.test(await T(tid('rfp-verdict'))), await T(tid('rfp-verdict')));
      const after = await st();
      expect(after.referrals === before.referrals + 1 && after.states['Rf Nia'] === 'PENDING_QUALIFICATION', JSON.stringify(after.states));
      return `referrals ${before.referrals} → ${after.referrals} · Nia PENDING_QUALIFICATION · a second claim is "Already recorded"`;
    }],
    ['rf: a shared family phone is a risk signal — "can be recorded, a person must review"; recorded UNDER_REVIEW; both customers kept', async () => {
      await open();
      const v = await recordFlow('RFRITA', 'Rf Noah');
      expect(/a person must review/.test(v) && /share a phone number/.test(v), v);
      await page.click(tid('rfp-record-btn')); await page.waitForSelector(tid('rfp-dialog'));
      expect(/Under review/.test(await T(tid('rfp-dlg-state'))), 'Under review');
      await closeDlg();
      const s = await st();
      expect(s.states['Rf Noah'] === 'UNDER_REVIEW' && s.rita_noah === 2, JSON.stringify(s.states));
      return 'Noah UNDER_REVIEW (shared phone) · Rita and Noah remain two customers';
    }],
    ['rf: the first PAID visit qualifies (checkout event) — with no reward policy nothing is invented; with 50 points + approval the next one waits in Pending Reward Reviews', async () => {
      const p = await J('/__rf?pay=nia');
      expect(p.outcome === 'qualified_no_policy', JSON.stringify(p));
      await open();
      await page.click(tid('rfp-policy')); await page.waitForSelector(tid('rfp-policy-dialog'));
      await page.selectOption(tid('rfp-pol-type'), 'loyalty_points'); await page.fill(tid('rfp-pol-points'), '50');
      if (!(await page.isChecked(tid('rfp-pol-approval')))) await page.check(tid('rfp-pol-approval'));
      await page.click(tid('rfp-policy-save')); await settle();
      await open();
      expect(await page.locator(tid('rfp-no-policy')).count() === 0, 'policy set');
      await recordFlow('RFRITA', 'Rf Pia'); await page.click(tid('rfp-record-btn')); await page.waitForSelector(tid('rfp-dialog')); await closeDlg();
      const q2 = await J('/__rf?pay=pia');
      expect(q2.outcome === 'pending_approval', JSON.stringify(q2));
      await open();
      expect(/Rf Pia/.test(await T(tid('rfp-approvals'))), 'Pia in Pending Reward Reviews');
      const s = await st();
      expect(Number(await kpiV('rfp-kpi-pending')) === s.pending_reward && s.ledger === 0, `pending ${s.pending_reward} · ledger ${s.ledger}`);
      await shot('04-rf-pending-review');
      return `Nia qualified (no policy → no reward) · policy 50 pts + approval · Pia → Pending Reward Reviews · KPI pending ${s.pending_reward} · ledger 0`;
    }],
    ['rf: a manager approves → Reward issued with ONE loyalty ledger posting; the overlay shows the visit, the ledger entry and the audit trail', async () => {
      await J('/__role?r=MANAGER'); await open();
      await page.locator(tid('rfp-approval'), { hasText: 'Rf Pia' }).locator(tid('rfp-approval-open')).click(); await page.waitForSelector(tid('rfp-approve'));
      await page.click(tid('rfp-approve')); await page.waitForSelector(tid('rfp-dlg-note'));
      await page.waitForFunction(() => /Reward issued/.test(document.querySelector('[data-testid="rfp-dlg-state"]')?.textContent ?? ''), null, { timeout: 8000 });
      await page.click(tid('rfp-dtab-reward')); const rw = await T(tid('rfp-reward'));
      expect(/\+50 points/.test(rw) && /Points issued \(not cash\)/.test(rw), rw);
      await page.click(tid('rfp-dtab-visit')); expect(/\$65\.00/.test(await T(tid('rfp-visit'))), 'visit evidence');
      await page.click(tid('rfp-dtab-audit')); const au = await T(tid('rfp-audit'));
      expect(/Referral recorded/.test(au) && /Qualified by a paid visit/.test(au) && /Approved/.test(au) && /Reward issued/.test(au), au);
      await shot('05-rf-issued-overlay');
      await closeDlg(); await J('/__role?r=OWNER');
      const s = await st();
      expect(s.ledger === 1 && s.states['Rf Pia'] === 'REWARD_ISSUED', `ledger ${s.ledger} · ${s.states['Rf Pia']}`);
      return 'Pia REWARD_ISSUED · +50 points (not cash) · exactly 1 ledger entry · audit: recorded → qualified → approved → issued';
    }],
    ['rf: search by phone digits / ticket number works server-side beyond Page 1; 10 rows per page; Today preset equals the database', async () => {
      await J('/__rf?many=1'); await open();
      await page.selectOption(tid('rfp-size'), '10'); await settle();
      const s = await st();
      expect((await T(tid('rfp-count'))).includes(String(s.referrals)), `count "${await T(tid('rfp-count'))}" vs DB ${s.referrals}`);
      expect(await rows().count() === 10, `rows on page 1: ${await rows().count()}`);
      await search(tid('rfp-search'), '9110');   // Rf Many10's phone digits — on page 2 of the unfiltered list
      const n = (await rows().allInnerTexts()).join(' | ');
      expect(/Rf Many10/.test(n) && (await rows().count()) === 1 && /referred/.test(n), n);
      await search(tid('rfp-search'), '');
      await page.click(tid('rfp-preset-today')); await settle();
      expect((await T(tid('rfp-count'))).includes(String(s.today)) && (await T(tid('rfp-basis-note'))).includes('Referral recorded'), `${await T(tid('rfp-count'))} vs today ${s.today}`);
      await page.click(tid('rfp-clear')); await settle();
      await shot('06-rf-search-paging');
      return `total ${s.referrals} (pages of 10) · "9110" → Rf Many10 (matched as referred) · Today = ${s.today}`;
    }],
    ['rf: Check Referral System changes nothing and is not a false green', async () => {
      await open(); const before = await st();
      await page.click(tid('rfp-health')); await page.waitForSelector(tid('rfp-health-overall'));
      const overall = await T(tid('rfp-health-overall'));
      const ledger = await T(tid('rfp-h-ledger_issuance'));
      expect(/Ready/.test(ledger) && /matched to exactly one loyalty ledger entry/.test(ledger), ledger);
      expect(/Attention required|Ready/.test(overall), overall);
      await shot('07-rf-health');
      await page.keyboard.press('Escape'); await settle();
      const after = await st();
      expect(after.events === before.events && after.ledger === before.ledger, 'non-mutating');
      return `overall "${overall}" · ledger issuance Ready · events / ledger unchanged`;
    }],
    ['rf: the Referral Growth Assistant previews without sending and saves only an UNSENT audience', async () => {
      await open(); const before = await st();
      await page.click(tid('rfp-assistant')); await page.waitForSelector(tid('rfp-asst-preview'));
      await page.click(tid('rfp-asst-preview')); await page.waitForSelector(tid('rfp-asst-plan'));
      const plan = await T(tid('rfp-asst-plan'));
      expect(/selected · \d+ eligible · \d+ excluded/.test(plan) && /Preview only — nothing is sent/.test(plan), plan.slice(0, 200));
      await page.click(tid('rfp-asst-save')); await page.waitForSelector(tid('rfp-asst-saved'));
      const after = await st();
      expect(after.drafts === before.drafts + 1 && after.notifications === before.notifications, `drafts ${before.drafts} → ${after.drafts} · notifications ${after.notifications}`);
      await shot('08-rf-assistant');
      await page.keyboard.press('Escape'); await settle();
      return `preview → audience counts with reasons · save → 1 unsent audience · notifications unchanged (${after.notifications})`;
    }],
    ['rf: Front Desk has no marketing access — the page says so and the API refuses', async () => {
      await J('/__role?r=FRONT_DESK'); await go(URL0, 'h1');
      const txt = await T('.work');
      const r = await page.evaluate(async () => (await fetch('/api/v1/pos/referral-program/summary')).status);
      await J('/__role?r=OWNER');
      expect(/cannot view the Referral Program/.test(txt) && r === 403, `front desk: "${txt.slice(0, 80)}" · API ${r}`);
      return 'Front Desk: no-access notice · GET /pos/referral-program/summary → 403';
    }],
    ['rf: Vietnamese POS labels; fits 1920×945, 1536×864, 1366×768, 1280×720 and 1024×768 with no page-wide sideways scroll', async () => {
      await J('/__lang?l=vi'); await open();
      const vk = await T(tid('rfp-kpi-paid')), vr = await T(tid('rfp-record'));
      expect(vk.toLowerCase().includes('thưởng đã trả') && vr.toLowerCase().includes('ghi nhận giới thiệu'), `VI: "${vk}" · "${vr.slice(0, 40)}"`);   // labels are upper-cased by CSS
      await shot('09-rf-vi');
      await J('/__lang?l=en');
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        await shot(`10-rf-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
