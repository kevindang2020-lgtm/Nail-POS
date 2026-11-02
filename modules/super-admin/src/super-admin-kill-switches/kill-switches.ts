// kill-switches.ts — Constitution 7 §34: ONE place to see and flip the platform's emergency kill switches. Each switch
// stays where its owner module already reads it (no copy, no second source of truth):
//   • ai.auto_actions        — platform_settings 'ai.auto_actions_disabled' (read by AiPlatform, 30 s cache); toggled HERE
//   • sms.emergency_send     — platform_settings 'sms.emergency_send_disabled'; toggled by POST /super-admin/sms-packages/platform-controls
//   • booking.verification   — booking_verification_platform_policy (platform row); toggled by POST /super-admin/booking-verification/emergency-disable
//   • deals.engine           — platform_settings 'deals.engine_disabled' (read by DealsService, 30 s cache); toggled HERE
//   • payments.cardpointe / payments.clover — platform_settings 'payments.<x>_disabled' (read by PaymentGatewayResolver, 15 s cache); toggled HERE
//   • payments.tap_to_pay / payments.fiserv_tap_to_pay — platform_settings 'payments.tap_to_pay_disabled' (every Tap to Pay
//     on iPhone surface, Owner & Manager Payment App mandate §198) and 'payments.fiserv_tap_to_pay_disabled' (the Fiserv
//     CommerceHub Tap to Pay provider only, §199); read by MobileCheckoutService (15 s cache). Clover Compact / CardPointe
//     terminal charges are untouched by either. Toggled HERE.
// Every toggle requires the permission, step-up, a reason and an audit record (§34).
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { KILL_SWITCH_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

export interface KillSwitchView { key: string; label: string; stops: string; active: boolean; reason: string | null; since: string | null; toggle: { method: 'POST'; path: string; body: string } }
export const MIN_KILL_REASON = 10;
/** Switches that live in platform_settings and are toggled by this centre. */
export const SETTING_SWITCHES: Readonly<Record<string, string>> = { 'ai.auto_actions': 'ai.auto_actions_disabled', 'deals.engine': 'deals.engine_disabled',
  'payments.cardpointe': 'payments.cardpointe_disabled', 'payments.clover': 'payments.clover_disabled',
  'payments.tap_to_pay': 'payments.tap_to_pay_disabled', 'payments.fiserv_tap_to_pay': 'payments.fiserv_tap_to_pay_disabled' };

@Injectable()
export class KillSwitchService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  async list(): Promise<KillSwitchView[]> {
    if (!this.db) return [];
    const s = (await sql<any>`select setting_key, value, updated_at from platform_settings where setting_key in ('ai.auto_actions_disabled', 'sms.emergency_send_disabled', 'deals.engine_disabled', 'payments.cardpointe_disabled', 'payments.clover_disabled', 'payments.tap_to_pay_disabled', 'payments.fiserv_tap_to_pay_disabled')`.execute(this.db)).rows;
    const lastReason = async (key: string) => (await sql<any>`select reason, created_at from platform_setting_changes where setting_key = ${key} order by created_at desc limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0] ?? null;
    const on = (k: string) => { const r = s.find((x: any) => x.setting_key === k); return { active: r ? (r.value === true || r.value === 'true') : false, at: r?.updated_at ? new Date(r.updated_at).toISOString() : null }; };
    const bv: any = (await sql<any>`select emergency_disabled, reason, updated_at from booking_verification_platform_policy where tenant_id is null limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    const ai = on('ai.auto_actions_disabled'); const aiWhy = await lastReason('ai.auto_actions_disabled');
    const sms = on('sms.emergency_send_disabled');
    const deals = on('deals.engine_disabled'); const dealsWhy = await lastReason('deals.engine_disabled');
    const pay = async (k: string) => { const x = on(k); const w = await lastReason(k); return { active: x.active, reason: x.active ? (w?.reason ?? null) : null, since: x.active ? x.at : null }; };
    const cp = await pay('payments.cardpointe_disabled'); const cl = await pay('payments.clover_disabled');
    const ttp = await pay('payments.tap_to_pay_disabled'); const fttp = await pay('payments.fiserv_tap_to_pay_disabled');
    return [
      { key: 'ai.auto_actions', label: 'AI automatic actions', stops: 'Automatic AI actions (assignment, scheduling automation). Read-only and suggestion AI keep working.',
        active: ai.active, reason: ai.active ? (aiWhy?.reason ?? null) : null, since: ai.active ? ai.at : null,
        toggle: { method: 'POST', path: '/super-admin/kill-switches/ai.auto_actions', body: '{ active, reason }' } },
      { key: 'sms.emergency_send', label: 'SMS sending (emergency stop)', stops: 'All outbound platform SMS, including mass sends.',
        active: sms.active, reason: null, since: sms.active ? sms.at : null,
        toggle: { method: 'POST', path: '/super-admin/sms-packages/platform-controls', body: "{ key: 'sms.emergency_send_disabled', enabled, reason }" } },
      { key: 'booking.verification', label: 'Booking phone verification provider', stops: 'The booking verification provider; bookings continue without the verification step.',
        active: !!bv?.emergency_disabled, reason: bv?.emergency_disabled ? (bv?.reason ?? null) : null, since: bv?.emergency_disabled && bv?.updated_at ? new Date(bv.updated_at).toISOString() : null,
        toggle: { method: 'POST', path: '/super-admin/booking-verification/emergency-disable', body: '{ disabled, reason }' } },
      { key: 'deals.engine', label: 'Deals engine', stops: 'The public deals feed, new deal reservations and deal discounts at checkout (the sale continues at full price).',
        active: deals.active, reason: deals.active ? (dealsWhy?.reason ?? null) : null, since: deals.active ? deals.at : null,
        toggle: { method: 'POST', path: '/super-admin/kill-switches/deals.engine', body: '{ active, reason }' } },
      { key: 'payments.cardpointe', label: 'Card payments — Fiserv CardPointe', stops: 'Every card charge through CardPointe at every salon (checkout, top-ups, membership renewals). Salon settings are untouched.',
        ...cp, toggle: { method: 'POST', path: '/super-admin/kill-switches/payments.cardpointe', body: '{ active, reason }' } },
      { key: 'payments.clover', label: 'Card payments — Clover', stops: 'Every card charge through Clover at every salon. Salon settings are untouched.',
        ...cl, toggle: { method: 'POST', path: '/super-admin/kill-switches/payments.clover', body: '{ active, reason }' } },
      { key: 'payments.tap_to_pay', label: 'Tap to Pay on iPhone (all providers)', stops: 'Every Tap to Pay on iPhone payment on the Owner & Manager Payment App at every salon. Clover Compact, CardPointe terminal, cash and gift-card payments keep working.',
        ...ttp, toggle: { method: 'POST', path: '/super-admin/kill-switches/payments.tap_to_pay', body: '{ active, reason }' } },
      { key: 'payments.fiserv_tap_to_pay', label: 'Tap to Pay on iPhone — Fiserv CommerceHub', stops: 'Tap to Pay on iPhone through the Fiserv CommerceHub provider only; other processors and every terminal keep working.',
        ...fttp, toggle: { method: 'POST', path: '/super-admin/kill-switches/payments.fiserv_tap_to_pay', body: '{ active, reason }' } },
    ];
  }

  /** The AI platform switch (the one that had no toggle anywhere): setting + immutable history + audit, one transaction. */
  async setAiAutoActions(actor: { userId: string | null }, active: boolean, reason: string): Promise<KillSwitchView[]> { return this.setSettingSwitch('ai.auto_actions', actor, active, reason); }

  /** A platform_settings switch: setting + immutable history + audit, one transaction. */
  async setSettingSwitch(key: string, actor: { userId: string | null }, active: boolean, reason: string): Promise<KillSwitchView[]> {
    const settingKey = SETTING_SWITCHES[key];
    if (!settingKey) throw new BadRequestException({ code: 'toggle_elsewhere', message: 'This switch is toggled by its own control (see its toggle path).' });
    if (!this.db) throw new ConflictException('Kill switches need the database.');
    const why = String(reason ?? '').trim();
    if (why.length < MIN_KILL_REASON) throw new BadRequestException({ code: 'reason_required', message: `A reason of at least ${MIN_KILL_REASON} characters is required.` });
    await this.db.transaction().execute(async (trx: any) => {
      const prev: any = (await sql`select value, version from platform_settings where setting_key = ${settingKey} for update`.execute(trx)).rows[0];
      await sql`insert into platform_settings (setting_key, setting_group, value, value_type, version)
                values (${settingKey}, 'kill_switches', ${JSON.stringify(active)}::jsonb, 'boolean', 1)
                on conflict (setting_key) do update set value = excluded.value, version = platform_settings.version + 1, updated_at = now()`.execute(trx);
      await sql`insert into platform_setting_changes (setting_key, setting_group, previous_value, new_value, version, actor, actor_role, reason, source)
                values (${settingKey}, 'kill_switches', ${prev ? JSON.stringify(prev.value) : null}::jsonb, ${JSON.stringify(active)}::jsonb,
                        ${Number(prev?.version ?? 0) + 1}, ${actor.userId}, 'SUPER_ADMIN', ${why}, 'ui')`.execute(trx);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actor.userId}, 'SUPER_ADMIN', ${active ? 'kill_switch_activated' : 'kill_switch_released'}, 'kill_switch', null,
                        ${JSON.stringify({ key, active, reason: why })}::jsonb)`.execute(trx);
    });
    return this.list();
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/kill-switches')
export class KillSwitchController {
  constructor(private readonly svc: KillSwitchService) {}
  @Get() @RequirePermission('super_admin.system_operations.view')
  list() { return this.svc.list(); }

  @RequireStepUp()
  @Post(':key') @RequirePermission('super_admin.system.manage')
  set(@Param('key') key: string, @Body(ValidatedBody(KILL_SWITCH_BODY, { strict: true })) b: { active?: boolean; reason?: string }, @Req() req: any) {
    return this.svc.setSettingSwitch(String(key), { userId: req?.ctx?.userId ?? null }, b?.active === true, String(b?.reason ?? ''));
  }
}

@Module({ controllers: [KillSwitchController], providers: [KillSwitchService] })
export class SuperAdminKillSwitchesModule {}
