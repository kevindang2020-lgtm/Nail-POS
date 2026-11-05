// ai-scheduling-ops.platform-switch.ts — BUILD_PLAN Phase 7 (agent B): the platform-wide kill switch for the AI Scheduling
// Optimizer (SchedPlatformSwitchPort). Mirrors Phase 6 / the Super Admin kill-switch centre: ONE platform_settings row
// (setting_group 'kill_switches'), toggled by Super Admin (PUT super-admin/ai-scheduling-optimizer/platform-switch, step-up
// + reason + platform_setting_changes history + audit) and read here with a short cache. A read failure keeps the last
// known value (never silently flips a switch on or off).
//
// Two platform switches stop optimizer AUTOMATION: this one (it also refuses generation — the engine reads isKilled())
// and the platform-wide 'ai.auto_actions_disabled' (every AI automatic action); automationBlocked() answers for both.
import { sql, type Kysely } from 'kysely';
import type { SchedPlatformSwitchPort } from './ai-scheduling.ports';
import { rowsOf } from './ai-scheduling-ops.common';

export const SCHED_PLATFORM_SETTING = 'ai.scheduling_optimizer_disabled';
export const AI_AUTO_ACTIONS_SETTING = 'ai.auto_actions_disabled';
const truthy = (v: unknown) => v === true || v === 'true';

export interface PlatformFlagsReader { read(): Promise<{ optimizerKilled: boolean; autoActionsDisabled: boolean }> }

export class KyselyPlatformFlagsReader implements PlatformFlagsReader {
  constructor(private readonly db: Kysely<any>) {}
  async read() {
    const rows = rowsOf(await sql`select setting_key, value from platform_settings where setting_key in (${SCHED_PLATFORM_SETTING}, ${AI_AUTO_ACTIONS_SETTING})`.execute(this.db));
    const on = (k: string) => truthy(rows.find((r) => r.setting_key === k)?.value);
    return { optimizerKilled: on(SCHED_PLATFORM_SETTING), autoActionsDisabled: on(AI_AUTO_ACTIONS_SETTING) };
  }
}

export class SchedPlatformSwitch implements SchedPlatformSwitchPort {
  private last: { optimizerKilled: boolean; autoActionsDisabled: boolean } = { optimizerKilled: false, autoActionsDisabled: false };
  private at: number | null = null;   // when the last successful read happened (null = never)
  constructor(private readonly reader: PlatformFlagsReader | null, private readonly ttlMs = 15_000, private readonly now: () => number = Date.now) {}
  private async flags() {
    if (!this.reader) return this.last;
    if (this.at !== null && this.now() - this.at < this.ttlMs) return this.last;
    try { this.last = await this.reader.read(); this.at = this.now(); } catch { /* keep the last known value */ }
    return this.last;
  }
  /** The optimizer's platform kill switch: automation off everywhere AND generation refused. */
  async isKilled(): Promise<boolean> { return (await this.flags()).optimizerKilled; }
  /** Automation may not run anywhere: the optimizer switch OR the platform's 'AI automatic actions' switch. */
  async automationBlocked(): Promise<{ blocked: boolean; by: 'optimizer_platform_switch' | 'ai_auto_actions_disabled' | null }> {
    const f = await this.flags();
    if (f.optimizerKilled) return { blocked: true, by: 'optimizer_platform_switch' };
    if (f.autoActionsDisabled) return { blocked: true, by: 'ai_auto_actions_disabled' };
    return { blocked: false, by: null };
  }
  /** Drop the cache (after Super Admin flips the switch in this process). */
  invalidate(): void { this.at = null; }
}
