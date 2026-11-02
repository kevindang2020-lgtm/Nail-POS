// interact-rn.mjs — Loyalty & Rewards → Rewards Network steps of the catalog E2E (Global Loyalty & Rewards Network, Oct 30 2026):
// the REAL screen in Chromium against the REAL GlobalRewardsController / service / repository / SQL and the SANDBOX funding
// provider (no real money). `node tooling/catalog-one-screen/interact.mjs <label> rn`
export const STEPS_RN = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText }) => {
  const URL0 = '/tenant/customers/loyalty?view=network';
  const open = () => go(URL0, tid('loyalty-network-screen'));
  const rn = (qs) => J('/__rn?' + qs);
  const kpi = async (t) => (await T(tid(t))).replace(/\s+/g, ' ').trim();
  const note = async () => (await page.locator('.fk-note').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const waitFor = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(250); } return false; };
  const stepUp = async (password) => {
    const pw = page.locator('[role="dialog"] input[type="password"]'); await pw.waitFor({ timeout: 6000 });
    await pw.fill(password); await pw.locator('xpath=ancestor::div[@role="dialog"]').locator('button.btn.primary').click(); await settle();
  };
  const tomorrowLocal = () => { const d = new Date(Date.now() + 26 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:30`; };
  const fit = async (sel) => page.evaluate((s) => { const c = document.querySelector(s); const se = document.scrollingElement; return { v: c ? c.scrollHeight - c.clientHeight : -1, h: se.scrollWidth - innerWidth, pageV: se.scrollHeight - innerHeight }; }, sel);

  return [
    ['rn: flags OFF (default) — the network says so, nothing can be changed or bought; the salon program view is unchanged', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await rn('reset=1&flags=off&provider=sandbox&stepup=off');
      await open(); await noJunk();
      const body = await T(tid('rn-earning')); expect(/not turned on for this salon yet/.test(body), 'off banner: ' + body.slice(0, 160));
      expect(await page.locator(tid('rn-buy')).isDisabled(), 'buy disabled'); expect(await page.locator(tid('rn-edit-custom')).isDisabled(), 'custom disabled');
      expect(/AI PowerSalon Global/.test(await kpi('rn-kpi-mode')), 'mode global');
      await page.click(`${tid('loyalty-view')} button >> nth=0`); await page.waitForSelector(tid('loyalty-screen')); await settle();
      expect(await page.locator(tid('loyalty-kpis')).count() === 1 && await page.locator(tid('panel-catalog')).count() === 1, 'program view intact');
      expect(!/view=network/.test(page.url()), 'url ' + page.url());
      return 'off: banner · buy + custom disabled · program view intact';
    }],
    ['rn: ON + enrolled — true source (Global default), active rate, wallet 0, read-only reward value; numbers = the server', async () => {
      await rn('flags=on&enroll=1'); await open(); await noJunk();
      const s = await API('/pos/loyalty/network/state');
      expect(s.mode === 'GLOBAL' && s.effective.source === 'GLOBAL_DEFAULT', 'server global');
      expect(/AI PowerSalon Global/.test(await kpi('rn-kpi-mode')), 'kpi mode'); expect(/\$5\.00 = 0\.5 points/.test(await kpi('rn-kpi-rate')), 'rate ' + await kpi('rn-kpi-rate'));
      expect(/0(\.00)?/.test(await kpi('rn-kpi-tokens')), 'tokens'); expect(/10 points = \$1\.00/.test(await kpi('rn-kpi-value')), 'value');
      expect(/In force now: AI PowerSalon Global Default/.test(await T(tid('rn-earning'))), 'true source');
      expect(await page.locator(tid('rn-kpi-value')).evaluate((e) => e.tagName) !== 'INPUT', 'value is not editable');
      return `mode ${s.mode} · ${s.effective.rateLabel} · wallet ${s.wallet.availableCents}¢`;
    }],
    ['rn: custom editor — preview $5–$100 with token cost vs global; Save Draft keeps the rule in force (T02)', async () => {
      await page.click(tid('rn-edit-custom')); await page.waitForSelector(tid('rn-custom-dialog'));
      await page.fill(tid('rn-f-spend'), '5'); await page.fill(tid('rn-f-points'), '1');
      await page.waitForSelector(`${tid('rn-preview')} tbody tr`, { timeout: 6000 }); await settle();
      const rows = await rowsText(`${tid('rn-preview')} tbody tr`); expect(rows.length === 5, 'rows ' + rows.length);
      expect(/^\$100\.00 20 2(\.00)? 10 pts · 1(\.00)? tokens \+1(\.00)?$/.test(rows[4]), 'row $100: ' + rows[4]);
      expect(/^\$5\.00 1 0\.1 0\.5 pts · 0\.05 tokens \+0\.05$/.test(rows[0]), 'row $5: ' + rows[0]);
      await page.click(tid('rn-save-draft')); await settle();
      expect(/Draft saved/.test(await note()), 'note ' + await note());
      const db = await rn('state=1'); expect(db.versions.some((v) => v.status === 'DRAFT' && v.point_tenths_per_increment === 10), 'draft in db');
      expect(/AI PowerSalon Global/.test(await kpi('rn-kpi-mode')), 'still global'); expect(await page.locator(tid('rn-draft')).count() === 1, 'draft listed');
      return `preview ${rows.length} rows · ${rows[4]} · draft saved, rule unchanged`;
    }],
    ['rn: Review & Activate needs the password (step-up) — wrong refused, right activates; mode, rate, history, audit', async () => {
      await rn('stepup=on');
      await page.click(`${tid('rn-draft')} button[aria-label="Edit draft"]`); await page.waitForSelector(tid('rn-custom-dialog')); await page.waitForSelector(`${tid('rn-preview')} tbody tr`); await settle();
      await page.click(tid('rn-review')); await page.waitForSelector(tid('rn-review-panel'));
      expect(/Before AI PowerSalon Global/.test((await T(tid('rn-review-panel'))).replace(/\s+/g, ' ')), 'before/after');
      await page.click(tid('rn-activate'));
      await stepUp('wrong'); expect(await page.locator('[role="dialog"] .err').count() === 1, 'wrong password refused');
      await page.locator('[role="dialog"] input[type="password"]').fill('correct-horse'); await page.locator('[role="dialog"] input[type="password"]').locator('xpath=ancestor::div[@role="dialog"]').locator('button.btn.primary').click(); await settle();
      await page.waitForSelector(tid('rn-custom-dialog'), { state: 'detached', timeout: 8000 });
      expect(/now active/.test(await note()), 'note ' + await note());
      expect(/My Salon Custom/.test(await kpi('rn-kpi-mode')), 'kpi custom'); expect(/\$5\.00 = 1 point/.test(await kpi('rn-kpi-rate')), 'rate ' + await kpi('rn-kpi-rate'));
      const hist = await rowsText(`${tid('rn-history')} .fk-li`); expect(/My Salon Custom.*Active/.test(hist[0]), 'history ' + hist[0]);
      const db = await rn('state=1'); expect(db.versions.some((v) => v.status === 'ACTIVATED' && v.mode === 'CUSTOM'), 'activated');
      expect(db.audit.some((a) => a.action === 'loyalty.earning.custom_activated'), 'audit');
      await rn('stepup=off');
      return `activated after step-up · ${await kpi('rn-kpi-rate')} · ${hist[0]}`;
    }],
    ['rn: schedule a return to Global for tomorrow → listed as scheduled; cancel before it starts', async () => {
      await page.click(tid('rn-use-global')); await page.waitForSelector(tid('rn-global-dialog'));
      expect(await page.locator(tid('rn-global-confirm')).isDisabled(), 'needs the confirmation tick');
      await page.click(`${tid('rn-global-dialog')} .fk-seg button >> nth=1`); await page.fill(`${tid('rn-global-dialog')} input[type="datetime-local"]`, tomorrowLocal());
      await page.check(tid('rn-global-ok')); await page.click(tid('rn-global-confirm')); await settle();
      expect(/scheduled for/.test(await note()), 'note ' + await note());
      expect(await page.locator(tid('rn-scheduled')).count() === 1, 'scheduled row'); expect(/Scheduled: Global from/.test(await kpi('rn-kpi-mode')), 'kpi sub ' + await kpi('rn-kpi-mode'));
      expect(/My Salon Custom/.test(await kpi('rn-kpi-mode')), 'custom still in force');
      await page.click(`${tid('rn-scheduled')} button`); await settle();
      expect(/canceled/.test(await note()), 'cancel note'); expect(await page.locator(tid('rn-scheduled')).count() === 0, 'gone');
      return 'scheduled → canceled; custom stayed in force';
    }],
    ['rn: Use Global Rules now (explicit confirmation) → Global; history keeps the custom version as Superseded', async () => {
      await page.click(tid('rn-use-global')); await page.waitForSelector(tid('rn-global-dialog')); await page.check(tid('rn-global-ok')); await page.click(tid('rn-global-confirm')); await settle();
      expect(/AI PowerSalon global rules/.test(await note()), 'note ' + await note());
      expect(/AI PowerSalon Global/.test(await kpi('rn-kpi-mode')) && /\$5\.00 = 0\.5 points/.test(await kpi('rn-kpi-rate')), 'back to global');
      const hist = await rowsText(`${tid('rn-history')} .fk-li`); expect(hist.some((h) => /My Salon Custom.*Superseded/.test(h)), 'superseded: ' + hist.join(' | '));
      expect(await page.locator(tid('rn-use-global')).isDisabled(), 'nothing more to switch');
      return hist.slice(0, 3).join(' | ');
    }],
    ['rn: no approved provider → Buy Tokens disabled with the reason (BLOCKED_EXTERNAL); the server refuses too', async () => {
      await rn('provider=none&stepup=off'); await open();
      expect(await page.locator(tid('rn-buy')).isDisabled(), 'disabled'); expect(/no approved payment provider/.test(await T(tid('rn-buy-blocked'))), 'reason');
      const r = await fetch(page.url().replace(/\/tenant.*/, '') + '/api/v1/pos/loyalty/network/purchases', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'harness-none-1' }, body: JSON.stringify({ tokens: 10 }) }).then((x) => x.json());
      expect(r.code === 'TOKEN_FUNDING_PROVIDER_UNAVAILABLE', 'server ' + JSON.stringify(r).slice(0, 120));
      await rn('provider=sandbox');
      return 'blocked + TOKEN_FUNDING_PROVIDER_UNAVAILABLE';
    }],
    ['rn: Buy 25 tokens (sandbox, step-up) → Payment confirmed but NOT spendable; funds verified → wallet 25 live, journal balanced', async () => {
      await rn('stepup=on'); await open();
      const before = await rn('state=1'); const avail0 = Number(before.wallet?.available_cents ?? 0);
      await page.click(tid('rn-buy')); await page.waitForSelector(tid('rn-buy-dialog')); await page.click(tid('rn-preset-25')); await page.click(tid('rn-buy-review'));
      await page.waitForSelector(tid('rn-buy-review-panel')); expect(/Total \$25\.00/.test((await T(tid('rn-buy-review-panel'))).replace(/\s+/g, ' ')), 'review total');
      await page.click(tid('rn-buy-confirm')); await stepUp('correct-horse');
      await page.waitForSelector(tid('rn-buy-result'), { timeout: 8000 }); expect(/Payment confirmed/.test(await T(tid('rn-buy-result'))), 'result ' + await T(tid('rn-buy-result')));
      const mid = await rn('state=1'); const intent = mid.purchases[0];
      expect(intent.status === 'PAYMENT_CONFIRMED' && Number(intent.token_cents) === 2500, 'db intent ' + JSON.stringify(intent));
      expect(Number(mid.wallet.available_cents) === avail0, 'not spendable before FUNDS_VERIFIED');
      await page.click(`${tid('rn-buy-dialog')} .fk-dialog-foot .fk-btn.primary`); await settle();
      expect(/25(\.00)?/.test(await kpi('rn-kpi-pending')), 'pending ' + await kpi('rn-kpi-pending'));
      await rn('advance=' + intent.id + '&to=SETTLEMENT_PENDING'); await rn('advance=' + intent.id + '&to=FUNDS_VERIFIED');   // the provider's later answers
      const want = ((avail0 + 2500) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
      const live = await waitFor(async () => (await kpi('rn-kpi-tokens')).toLowerCase().startsWith('available tokens ' + want + ' '));
      expect(live, 'live update without reload: ' + await kpi('rn-kpi-tokens'));
      const after = await rn('state=1'); expect(Number(after.wallet.available_cents) === avail0 + 2500, 'wallet +2500'); expect(after.ledger[0].entry_type === 'purchase_funded', 'ledger');
      expect(after.journalUnbalanced === 0, 'journal balanced'); expect(/Purchase funded/.test((await rowsText(`${tid('rn-ledger')} .fk-li`))[0] ?? ''), 'ledger row on screen');
      await rn('stepup=off');
      return `wallet ${avail0}¢ → ${after.wallet.available_cents}¢ · ${intent.status} → FUNDS_VERIFIED · journal balanced`;
    }],
    ['rn: lost provider answer → Verification pending; Check again re-sends the SAME key (one purchase, never two)', async () => {
      await rn('provider=lost&stepup=off'); await open();
      const n0 = (await rn('state=1')).purchases.length;
      await page.click(tid('rn-buy')); await page.click(tid('rn-preset-10')); await page.click(tid('rn-buy-review')); await page.click(tid('rn-buy-confirm'));
      await page.waitForSelector(tid('rn-buy-result'), { timeout: 8000 }); expect(/Verification pending/.test(await T(tid('rn-buy-result'))), 'pending');
      const s1 = await rn('state=1'); expect(s1.purchases.length === n0 + 1 && s1.purchases[0].status === 'UNKNOWN', 'one UNKNOWN intent');
      await page.click(tid('rn-buy-recheck')); await settle();
      const s2 = await rn('state=1'); expect(s2.purchases.length === n0 + 1, 'still one purchase: ' + s2.purchases.length); expect(s2.purchases[0].idempotency_key === s1.purchases[0].idempotency_key, 'same key');
      // a NEW purchase while one is unresolved is refused
      const r = await fetch(page.url().replace(/\/tenant.*/, '') + '/api/v1/pos/loyalty/network/purchases', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'harness-other-key' }, body: JSON.stringify({ tokens: 10 }) }).then((x) => x.json());
      expect(r.code === 'PURCHASE_PENDING_VERIFICATION', 'in-flight guard ' + r.code);
      await page.click(`${tid('rn-buy-dialog')} .fk-dialog-foot .fk-btn.primary`); await settle();
      await rn('advance=' + s1.purchases[0].id + '&to=FAILED'); await rn('provider=sandbox');
      return `UNKNOWN kept under one key · retry returned the same purchase · other key → ${r.code}`;
    }],
    ['rn: Front Desk sees the network read-only (no Buy, no custom rule); another salon’s purchase is not reachable', async () => {
      await J('/__role?r=FRONT_DESK'); await open(); await noJunk();
      expect(await page.locator(tid('rn-buy')).isDisabled() && await page.locator(tid('rn-edit-custom')).isDisabled() && await page.locator(tid('rn-use-global')).isDisabled(), 'read-only');
      expect(/Only the owner/.test(await T(tid('rn-buy-blocked'))), 'reason');
      const r = await API('/pos/loyalty/network/purchases/00000000-0000-4000-8000-0000000000ff'); expect(r.code === 'RESOURCE_NOT_FOUND', 'foreign id ' + JSON.stringify(r).slice(0, 80));
      await J('/__role?r=OWNER');
      return 'read-only for Front Desk · foreign purchase 404';
    }],
    ['rn: Vietnamese — every label in Vietnamese, numbers the same', async () => {
      await J('/__lang?l=vi'); await open(); await noJunk();
      expect(/Chế độ tích điểm/iu.test(await kpi('rn-kpi-mode')) && /Token hiện có/iu.test(await kpi('rn-kpi-tokens')) && /Giá trị điểm thưởng/iu.test(await kpi('rn-kpi-value')), 'vi kpis ' + await kpi('rn-kpi-mode'));
      expect(/10 điểm = \$1\.00/.test(await kpi('rn-kpi-value')), 'vi value'); expect(/\$5\.00 = 0\.5 điểm/.test(await kpi('rn-kpi-rate')), 'vi rate ' + await kpi('rn-kpi-rate'));
      const all = await page.locator(tid('loyalty-network-screen')).innerText();
      for (const en of ['Earning mode', 'Available tokens', 'Buy Tokens', 'Token activity', 'Earning rule history', 'Use Global Rules']) expect(!all.toLowerCase().includes(en.toLowerCase()), 'english left: ' + en);
      await page.click(tid('rn-buy')); await page.waitForSelector(tid('rn-buy-dialog')); // the earlier lost-answer purchase is still held on this till → the dialog RESUMES it (same request key), in Vietnamese
      const dt = await T(tid('rn-buy-dialog')); expect(/Mua Token|Xem lại lần mua/iu.test(dt), 'vi dialog ' + dt.slice(0, 80)); expect(/không bị trừ tiền hai lần/iu.test(dt), 'resume hint'); await page.keyboard.press('Escape');
      await J('/__lang?l=en');
      return 'vi labels · same numbers';
    }],
    ['rn: T16 — switching English → Vietnamese with the custom-rule editor open keeps the unsaved values and every number', async () => {
      await J('/__lang?l=en'); await rn('flags=on&stepup=off&provider=sandbox'); await open();
      const rateEn = await kpi('rn-kpi-rate');
      await page.click(tid('rn-edit-custom')); await page.waitForSelector(tid('rn-custom-dialog'));
      await page.fill(tid('rn-f-spend'), '7'); await page.fill(tid('rn-f-points'), '1.5');
      await page.waitForSelector(`${tid('rn-preview')} tbody tr`); await settle();
      const rowsEn = await rowsText(`${tid('rn-preview')} tbody tr`);
      // the topbar switch sits under the dialog backdrop; drive the same control directly (as a keyboard user / second tap would)
      await page.locator(tid('language-switch')).dispatchEvent('click'); await page.locator(tid('language-option-vi')).dispatchEvent('click'); await page.waitForTimeout(800);
      expect(await page.locator(tid('rn-f-spend')).inputValue() === '7' && await page.locator(tid('rn-f-points')).inputValue() === '1.5', 'unsaved editor values kept');
      expect(/Quy tắc tích điểm riêng/.test(await T(tid('rn-custom-dialog'))), 'dialog now in Vietnamese');
      const rowsVi = await rowsText(`${tid('rn-preview')} tbody tr`);
      const nums = (r) => r.map((x) => (x.match(/[0-9][0-9.,]*/g) || []).join('|'));
      expect(JSON.stringify(nums(rowsVi)) === JSON.stringify(nums(rowsEn)), 'same numbers: ' + rowsEn[4] + ' vs ' + rowsVi[4]);
      await page.keyboard.press('Escape'); await page.locator(tid('language-switch')).dispatchEvent('click'); await page.locator(tid('language-option-en')).dispatchEvent('click'); await page.waitForTimeout(500);
      expect(await kpi('rn-kpi-rate') === rateEn, 'money unchanged after switching back');
      return `editor kept 7 / 1.5 across EN→VI; preview numbers identical (${rowsVi.length} rows)`;
    }],
    ['rn: layout — 1920×945, 1366×768, 1280×720 fit with no page scroll; 1024×768 has no sideways scroll', async () => {
      const out = [];
      for (const [w, h, strict] of [[1920, 945, true], [1366, 768, true], [1280, 720, true], [1024, 768, false]]) {
        await page.setViewportSize({ width: w, height: h }); await open();
        const m = await fit('.work.fit.rn'); expect(m.h <= 0, `${w}×${h} sideways ${m.h}`); if (strict) expect(m.v <= 1 && m.pageV <= 1, `${w}×${h} scroll ${JSON.stringify(m)}`);
        out.push(`${w}×${h} v${m.v}/h${m.h}`);
        await page.screenshot({ path: `${process.env.RN_SHOTS || '/tmp'}/rn-${w}x${h}.png` }).catch(() => undefined);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
