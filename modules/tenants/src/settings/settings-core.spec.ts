// settings-core.spec.ts — framework-free harness for POS Settings (run via esbuild->node).
// Covers: pure helpers, tenant isolation, forbidden roles, permission gating, masking,
// validation, audit-on-save, read-only subscription, and HONEST module status (never fake 100%).
// ASYNC: the service is async (the repo is async); pure-helper + standalone-adapter tests stay synchronous.
import {
  canEditCategory, maskSecret, changedKeys, rollUpStatus, SETTINGS_CATEGORY_LABELS,
  POSSettingsSectionStatus, SettingsContext,
} from './settings.dto';
import { InMemorySettingsRepository } from './settings.repository';
import { PosSettingsService, ForbiddenError, ValidationError } from './settings.service';
import { FiservCardPointAdapter, buildGoLiveReadiness, DevicePairingService } from './settings.integrations';

let passed = 0, failed = 0;
function ok(name: string, cond: boolean) { if (cond) { passed++; } else { failed++; console.error('FAIL: ' + name); } }
async function threwAsync(fn: () => unknown, type?: any): Promise<boolean> { try { await fn(); return false; } catch (e) { return type ? e instanceof type : true; } }

const owner: SettingsContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const front: SettingsContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_front', role: 'FRONT_DESK', permissions: ['settings.view'] };
const other: SettingsContext = { tenantId: 'other999', branchId: 'br_x', userId: 'u_o', role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const customer: any = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_c', role: 'CUSTOMER', permissions: [] };

// pure helpers (synchronous)
ok('canEditCategory: owner edits payments via settings.edit', canEditCategory('payments-checkout', ['settings.edit']));
ok('canEditCategory: subscription never editable', !canEditCategory('subscription-plan', ['settings.edit']));
ok('canEditCategory: specific key works', canEditCategory('tax', ['settings.tax_edit']));
ok('maskSecret hides all but last 4', maskSecret('xyz9999').endsWith('9999'));
ok('maskSecret empty', maskSecret('') === '');
ok('changedKeys detects change', changedKeys({ a: 1, b: 2 }, { a: 1, b: 3 }).join() === 'b');

const secs: POSSettingsSectionStatus[] = [
  { key: 'tax', label: 'Tax', completionPercent: 100, status: 'Complete', editable: true, missingReasons: [] },
  { key: 'payments-checkout', label: 'Payments & Checkout', completionPercent: 82, status: 'Needs Review', editable: true, missingReasons: ['live MID missing'] },
];
const r = rollUpStatus(secs);
ok('rollUp averages honestly (91)', r.completionPercent === 91);
ok('rollUp not Complete when a section <100', r.status !== 'Complete');
ok('rollUp lists missing reasons', r.missingReasons.length === 1 && r.missingReasons[0].indexOf('Payments') === 0);

// standalone Fiserv adapter (synchronous)
const stubPay = new FiservCardPointAdapter({ secret: 'x' });
ok('payments adapter not live without MID', stubPay.isLive() === false);
ok('payments testConnection reports stub mode', stubPay.testConnection().mode === 'stub');
const livePay = new FiservCardPointAdapter({ merchantId: 'M123', secret: 's' });
ok('payments adapter live with MID', livePay.isLive() && livePay.testConnection().mode === 'live');
const c1 = livePay.charge({ amountCents: 500, idempotencyKey: 'k1' });
const c2 = livePay.charge({ amountCents: 500, idempotencyKey: 'k1' });
ok('charge approved when live', c1.ok && c1.status === 'approved');
ok('charge is idempotent (replay)', c2.idempotentReplay === true);
const allReady = buildGoLiveReadiness({ paymentsLive: true, googleConnected: true, aiEnabled: true, a2p: 'registered', pairedDevices: 1 });
ok('readiness ready when all satisfied', allReady.ready === true && allReady.pending.length === 0);

(async () => {
  // customer displays are paired in POS → Devices → Customer Displays now (23-inch spec §8–§12); this list is the read
  // Go-Live readiness uses, filled here as a paired display would be
  const displays = new DevicePairingService();
  const svc = new PosSettingsService(new InMemorySettingsRepository(), undefined, displays);

  ok('customer/customer-display role is forbidden', await threwAsync(() => svc.getState(customer), ForbiddenError));
  const state = await svc.getState(owner);
  ok('getState returns all 17 sections + audit + status', !!state.businessBranch && !!state.tax && !!state.auditLogs && !!state.moduleStatus);
  ok('module status has 20 sections (gift-card-settings category added)', state.moduleStatus!.sections.length === 20);
  ok('module build completion is 100% (code done + tested)', state.moduleStatus!.completionPercent === 100 && state.moduleStatus!.status === 'Complete');
  ok('go-live items surfaced separately, not as build deductions', Array.isArray(state.moduleStatus!.goLivePending) && state.moduleStatus!.goLivePending!.length >= 1 && state.moduleStatus!.missingReasons.length === 0);
  ok('seeded tenant has salon name', state.businessBranch.salonName.length > 0);

  const otherState = await svc.getState(other);
  ok('tenant isolation: other tenant does NOT see luxe salon name', otherState.businessBranch.salonName !== state.businessBranch.salonName);

  const pay = await svc.getCategory(owner, 'payments-checkout');
  ok('payments returns masked credential', typeof pay.fiservCredentialMasked === 'string' && pay.fiservCredentialMasked.indexOf('••') >= 0);
  ok('payments never leaks raw secret', JSON.stringify(pay).indexOf('fiserv_live_secret') < 0);

  ok('front-desk cannot patch tax (no edit perm)', await threwAsync(() => svc.patchCategory(front, 'tax', { taxRatePercent: 8 }), ForbiddenError));

  const before = (await svc.listAudit(owner, 50)).length;
  const patched = await svc.patchCategory(owner, 'tax', { taxRatePercent: 8.25 });
  ok('owner patch tax persists', patched.taxRatePercent === 8.25);
  ok('patch creates an audit row', (await svc.listAudit(owner, 50)).length === before + 1);
  ok('audit row records changedKeys', (await svc.listAudit(owner, 50))[0].changedKeys!.indexOf('taxRatePercent') >= 0);

  ok('invalid tax rate rejected', await threwAsync(() => svc.patchCategory(owner, 'tax', { taxRatePercent: 250 }), ValidationError));
  // ---- tightened schema validation (regulatory bounds + finite/enum/whole-number guards) ----
  ok('tax rate above 15% rejected', await threwAsync(() => svc.patchCategory(owner, 'tax', { taxRatePercent: 20 }), ValidationError));
  ok('NaN tax rate rejected', await threwAsync(() => svc.patchCategory(owner, 'tax', { taxRatePercent: NaN }), ValidationError));
  ok('invalid tax mode rejected', await threwAsync(() => svc.patchCategory(owner, 'tax', { mode: 'sideways' }), ValidationError));
  ok('card surcharge above 3% rejected (Visa cap)', await threwAsync(() => svc.patchCategory(owner, 'payments-checkout', { creditCardSurchargePercent: 10 }), ValidationError));
  ok('card surcharge of 3.5% rejected (Visa cap)', await threwAsync(() => svc.patchCategory(owner, 'payments-checkout', { creditCardSurchargePercent: 3.5 }), ValidationError));
  // gift-card-settings: server-enforced money integrity (merges onto DEFAULTS then validates the full block)
  ok('gift-card min above max rejected', await threwAsync(() => svc.patchCategory(owner, 'gift-card-settings', { minAmountCents: 60000 }), ValidationError));
  ok('fractional preset amount rejected', await threwAsync(() => svc.patchCategory(owner, 'gift-card-settings', { presetAmountsCents: [2500.5] }), ValidationError));
  ok('token TTL below 30s rejected', await threwAsync(() => svc.patchCategory(owner, 'gift-card-settings', { presentationTokenTtlSeconds: 5 }), ValidationError));
  ok('invalid barcode format rejected', await threwAsync(() => svc.patchCategory(owner, 'gift-card-settings', { barcodeFormat: 'ean13' }), ValidationError));
  const gcPatched: any = await svc.patchCategory(owner, 'gift-card-settings', { minAmountCents: 2000, maxAmountCents: 40000 });
  ok('valid gift-card settings saved', gcPatched.minAmountCents === 2000 && gcPatched.maxAmountCents === 40000);
  ok('card surcharge of 3% accepted', (await svc.patchCategory(owner, 'payments-checkout', { creditCardSurchargePercent: 3 })).creditCardSurchargePercent === 3);
  ok('enabled surcharge with empty label rejected', await threwAsync(() => svc.patchCategory(owner, 'payments-checkout', { creditCardSurchargeEnabled: true, surchargeLabel: '' }), ValidationError));
  ok('invalid customer-display mode rejected', await threwAsync(() => svc.patchCategory(owner, 'payments-checkout', { customerDisplayMode: 'whatever' }), ValidationError));
  ok('non-integer tip preset rejected', await threwAsync(() => svc.patchCategory(owner, 'tips', { defaultTipPercents: [15, 18.5, 20] }), ValidationError));
  ok('open>=close rejected', await threwAsync(() => svc.patchCategory(owner, 'store-hours-auto-logout', { storeHours: { monday: { isOpen: true, openTime: '20:00', closeTime: '09:00' } } }), ValidationError));

  ok('subscription-plan PATCH is forbidden (read-only)', await threwAsync(() => svc.patchCategory(owner, 'subscription-plan', { plan: 'X' }), ForbiddenError));
  ok('subscription-plan GET works (read-only view)', !!(await svc.getCategory(owner, 'subscription-plan')).plan);
  ok('audit-logs GET returns rows', Array.isArray((await svc.getCategory(owner, 'audit-logs')).recentItems));

  console.log(`\nsettings-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);

  // ---- provider / integration layer (Connect / Test / Pair / Register are real) ----
  // Oct 6 2026: a terminal serves one of this location's REGISTERS — a typed name is refused (no charge could match it)
  (svc as any).terminals.registers.push({ id: 'st1', name: 'Front Desk', branchId: 'br_cherryhill' }, { id: 'st9', name: 'Elsewhere', branchId: 'br_other' });
  ok('a typed station name is refused when pairing', await threwAsync(() => svc.pairTerminal(owner, '123457', 'Front', 'Front-1')));
  ok('another location\'s register is refused when pairing', await threwAsync(() => svc.pairTerminal(owner, '123457', 'Front', 'st9')));
  ok('owner pairs a terminal (6-digit) to one of the location\'s registers', (await svc.pairTerminal(owner, '123456', 'Front', 'st1')).status === 'paired');
  ok('… and its register can be changed later, by name in the list', (await svc.setTerminalRegister(owner, 'term_123456', 'st1')).registerName === 'Front Desk');
  ok('terminal list reflects pairing', (await svc.listTerminals(owner)).some((t) => t.id === 'term_123456'));
  // wave 3 PAYI §166: without a real probe the test is honest — paired is NOT "responding"
  { const r = await svc.testTerminal(owner, 'term_123456'); ok('terminal test without a probe never claims reachable', r.reachable === false && /not probed/.test(r.detail)); }
  { const probed = new PosSettingsService(new InMemorySettingsRepository(), (svc as any).terminals, undefined, undefined, undefined, null, null, { probe: async () => ({ probed: true, reachable: true, detail: 'Clover answered the ping' }) });
    const r = await probed.testTerminal(owner, 'term_123456');
    ok('terminal test WITH a probe reports what the device answered', r.reachable === true && r.detail === 'Clover answered the ping');
    ok('… and the registry remembers it (last ping ok → ONLINE)', (await probed.listTerminals(owner)).find((t) => t.id === 'term_123456')?.lastPingOk === true); }
  ok('owner renames a terminal + sets its type', (await svc.updateTerminal(owner, 'term_123456', { label: 'Front Clover', terminalType: 'clover_compact' })).label === 'Front Clover');
  { const d = await svc.setTerminalDisabled(owner, 'term_123456', true, 'reader broken'); ok('owner disables a terminal (kept, DISABLED)', d.disabledAt !== null && d.operationalStatus === 'DISABLED');
    ok('disabled terminal test is honest', (await svc.testTerminal(owner, 'term_123456')).detail === 'terminal is disabled');
    ok('… and can be enabled again', (await svc.setTerminalDisabled(owner, 'term_123456', false, null)).disabledAt === null); }
  // wave 3 PAYI §137: terminal pairing / assignment / rename / disable / enable each leave an audit row (never a secret)
  { const acts = (await svc.listAudit(owner, 200)).map((a: any) => a.actionType);
    ok('terminal pair / register / update / disable / enable are audited', ['pos_settings_terminal_paired', 'pos_settings_terminal_updated', 'pos_settings_terminal_disabled', 'pos_settings_terminal_enabled'].every((a) => acts.includes(a))); }
  ok('front-desk cannot rename a terminal (no payments edit)', await threwAsync(() => svc.updateTerminal(front, 'term_123456', { label: 'X' }), ForbiddenError));
  ok('front-desk cannot disable a terminal (no payments edit)', await threwAsync(() => svc.setTerminalDisabled(front, 'term_123456', true, 'x'), ForbiddenError));
  ok('bad pairing code rejected', await threwAsync(() => svc.pairTerminal(owner, 'abc', 'X')));
  ok('front-desk cannot pair terminal (no payments edit)', await threwAsync(() => svc.pairTerminal(front, '111111', 'X'), ForbiddenError));

  ok('connect google validates URL', await threwAsync(() => svc.connectGoogle(owner, 'not-a-url')));
  ok('connect google works + status reflects', (await svc.connectGoogle(owner, 'https://g.page/luxe')).googleReserveConnected === true);

  const a2p = await svc.registerA2p(owner, 'Luxe Nails');
  ok('a2p register => pending (carrier approval external)', a2p.a2pStatus === 'pending');

  displays.seed(owner, { id: 'disp_lobby', name: 'Lobby Display', status: 'paired' });

  const readiness = await svc.getGoLiveReadiness(owner);
  ok('go-live still has payments pending (no live MID)', readiness.pending.some((p) => p.section === 'payments-checkout'));
  ok('go-live cleared google (connected)', !readiness.pending.some((p) => p.section === 'online-google-ai-booking'));
  ok('go-live cleared device (paired)', !readiness.pending.some((p) => p.section === 'customer-display-devices'));

  const st2 = (await svc.getState(owner)).moduleStatus!;
  ok('build completion is 100% (code done + tested)', st2.completionPercent === 100 && st2.status === 'Complete');
  ok('all sections build-complete', st2.sections.every((s) => s.completionPercent === 100));
  ok('go-live pending surfaced separately on module', Array.isArray(st2.goLivePending) && st2.goLivePending!.length >= 1);
  ok('payments section carries goLivePending (live MID)', !!st2.sections.find((s) => s.key === 'payments-checkout')!.goLivePending);

  const ss = (await svc.getState(owner)).sectionStatuses;
  ok('sectionStatuses present (>=17)', Array.isArray(ss) && ss.length >= 17);
  ok('sectionStatuses carry sectionKey + label', !!ss[0].sectionKey && !!ss[0].label);
  ok('a known section appears (payments-checkout)', ss.some((x) => x.sectionKey === 'payments-checkout'));

  const full = await svc.getState(owner);
  ok('tax has enabled + roundingRule fields', typeof full.tax.enabled === 'boolean' && !!full.tax.roundingRule);
  ok('customer display has tip/receipt prompt fields', typeof full.customerDisplayDevices.tipPromptEnabled === 'boolean' && typeof full.customerDisplayDevices.receiptPromptEnabled === 'boolean');
  ok('receipts has discount + loyalty line toggles + brandStyle', typeof full.receiptsBranding.showDiscountLine === 'boolean' && typeof full.receiptsBranding.showLoyaltyPoints === 'boolean' && !!full.receiptsBranding.brandStyle);
  ok('tax enabled with empty label is rejected', await threwAsync(() => svc.patchCategory(owner, 'tax', { enabled: true, taxLabel: '' }), ValidationError));

  const prev = await svc.previewReceipt(owner);
  ok('receipt preview has lines incl Total', Array.isArray(prev.lines) && prev.lines.some((l) => l.label === 'Total'));
  ok('receipt preview shows business name', prev.businessName.length > 0);

  const sent = await svc.sendTestReceipt(owner, '+18565550142', 'SMS');
  ok('send-test SMS honest pending when A2P not registered', sent.queued === false && sent.status === 'pending');

  // The salon logo (Oct 2026): it was a process-memory Map that accepted any 'data:image' string (even 3 zero bytes) and
  // vanished on restart. Now the BYTES are checked, the file is stored, the salon's row points at it, the old file goes.
  const files = new Map<string, Buffer>();
  const media = { put: async (k: string, b: Buffer) => { files.set(k, b); return { url: '/media/' + k }; }, remove: async (k: string) => { files.delete(k); }, resolvePath: () => null };
  const logoSvc = new PosSettingsService(new InMemorySettingsRepository(), undefined, undefined, undefined, undefined, media);
  const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 6; return 'data:image/png;base64,' + b.toString('base64'); };
  // a READABLE JPEG (SOI, JFIF APP0, SOF0 64×64) — so labelled image/png only the declared-type check can refuse it
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, 0, 64, 0, 64, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  const jpegAsPng = 'data:image/png;base64,' + jpegBytes.toString('base64');
  // not a PNG (no signature) but a PNG-shaped IHDR right where a header reader looks — only sniffing the bytes refuses it
  const fakeSig = Buffer.alloc(33); Buffer.from('<script>', 'ascii').copy(fakeSig, 0); fakeSig.writeUInt32BE(13, 8); fakeSig.write('IHDR', 12, 'ascii'); fakeSig.writeUInt32BE(64, 16); fakeSig.writeUInt32BE(64, 20);
  const msgOf = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e instanceof ValidationError ? e.message : 'not a ValidationError'; } };
  ok('logo upload rejects a non-image address', await threwAsync(() => logoSvc.uploadReceiptLogo(owner, 'ftp://x'), ValidationError));
  ok('logo upload rejects an outside https address (no hot-linking)', await threwAsync(() => logoSvc.uploadReceiptLogo(owner, 'https://evil.example/logo.png'), ValidationError));
  ok('logo upload rejects a script labelled image/png', await threwAsync(() => logoSvc.uploadReceiptLogo(owner, 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>........').toString('base64')), ValidationError));
  ok('logo upload rejects 3 zero bytes (the old code accepted them)', await threwAsync(() => logoSvc.uploadReceiptLogo(owner, 'data:image/png;base64,AAAA'), ValidationError));
  ok('logo upload rejects a JPEG labelled PNG (type vs contents)', (await msgOf(() => logoSvc.uploadReceiptLogo(owner, jpegAsPng))) === 'The file type does not match the file contents.');
  ok('logo upload rejects bytes that only LOOK like a PNG header', (await msgOf(() => logoSvc.uploadReceiptLogo(owner, 'data:image/png;base64,' + fakeSig.toString('base64')))) === 'Only PNG, JPEG or WebP images can be used as the logo.');
  ok('logo upload rejects SVG', await threwAsync(() => logoSvc.uploadReceiptLogo(owner, 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')), ValidationError));
  ok('logo upload rejects too small / too large', await threwAsync(() => logoSvc.uploadReceiptLogo(owner, png(16, 16)), ValidationError) && await threwAsync(() => logoSvc.uploadReceiptLogo(owner, png(5000, 400)), ValidationError));
  ok('nothing was stored by a refused upload', files.size === 0);
  await logoSvc.patchCategory(owner, 'receipts-branding', { showLogo: false });
  ok('receipts start without a logo line', (await logoSvc.getState(owner)).receiptsBranding.showLogo === false);
  const up = await logoSvc.uploadReceiptLogo(owner, png(400, 200));
  const k1 = [...files.keys()][0] || '';
  ok('logo upload stores the file under the salon, random token, sniffed extension', files.size === 1 && /^salon-logos\/luxe001\/logo-[0-9a-f]{24}\.png$/.test(k1) && up.logoUrl === '/media/' + k1 && up.width === 400 && up.height === 200);
  ok('logo upload returns ref', up.logoRef === up.logoUrl);
  ok('state shows logo after upload', (await logoSvc.getState(owner)).receiptsBranding.showLogo === true);
  ok('receipt preview carries the stored logo', (await logoSvc.previewReceipt(owner)).logoRef === up.logoUrl);
  ok('the logo can be read back', (await logoSvc.getSalonLogo(owner))?.url === up.logoUrl);
  const up2 = await logoSvc.uploadReceiptLogo(owner, png(300, 300));
  ok('a new logo replaces the old FILE (no orphan)', files.size === 1 && up2.logoUrl !== up.logoUrl && !files.has(k1));
  ok('another salon has no logo', (await logoSvc.getSalonLogo(other)) === null);
  ok('logo remove clears it (row, receipt toggle and file)', (await logoSvc.removeReceiptLogo(owner)).removed === true && (await logoSvc.getState(owner)).receiptsBranding.showLogo === false && files.size === 0 && (await logoSvc.getSalonLogo(owner)) === null);
  ok('front-desk cannot upload logo (no receipts edit)', await threwAsync(() => logoSvc.uploadReceiptLogo(front, png(64, 64)), ForbiddenError));
  {
    // the readable JPEG above IS accepted when labelled for what it is (so the refusal above was the type check)
    const files2 = new Map<string, Buffer>();
    const jpgSvc = new PosSettingsService(new InMemorySettingsRepository(), undefined, undefined, undefined, undefined, { put: async (k: string, b: Buffer) => { files2.set(k, b); return { url: '/media/' + k }; }, remove: async (k: string) => { files2.delete(k); }, resolvePath: () => null } as any);
    const j = await jpgSvc.uploadReceiptLogo(owner, 'data:image/jpeg;base64,' + jpegBytes.toString('base64'));
    ok('the same JPEG labelled image/jpeg is stored as .jpg', /\/logo-[0-9a-f]{24}\.jpg$/.test(j.logoUrl) && j.width === 64 && j.height === 64 && files2.size === 1);
  }
  ok('no media storage → refused, nothing saved', await threwAsync(() => svc.uploadReceiptLogo(owner, png(64, 64)), ValidationError) && (await svc.getSalonLogo(owner)) === null);

  // the customer display's own words (spec §13): plain text, short, never markup
  ok('display tagline over 60 characters rejected', await threwAsync(() => svc.patchCategory(owner, 'customer-display-devices', { tagline: 'x'.repeat(61) }), ValidationError));
  ok('display tagline with HTML rejected', await threwAsync(() => svc.patchCategory(owner, 'customer-display-devices', { tagline: '<img src=x onerror=alert(1)>' }), ValidationError));
  ok('display idle message with HTML rejected', await threwAsync(() => svc.patchCategory(owner, 'customer-display-devices', { idleMessage: '<script>' }), ValidationError));
  ok('showBranchName must be a boolean', await threwAsync(() => svc.patchCategory(owner, 'customer-display-devices', { showBranchName: 'yes' }), ValidationError));
  const dsp = await svc.patchCategory(owner, 'customer-display-devices', { tagline: 'Relax • Refresh • Renew', showBranchName: true });
  ok('display tagline + branch name saved', dsp.tagline === 'Relax • Refresh • Renew' && dsp.showBranchName === true);
  // Email guide (Oct 31 2026): the email identity is validated server-side — never a smuggled address / header
  ok('email sender name with an address is refused', await threwAsync(() => svc.patchCategory(owner, 'notifications', { emailSenderName: 'Glow <spoof@x.com>' }), ValidationError));
  ok('email sender name with a line break is refused', await threwAsync(() => svc.patchCategory(owner, 'notifications', { emailSenderName: 'Glow\r\nBcc: x' }), ValidationError));
  ok('an invalid reply-to is refused', await threwAsync(() => svc.patchCategory(owner, 'notifications', { emailReplyTo: 'not-an-email' }), ValidationError));
  const em: any = await svc.patchCategory(owner, 'notifications', { emailSenderName: 'Glow Bar Nails', emailReplyTo: 'desk@glow.test', emailConfirmation: false });
  ok('email identity saved beside (not into) the SMS brand', em.emailSenderName === 'Glow Bar Nails' && em.emailReplyTo === 'desk@glow.test' && em.emailConfirmation === false);
  ok('front desk cannot change email settings', await threwAsync(() => svc.patchCategory(front, 'notifications', { emailSenderName: 'X' }), ForbiddenError));


  console.log(`\nsettings-core (with integrations): ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
