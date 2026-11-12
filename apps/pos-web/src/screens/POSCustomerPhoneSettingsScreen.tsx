// POSCustomerPhoneSettingsScreen.tsx — Customers › Phone Number Management (route /tenant/customers/phone-management).
// The route's screen is now the Phone Number Management center (PhoneManagementCenter.tsx, Phone Number Management Complete Build
// Guide); the salon's policy below is its Phone Settings panel, with every original control and behaviour kept.
//
// Two of these are not preferences. They decide who can move a customer's phone number — which decides where that
// customer's booking codes and appointment reminders are delivered. The screen says so, in plain words, because a
// toggle whose consequence is invisible is a toggle somebody flips without meaning to.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { authApi, type BranchOption } from '../api/authApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const GOLD = 'var(--aps-orange, #A96F22)';
const LINE = 'var(--line, #E7DBC6)';
const TEXT = 'var(--text, #2B2118)';
const MUTED = '#7A6C57';

interface Settings {
  allowReceptionistUpdates: boolean;
  requireSmsVerification: boolean;
  allowPendingUnverified: boolean;
  allowSharedFamilyPhones: boolean;
  customerAppSelfService: boolean;
  notifyOldNumber: boolean;
  allowManualConfirmation: boolean;
  requireManagerApproval: boolean;
  requireReauthentication: boolean;
  /** Branch view only: whether this branch has its own policy (else it inherits the salon-wide one). */
  branchOverride?: boolean;
  /** PHONE NUMBER MANAGEMENT 4 · 10: the server's explanation of where each value comes from (read-only). */
  policy?: PhonePolicyView;
}
type PolicySource = 'branch_override' | 'salon_policy' | 'platform_default';
type PhonePolicyView = { scope: 'salon' | 'branch'; source: PolicySource; superAdminOverride: boolean;
  keys: Partial<Record<string, { value: boolean; source: PolicySource; salonValue: boolean | null; platformDefault: boolean; differsFromSalon: boolean; differsFromDefault: boolean }>> };
const SOURCES: PolicySource[] = ['branch_override', 'salon_policy', 'platform_default'];
const onOff = (v: boolean) => (v ? t('phm.pol.on') : t('phm.pol.off'));
/** one short line per toggle: where its value comes from, and the value it would otherwise have */
function sourceTag(p: PhonePolicyView | undefined, key: string): string | undefined {
  const k = p?.keys?.[key]; if (!k || !SOURCES.includes(k.source)) return undefined;
  if (k.source === 'branch_override') return k.differsFromSalon ? t('phm.pol.tag.branchDiffers', { v: onOff(k.salonValue ?? k.platformDefault) }) : t('phm.pol.tag.branchSame');
  if (k.source === 'salon_policy') return p!.scope === 'branch' ? t('phm.pol.tag.inherited') : k.differsFromDefault ? t('phm.pol.tag.salonDiffers', { v: onOff(k.platformDefault) }) : t('phm.pol.tag.salonSame');
  return t('phm.pol.tag.default');
}

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 12 };

function Toggle({ on, onChange, label, hint, danger, disabled, tag }: {
  on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; danger?: boolean; disabled?: boolean; tag?: string;
}) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: danger && on ? '#8F3226' : TEXT }}>{label}</span>
        {hint ? <span style={{ display: 'block', fontSize: 11.5, color: danger && on ? '#8F3226' : MUTED, marginTop: 2, lineHeight: 1.45 }}>{hint}</span> : null}
        {tag ? <span style={{ display: 'block', fontSize: 11.5, color: GOLD, marginTop: 2 }} data-testid="phone-policy-tag">{tag}</span> : null}
      </span>
    </label>
  );
}

/** The salon's phone policy — the seven screenshot controls plus manager approval and re-authentication. Behaviour unchanged from the
 *  original screen: loads the saved values (never shows defaults on a failed load), saves each toggle immediately, branch scope. */
