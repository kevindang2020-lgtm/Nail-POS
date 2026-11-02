import { createRequire } from 'node:module'; import { spawn } from 'node:child_process';
const ROOT = '/home/claude/aipowersalon'; const OUT = ROOT + '/tooling/cash-refunds-one-screen/results/fit';
const { chromium } = createRequire('/opt/npm-tools/node_modules/x.js')('playwright');
const PORT = 4391, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', ROOT + '/tooling/full-system-test/unit-standin/register.mjs', ROOT + '/tooling/cash-refunds-one-screen/live-server.mjs'], { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: 'aps' }, stdio: 'ignore' });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1366, height: 633 } })).newPage();
const s = async () => { await p.waitForLoadState('networkidle').catch(() => 0); await p.waitForTimeout(600); };
await p.goto(BASE + '/cash-handoffs'); await p.waitForSelector('.work.fit'); await s();
await p.locator('[data-testid="handoffs"] tbody tr', { hasText: 'Mai Nguyen' }).getByRole('button', { name: 'Count' }).click(); await s();
await p.check('[data-testid="use-sheet"]'); await p.locator('[data-testid="sheet"] input').nth(1).fill('1'); await p.locator('[data-testid="sheet"] input').nth(2).fill('1'); await s();
await p.screenshot({ path: OUT + '/dialog-count-1366x633.png' }); await p.keyboard.press('Escape');
await p.goto(BASE + '/tenant/payments/refunds-voids'); await p.waitForSelector('.work.fit'); await s();
await p.click('[data-testid="find-payment"]'); await p.fill('[data-testid="find-query"]', '(856) 555-1234'); await s();
await p.screenshot({ path: OUT + '/dialog-find-1366x633.png' });
await p.locator('[data-testid="find-refund"]').first().click(); await s(); await p.screenshot({ path: OUT + '/dialog-refund-1366x633.png' });
await b.close(); srv.kill();
