// realtime-producer-gate.vitest.spec — BUILD_PLAN Phase 15 (Constitution 9 §246): NO PRODUCER is a FAILURE of the realtime
// contract gate, and settings_updated is produced and delivered.
//
// settings_updated sat on the gate's report-only NO PRODUCER line for weeks although seven tenant_settings writers (the
// canonical one: PosSettingsService.patchCategory) emit it — through notifySettingsChanged in @aipowersalon/realtime-contracts,
// a package the producer scan never read. The gate now counts a server call to a package helper that emits, and fails on
// any event nothing emits.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { EVENTS, rooms, screensToRefetch, notifySettingsChanged } from '@aipowersalon/realtime-contracts';
import { CHANNELS } from '@aipowersalon/realtime-client';
import { InProcessEmitter } from './realtime.gateway';

const SCRIPT = resolve(__dirname, '../../scripts/audit-realtime-contract.mjs');
const audit = (root?: string) => {
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf8', env: { ...process.env, ...(root ? { REALTIME_AUDIT_ROOT: root } : {}) } });
  return { code: r.status, out: JSON.parse(r.stdout || '{}') as { noProducer: string[]; problems: string[] } };
};

describe('the real tree', () => {
  it('every realtime registry event has a producer, and the gate passes', () => {
    const { code, out } = audit();
    expect(out.noProducer).toEqual([]);
    expect(out.problems).toEqual([]);
    expect(code).toBe(0);
  });
});

describe('settings_updated reaches the client that waits for it', () => {
  it('the save\'s notifier delivers it to the saving tenant\'s owner room — the room the Owner App stream subscribes to — and to no other tenant', () => {
    const bus = new InProcessEmitter();
    const mine: Array<{ event: string; payload: unknown }> = []; const other: string[] = [];
    bus.subscribe(rooms.ownerTenant('tenant-a'), (e: any) => mine.push({ event: e.event, payload: e.payload }));
    bus.subscribe(rooms.ownerTenant('tenant-b'), (e: any) => other.push(e.event));
    notifySettingsChanged(bus as any, 'tenant-a', 'tax');
    expect(mine.map((m) => m.event)).toEqual(['settings_updated']);
    expect(JSON.stringify(mine[0].payload)).toContain('"category":"tax"');
    expect(other).toEqual([]);
    // the Owner App stream (/owner/stream) opens exactly that room
    expect(readFileSync(resolve(__dirname, '../domain-streams/owner-realtime.controller.ts'), 'utf8')).toMatch(/rooms\.ownerTenant\(c\.tenantId\)/);
  });
  it('the owner dashboard channel listens for it and the registry routes it to the settings screens', () => {
    expect(CHANNELS['owner.dashboard']).toContain(EVENTS.settingsUpdated);
    expect(screensToRefetch('settings_updated')).toEqual(['settings']);
  });
});

// ── fixtures: the producer rule itself ──────────────────────────────────────────────────────────────────────────
const CORE = `export const EVENTS = {
  settingsUpdated: "settings_updated", queueUpdated: "queue_updated",
} as const;
export const EVENT_VERSIONS = {
  settings_updated: 1, queue_updated: 1,
};
const AFFECTS = {
  settings_updated: ["settings"],
  queue_updated: ["queue"],
};
export const rooms = {
  ownerTenant: (t: string) => \`tenant:\${t}:owner\`,
};
`;
const HELPER = `declare const EVENTS: any;   // the fixture's registry (a real helper imports it)
export function notifySettingsChanged(rt: any, tenantId: string, category: string): void {
  try { rt?.toOwner(tenantId, EVENTS.settingsUpdated, { category }); } catch { /* best-effort */ }
}
`;
function tree(server: string): string {
  const root = mkdtempSync(join(tmpdir(), 'rtgate-'));
  const files: Record<string, string> = {
    'packages/realtime-contracts/src/realtime-core.ts': CORE,
    'packages/realtime-contracts/src/settings-changed.ts': HELPER,
    'packages/realtime-client/src/core.ts': `export { EVENTS } from '@aipowersalon/realtime-contracts';\n`,
    'packages/realtime-client/src/client.ts': `export const CHANNELS = {\n  'owner.dashboard': [EVENTS.settingsUpdated],\n} as const;\n`,
    'apps/api/src/queue.ts': `export const q = (rt: any) => rt.toTenant({}, EVENTS.queueUpdated, {});\n`,
    'apps/api/src/settings.service.ts': server,
  };
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), body); }
  return root;
}

describe('the gate on fixtures', () => {
  it('a server call to the package helper that emits it is a producer', () => {
    const root = tree(`import { notifySettingsChanged } from '@aipowersalon/realtime-contracts';\nexport async function save(rt: any) { notifySettingsChanged(rt, 't', 'tax'); }\n`);
    try { expect(audit(root)).toMatchObject({ code: 0, out: { noProducer: [], problems: [] } }); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a helper nobody calls is not a producer — and NO PRODUCER fails the gate', () => {
    const root = tree(`export async function save() { /* nothing */ }\n`);
    try { const r = audit(root); expect(r.out.noProducer).toEqual(['settings_updated']); expect(r.out.problems).toEqual([expect.stringMatching(/^NO PRODUCER: "settings_updated"/)]); expect(r.code).toBe(1); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('a call that only appears in a comment is not a producer', () => {
    const root = tree(`// notifySettingsChanged(rt, 't', 'tax') is called by the other service\nexport async function save() {}\n`);
    try { expect(audit(root).out.noProducer).toEqual(['settings_updated']); } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
