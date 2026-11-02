// interact-comms.mjs — Phone & Messaging steps of the catalog E2E (Oct 30 2026): the Phone & Messaging Center dashboard and
// Text Messaging Setup on the REAL controller + services + SQL, with comms-extra.mjs's FAKE Twilio (no SMS leaves, no number
// is bought, no account is called).   node tooling/catalog-one-screen/interact.mjs <label> comms
// Round 2 (Oct 30 2026): PM-01 branch test SMS (effective config shown + used; another salon's branch refused), PM-02
// masked SIDs + the audited reveal + a page-wide full-SID scan, PM-03 Refresh Status (provider snapshots), OPS-01 config rows.
const FULL_SID = /(AC|SK)[0-9a-f]{32}/;
export const STEPS_COMMS = ({ page, expect, settle, go, tid, noJunk, API, SQL, J }) => {
  const post = (p, body) => page.evaluate(async ([u, b]) => { const r = await fetch('/api/v1' + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; }, [p, body]);
  const pill = async (t) => (await page.locator(tid(t)).first().innerText()).trim();
  const byLabel = (l) => page.getByLabel(l, { exact: true });
  return [
    ['phone: four independent statuses straight from the server readiness (connected ≠ registered)', async () => {
      await go('/tenant/communications/phone', '.work.pmc'); await noJunk();
      const r = await API('/tenant/messaging/readiness');
      expect(r.account.state === 'connected' && r.a2p.state === 'pending' && r.outbound.state === 'blocked', `server ${r.account.state}/${r.a2p.state}/${r.outbound.state}`);
      expect((await page.locator(tid('pm-card-twilio')).innerText()).includes('Connected'), 'twilio card');
      expect((await page.locator(tid('pm-card-registration')).innerText()).includes('Pending'), 'registration card');
      expect((await page.locator(tid('pm-card-readiness')).innerText()).includes('Blocked'), 'readiness card');
      expect((await page.locator(tid('pm-card-number')).innerText()).includes(r.sender.number), 'number card');
      expect(r.a2p.brand.verified === true && r.a2p.campaign.verified === true, 'registration states must be provider-confirmed (PM-03)');
      expect(!FULL_SID.test(JSON.stringify(r)) && !FULL_SID.test(await page.content()), 'a full SID in the readiness / dashboard');
      return `account ${r.account.state} ${r.account.accountSidMasked} · sender ${r.sender.state} ${r.sender.number} · A2P ${r.a2p.state} (brand ${r.a2p.brand.state}, campaign ${r.a2p.campaign.state}, provider-confirmed) · outbound ${r.outbound.state} [${r.outbound.blockers}]`;
    }],
    ['phone: Run health check records an authenticated provider check; Verify readiness follows it', async () => {
      const before = (await SQL('checks')).length;
      await page.click(tid('pm-run-check')); await settle();
      const after = await SQL('checks');
      expect(after.length === before + 1 && after[0].trigger_kind === 'manual' && after[0].account_state === 'connected' && after[0].sender_state === 'assigned', JSON.stringify(after[0]));
      expect(await pill('pm-verify-state') === 'Ready', 'verify ' + await pill('pm-verify-state'));
      return `checks ${before} → ${after.length}; verify Ready (salon toggle on + Verify probe passed)`;
    }],
    ['phone: the checklist deep-links into the setup section that fixes it', async () => {
      await page.locator(`${tid('pm-step-registration')} button`).click();
      await page.waitForSelector(tid('pm-setup')); await settle();
      expect(page.url().endsWith('/tenant/communications/messaging-setup#registration'), page.url());
      return page.url().replace(/^https?:\/\/[^/]+/, '');
    }],
    ['setup: an API key SID without its secret cannot be saved (a SID is not a secret)', async () => {
      await go('/tenant/communications/messaging-setup', '.work.pmc'); await noJunk();
      await byLabel('API key SID').fill('SK' + '9'.repeat(32));
      expect(await page.locator(tid('pm-key-needs-secret')).isVisible(), 'pairing hint');
      expect(await page.getByRole('button', { name: 'Save credentials' }).isDisabled(), 'save disabled');
      await byLabel('API key SID').fill(''); return 'blocked in the form (the server refuses it too — pgtest)';
    }],
    ['setup: a wrong auth token is refused by Twilio and the working setup is untouched', async () => {
      const before = (await SQL('creds'))[0];
      await byLabel('Auth Token').fill('wrong-token'); await page.getByRole('button', { name: 'Save credentials' }).click(); await settle();
      const txt = await page.locator('.pmc-msg.bad').first().innerText();
      expect(/did not accept/.test(txt), txt);
      const after = (await SQL('creds'))[0];
      expect(after.token_hash === before.token_hash && after.config_version === before.config_version, 'credentials changed');
      await byLabel('Auth Token').fill(''); return txt;
    }],
    ['setup: search never buys; Review shows the provider price; Buy uses the server confirmation once', async () => {
      await byLabel('Area code (optional)').fill('856'); await page.locator(tid('pm-search')).getByRole('button', { name: 'Search', exact: true }).click(); await settle();
      expect(await page.locator(`${tid('pm-available')} li`).count() === 2, 'two numbers');
      expect((await SQL('quotes')).length === 0, 'search created a quote');
      await page.locator(`${tid('pm-available')} li`).first().getByRole('button').click(); await page.waitForSelector(tid('pm-buy'));
      const price = await page.locator(tid('pm-buy-price')).innerText(); expect(/1\.15 USD/.test(price), price);
      expect((await SQL('quotes'))[0].used === false && (await SQL('numbers')).every((n) => n.phone_number !== '+18565550188'), 'bought before confirm');
      await page.getByRole('button', { name: 'Buy this number' }).click(); await settle();
      const q = (await SQL('quotes'))[0]; expect(q.used === true && q.result_status === 'purchased', JSON.stringify(q));
      expect((await SQL('numbers')).some((n) => n.phone_number === '+18565550188'), 'registered');
      const r = await API('/tenant/messaging/readiness');
      expect(r.sender.number === '+18565550188' && r.account.state === 'unknown', `sender ${r.sender.number} account ${r.account.state}`);
      return `${price} · purchased once · the new sender is Unknown until checked`;
    }],
    ['setup: test SMS needs a confirmation, sends once, and reports Accepted — not Delivered', async () => {
      await page.waitForTimeout(2200); await page.click(tid('pm-run-check')); await settle();
      const n0 = (await SQL('smsTests')).length;
      await byLabel('Send to (E.164)').fill('+15551230000'); await page.getByRole('button', { name: 'Send test SMS' }).click(); await page.waitForSelector(tid('pm-test-confirm'));
      expect((await SQL('smsTests')).length === n0, 'sent before confirming');
      await page.getByRole('button', { name: 'Send once' }).click(); await settle();
      const t = (await SQL('smsTests'))[0]; expect(t.status === 'accepted' && t.destination_masked === '•••0000' && t.has_sid, JSON.stringify(t));
      const msg = await page.locator(tid('pm-test-msg')).innerText(); expect(/accepted/i.test(msg) && !/^Delivered/.test(msg), msg);
      expect(await pill('pm-last-test') === 'Accepted by Twilio', 'pill ' + await pill('pm-last-test'));
      return msg;
    }],
    ['PM-02 setup: the SIDs are masked everywhere; "Show full SID" is the audited reveal', async () => {
      await go('/tenant/communications/messaging-setup', '.work.pmc'); await noJunk();
      const c = await API('/tenant/messaging/credentials');
      expect(/^AC…[0-9a-f]{4}$/.test(c.accountSid) && !FULL_SID.test(JSON.stringify(c)), 'credentials GET ' + c.accountSid);
      expect(!FULL_SID.test(await page.content()) && (await page.locator(tid('pm-account-sid')).inputValue()) === c.accountSid, 'page holds a full SID');
      const before = (await SQL('sidAudit'))[0].n;
      await page.click(tid('pm-reveal-sid')); await settle();
      const full = await page.locator(tid('pm-account-sid')).inputValue();
      expect(/^AC[0-9a-f]{32}$/.test(full) && (await SQL('sidAudit'))[0].n === before + 1, `reveal ${full.slice(0, 4)}… audit ${before}`);
      await go('/tenant/communications/messaging-setup', '.work.pmc');
      return `GET ${c.accountSid} · page masked · reveal → full SID (audit rows ${before} → ${before + 1})`;
    }],
    ['PM-03 setup: Refresh Status reads Twilio (read-only) and shows what it confirmed', async () => {
      const runs0 = (await SQL('regRuns')).length;
      await page.click(tid('pm-reg-refresh')); await settle();
      const runs = await SQL('regRuns'); const snaps = await SQL('regSnaps');
      expect(runs.length === runs0 + 1 && runs[0].trigger_kind === 'manual' && runs[0].outcome === 'ok', JSON.stringify(runs[0]));
      expect(snaps.some((s) => s.item_kind === 'campaign' && s.normalized_state === 'pending' && s.verified), 'campaign snapshot');
      expect(/Confirmed by Twilio/.test(await page.locator(tid('pm-reg-brand')).innerText()), 'brand row');
      expect(await pill('pm-a2p-state') === 'Pending', 'registration ' + await pill('pm-a2p-state'));
      const cfg = await page.locator(tid('pm-config-TWILIO_STATUS_CALLBACK_URL')).innerText();
      expect(/Valid/.test(cfg), cfg);
      return `runs ${runs0} → ${runs.length} (${runs[0].outcome}); brand ${snaps.find((s) => s.item_kind === 'brand')?.normalized_state} / campaign pending, provider-confirmed; status callback URL ${cfg.split('\n')[0]}`;
    }],
    ['PM-01 setup: a branch test shows and uses that branch’s effective configuration; another salon’s branch is refused', async () => {
      const br = (await API('/tenant/messaging/readiness')).scope.authorizedBranches.find((b) => b.source === 'tenant_default');
      await page.getByLabel('Branch', { exact: true }).selectOption(br.branchId); await settle();
      const scope = await page.locator(tid('pm-test-scope')).innerText(); const acct = await page.locator(tid('pm-test-account')).innerText();
      expect(scope.includes(br.name) && /AC…[0-9a-f]{4}/.test(acct), `${scope} / ${acct}`);
      await page.waitForTimeout(2200); await page.click(tid('pm-run-check')); await settle();
      await byLabel('Send to (E.164)').fill('+15551230001'); await page.getByRole('button', { name: 'Send test SMS' }).click(); await page.waitForSelector(tid('pm-test-confirm'));
      await page.getByRole('button', { name: 'Send once' }).click(); await settle();
      const t = (await SQL('smsTests'))[0];
      expect(t.branch_id === br.branchId && t.config_source === 'tenant_default' && t.status === 'accepted' && acct.endsWith(t.account_sid_last4), JSON.stringify(t));
      const other = await post('/tenant/messaging/credentials/branches/b0970000-0000-4000-8000-000000000004/test', { to: '+15551230002', confirm: true, idempotencyKey: 'e2e-other-branch-01' });
      expect(other.status === 404 && other.body?.code === 'BRANCH_NOT_FOUND', JSON.stringify(other));
      await page.getByLabel('Branch', { exact: true }).selectOption(''); await settle();
      return `${scope} · ${acct} · row branch=${br.name} source=${t.config_source} ••${t.account_sid_last4} ${t.status} · other salon's branch → ${other.status} ${other.body?.code}`;
    }],
    ['isolation + Vietnamese: the other salon never appears; the dashboard renders in VI', async () => {
      const r = await API('/tenant/messaging/readiness'); expect(!JSON.stringify(r).includes('+18565550456'), 'other salon leaked');
      await J('/__lang?l=vi'); await go('/tenant/communications/phone', '.work.pmc');
      const h = await page.locator('.pmc-head h1').innerText(); await J('/__lang?l=en');
      expect(h.includes('Trung tâm'), h); return h;
    }],
    ['setup: disconnect shows the impact and needs the typed word; then nothing is connected', async () => {
      await go('/tenant/communications/messaging-setup', '.work.pmc');
      await page.locator(tid('pm-save-bar')).getByRole('button', { name: 'Disconnect' }).click(); await page.waitForSelector(tid('pm-disconnect'));
      const impact = await page.locator(tid('pm-impact')).innerText(); expect(/branch/i.test(impact) && /Nothing is deleted at Twilio/.test(impact), impact);
      const btn = page.locator(`${tid('pm-disconnect')} .fk-dialog-foot button`, { hasText: 'Disconnect' });
      expect(await btn.isDisabled(), 'enabled before typing');
      await page.getByLabel('Confirmation word').fill('DISCONNECT'); await btn.click(); await settle();
      expect((await SQL('creds')).length === 0, 'still connected');
      expect(/Not connected/.test(await page.locator(tid('twilio-status')).innerText()), 'status');
      return impact.replace(/\s+/g, ' ').slice(0, 160);
    }],
  ];
};