export function PhoneSettingsPanel({ canEdit = true }: { canEdit?: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Phase 3 (audit E10): one branch's own policy. '' = the salon-wide policy every branch inherits.
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchId] = useState('');
  useEffect(() => { authApi.branches().then((r) => setBranches(r.branches ?? [])).catch(() => setBranches([])); }, []);
  // Each call is spelled out (not a computed path) so the route checks can see which screen reaches which route.
  const b = encodeURIComponent(branchId);
  const fetchSettings = () => (branchId ? api.get<Settings>(`/pos/settings/customer-phone/branches/${b}`) : api.get<Settings>('/pos/settings/customer-phone'));
  const patchSettings = (patch: Partial<Settings>) => (branchId ? api.patch<Settings>(`/pos/settings/customer-phone/branches/${b}`, patch) : api.patch<Settings>('/pos/settings/customer-phone', patch));

  const load = useCallback(() => {
    setLoading(true); setErr(null); setOk(null);
    fetchSettings()
      .then(setS)
      // An error shows an error. It does NOT render defaults — a settings screen that silently shows the safe
      // values when it failed to load is how a salon believes a control is on when it is off.
      .catch((e: any) => { setErr(e?.message || t('pos.we_could_not_load_these_settings')); setS(null); })
      .finally(() => setLoading(false));
  }, [branchId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  const save = async (patch: Partial<Settings>) => {
    setBusy(true); setErr(null); setOk(null);
    try {
      const next = await patchSettings(patch);
      setS(branchId ? { ...next, branchOverride: true } : next); setOk(branchId ? t('pos.saved_for_this_branch') : t('people.common.saved'));
    } catch (e: any) {
      // The backend refuses the one combination that would switch off this salon's own online booking, and it says
      // why. Surface its message — it is the actionable half.
      setErr(e?.message || t('pos.we_could_not_save_that'));
    } finally { setBusy(false); }
  };

  const clearBranch = async () => {
    if (!branchId) return;
    setBusy(true); setErr(null); setOk(null);
    try { await api.del(`/pos/settings/customer-phone/branches/${b}`); setOk(t('people.phoneSettings.branchFollowsSalon')); load(); }
    catch (e: any) { setErr(e?.message || t('pos.we_could_not_remove_the_branch_14dp')); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 12, color: MUTED }} role="status">{t('pos.loading')}</div>;
  if (err && !s) return <div style={{ padding: 12, color: '#8F3226' }} role="alert">{err}</div>;
  if (!s) return null;
  const busy2 = busy || !canEdit;

  return (
    <div data-testid="phone-settings">
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 10px' }}>
        {t('pos.who_can_change_a_customer_rsquo_1xxf')}
      </p>

      {branches.length > 1 ? (
        <section style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} data-testid="branch-scope">
          <label style={{ fontSize: 13, color: TEXT }}>{t('pos.policy_for')}{' '}
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={t('pos.policy_scope')} style={{ padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 8 }}>
              <option value="">{t('pos.every_branch_salon_wide')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name || t('pos.branch')}</option>)}
            </select>
          </label>
          {branchId ? (
            <span style={{ fontSize: 12, color: MUTED }}>
              {s.branchOverride ? t('pos.this_branch_has_its_own_policy') : t('pos.this_branch_follows_the_salon_wide_1mue')}
              {s.branchOverride ? <button onClick={() => void clearBranch()} disabled={busy} style={{ marginLeft: 8, background: 'none', border: 0, color: GOLD, fontWeight: 600, cursor: 'pointer' }}>{t('pos.use_the_salon_wide_policy')}</button> : null}
            </span>
          ) : null}
        </section>
      ) : null}

      {s.policy && SOURCES.includes(s.policy.source) ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 10px' }} data-testid="phone-policy-source">
          {t('phm.pol.source.' + s.policy.source)} {s.policy.superAdminOverride ? t('phm.pol.sa.yes') : t('phm.pol.sa.none')}
        </p>
      ) : null}

      <section style={card}>
        <div style={{ font: '600 15px/1.2 "Playfair Display",serif', color: TEXT, marginBottom: 4 }}>{t('pos.who_may_change_a_number')}</div>
        <Toggle
          label={t('pos.receptionists_may_update_a_customer_s_tiyg')}
          hint={t('pos.a_receptionist_is_who_a_social_s12i')}
          on={s.allowReceptionistUpdates}
          tag={sourceTag(s.policy, 'allowReceptionistUpdates')}
          disabled={busy2}
          onChange={(v) => save({ allowReceptionistUpdates: v })}
        />
        <Toggle
          label={t('pos.customers_may_change_their_own_number_ds55')}
          hint={t('pos.the_app_verifies_the_new_number_rx9p')}
          on={s.customerAppSelfService}
          tag={sourceTag(s.policy, 'customerAppSelfService')}
          disabled={busy2}
          onChange={(v) => save({ customerAppSelfService: v })}
        />
        <Toggle
          label={t('pos.a_manager_must_approve_a_receptionist_1omt')}
          hint={t('pos.the_change_waits_nothing_is_texted_pk27')}
          on={s.requireManagerApproval}
          tag={sourceTag(s.policy, 'requireManagerApproval')}
          disabled={busy2}
          onChange={(v) => save({ requireManagerApproval: v })}
        />
        <Toggle
          label={t('pos.customers_re_enter_their_password_to_17wb')}
          hint={t('pos.a_stolen_phone_or_an_unlocked_wzs3')}
          on={s.requireReauthentication}
          tag={sourceTag(s.policy, 'requireReauthentication')}
          disabled={busy2}
          onChange={(v) => save({ requireReauthentication: v })}
        />
      </section>

      <section style={card}>
        <div style={{ font: '600 15px/1.2 "Playfair Display",serif', color: TEXT, marginBottom: 4 }}>{t('pos.what_must_be_proved')}</div>
        <Toggle
          label={t('pos.require_sms_verification_when_staff_change_6e2d')}
          hint={
            s.requireSmsVerification
              ? t('pos.on_a_6_digit_code_is_4gge')
              : t('pos.off_a_staff_change_takes_effect_12dj')
          }
          on={s.requireSmsVerification}
          tag={sourceTag(s.policy, 'requireSmsVerification')}
          disabled={busy2}
          onChange={(v) => save({ requireSmsVerification: v })}
        />
        <Toggle
          label={t('pos.save_an_unverified_number_as_pending')}
          hint={t('pos.staff_can_record_the_number_the_1i2b')}
          on={s.allowPendingUnverified}
          tag={sourceTag(s.policy, 'allowPendingUnverified')}
          disabled={busy2}
          onChange={(v) => save({ allowPendingUnverified: v })}
        />

        {/* The one that deserves a warning, and gets one. */}
        <Toggle
          danger
          label={t('pos.allow_managers_to_confirm_a_number_1p0t')}
          hint={
            s.allowManualConfirmation
              ? t('pos.on_a_manager_can_mark_a_3el9')
              : t('pos.off_a_manager_s_judgement_is_6ywg')
          }
          on={s.allowManualConfirmation}
          tag={sourceTag(s.policy, 'allowManualConfirmation')}
          disabled={busy2}
          onChange={(v) => save({ allowManualConfirmation: v })}
        />
      </section>

      <section style={card}>
        <div style={{ font: '600 15px/1.2 "Playfair Display",serif', color: TEXT, marginBottom: 4 }}>{t('pos.duplicates_and_notifications')}</div>
        <Toggle
          label={t('pos.allow_shared_family_phone_numbers')}
          hint={t('pos.two_customers_may_share_one_number_1xgk')}
          on={s.allowSharedFamilyPhones}
          tag={sourceTag(s.policy, 'allowSharedFamilyPhones')}
          disabled={busy2}
          onChange={(v) => save({ allowSharedFamilyPhones: v })}
        />
        <Toggle
          label={t('pos.notify_the_old_number_when_a_v3l8')}
          hint={t('pos.how_someone_finds_out_if_their_1ag1')}
          on={s.notifyOldNumber}
          tag={sourceTag(s.policy, 'notifyOldNumber')}
          disabled={busy2}
          onChange={(v) => save({ notifyOldNumber: v })}
        />
      </section>

      {err ? <div role="alert" style={{ ...card, background: '#FBEDE9', borderColor: '#F0D2C9', color: '#8F3226', fontSize: 13 }}>{err}</div> : null}
      {ok ? <div role="status" style={{ fontSize: 12.5, color: '#3F6B46' }}>{ok}</div> : null}
    </div>
  );
}
