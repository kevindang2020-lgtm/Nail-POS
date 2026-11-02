// DisplaySettingsCard.tsx — Dual-Screen mandate §118 in the POS (Devices → Customer Displays): the owner's options for
// what the customer display offers its guests — appointment and walk-in check-in, new guests, services and a preferred
// technician, the estimated wait — and its languages (§119: English, Vietnamese; the default first). Advertising on/off
// and the ad duration live in Marketing & Growth → Customer Display Advertising → Settings; the salon's logo in Receipts
// & Branding. The master check-in switch is the platform's (Super Admin) and is shown, not edited. Only what changed is
// sent; the server cleans and refuses an unusable language list.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { posDisplaySettingsApi, type DisplaySettingsPatch, type GoCheckInSettings } from '../../api/posDisplaySettingsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Toggle = 'appointmentCheckinEnabled' | 'walkinCheckinEnabled' | 'newCustomerEnabled' | 'serviceSelectionEnabled' | 'technicianPreferenceEnabled' | 'showWaitEstimate';
// developer merge (Oct 2026): each option carries a one-line description under its label on the redesigned option tiles
// (read at render, so a language switch re-reads it)
const TOGGLES: [Toggle, () => string, () => string][] = [
  ['appointmentCheckinEnabled', () => t('pos.appointment_check_in'), () => t('pos.allow_guests_with_existing_bookings_to_check_in')],
  ['walkinCheckinEnabled', () => t('admin.display.toggle.walkIn'), () => t('pos.enable_queue_check_in_for_walk_in_clients')],
  ['newCustomerEnabled', () => t('admin.display.toggle.newGuests'), () => t('pos.first_time_visitors_can_enter_name_phone')],
  ['serviceSelectionEnabled', () => t('admin.display.toggle.chooseServices'), () => t('pos.display_interactive_menu_of_salon_services')],
  ['technicianPreferenceEnabled', () => t('admin.display.toggle.askTechnician'), () => t('pos.allow_requesting_a_specific_technician')],
  ['showWaitEstimate', () => t('admin.display.toggle.showWait'), () => t('pos.show_ai_queue_wait_estimate_on_display')],
];
const SHOW_DISPLAY_LANGUAGES = false;
const LANGS: { code: string; label: string; flag: string }[] = [{ code: 'en', get label() { return t('pos.english'); }, flag: 'EN' }, { code: 'vi', get label() { return t('pos.ti_ng_vi_t_vietnamese'); }, flag: 'VI' }];
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const headStyle: CSSProperties = { fontWeight: 800, fontSize: 13.5, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const panel: CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line, #E8DFD1)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column' };
const sectionLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8A7A66' };

/** What changed, and only that (pure). */
export function settingsPatch(saved: GoCheckInSettings, form: GoCheckInSettings): DisplaySettingsPatch {
  const p: DisplaySettingsPatch = {};
  for (const [k] of TOGGLES) if (saved[k] !== form[k]) p[k] = form[k];
  if (!sameList(saved.displayLanguages ?? ['en'], form.displayLanguages ?? ['en'])) p.displayLanguages = form.displayLanguages;
  return p;
}

export function DisplaySettingsCard() {
  const [saved, setSaved] = useState<GoCheckInSettings | null>(null);
  const [form, setForm] = useState<GoCheckInSettings | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    let live = true;
    posDisplaySettingsApi.get().then((s) => { if (live) { setSaved(s); setForm(s); } })
      .catch((e: any) => { if (!live) return; if (e?.status === 403) setHidden(true); else setNote({ ok: false, msg: e?.message || t('pos.could_not_load_the_display_settings') }); });
    return () => { live = false; };
  }, []);
  const patch = useMemo(() => (saved && form ? settingsPatch(saved, form) : {}), [saved, form]);
  if (hidden) return null;
  if (!form || !saved) return note ? <section style={{ ...panel, color: '#B4453C' }}>{note.msg}</section> : null;

  const langs = form.displayLanguages?.length ? form.displayLanguages : ['en'];
  const setLangOn = (code: string, on: boolean) => {
    const next = on ? [...langs, code] : langs.filter((l) => l !== code);
    if (next.length) setForm({ ...form, displayLanguages: next });
  };
  const makeDefault = (code: string) => setForm({ ...form, displayLanguages: [code, ...langs.filter((l) => l !== code)] });
  const dirty = Object.keys(patch).length > 0;
  const save = async () => {
    setBusy(true); setNote(null);
    try { const s = await posDisplaySettingsApi.save(patch); setSaved(s); setForm(s); setNote({ ok: true, msg: t('pos.display_settings_saved') }); }
    catch (e: any) { setNote({ ok: false, msg: e?.message || t('pos.the_display_settings_could_not_be_1bcd') }); }
    finally { setBusy(false); }
  };

  return (
    <section style={panel} data-testid="display-settings-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={headStyle}>{t('pos.customer_display_settings')}</span>
        {saved.enabled ? <span className="pill ok">{t('pos.check_in_active')}</span> : <span className="pill warn">{t('pos.check_in_inactive')}</span>}
      </div>
      <div className="sub" style={{ fontSize: 12, color: '#8A7A66', lineHeight: 1.4, maxWidth: 840, marginBottom: 12 }}>
        {saved.enabled ? t('pos.check_in_is_on_for_your_1o64') : t('pos.check_in_is_off_for_your_ybr0')} {t('pos.what_your_displays_offer_guests_and_hl4x')}
      </div>

      <div style={{ ...sectionLabel, marginBottom: 8 }}>{t('pos.guest_check_in_features')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, marginBottom: 16 }}>
        {TOGGLES.map(([k, labelOf, desc]) => {
          const checked = !!form[k];
          const label = labelOf();
          return (
            <label key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: checked ? '1px solid #A96F22' : '1px solid var(--line, #E8DFD1)', background: checked ? '#FFFDF8' : '#FAF8F4', cursor: busy ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease' }}>
              <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} aria-label={label} style={{ width: 16, height: 16, accentColor: '#A96F22', cursor: 'pointer', marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: checked ? 700 : 600, color: 'var(--text, #2A2118)', lineHeight: 1.25 }}>{label}</div>
                <div style={{ fontSize: 11, color: '#8A7A66', marginTop: 3, lineHeight: 1.3 }}>{desc()}</div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Kevin (Oct 28 2026): the customer display is English only — no language choice here (the server keeps it English) */}
      {SHOW_DISPLAY_LANGUAGES ? (<>
      <div style={{ ...sectionLabel, marginBottom: 6 }}>{t('pos.languages_on_the_display')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }} role="group" aria-label={t('pos.languages_on_the_display')}>
        {LANGS.map((l) => {
          const on = langs.includes(l.code);
          const isDefault = langs[0] === l.code;
          return (
            <div key={l.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, border: on ? '1px solid #D8A646' : '1px solid var(--line, #E8DFD1)', background: on ? '#FFFDF8' : '#FAF8F4', maxWidth: 480 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text, #2A2118)', cursor: 'pointer' }}>
                <input type="checkbox" checked={on} disabled={busy || (on && langs.length === 1)} onChange={(e) => setLangOn(l.code, e.target.checked)} aria-label={l.label} style={{ width: 16, height: 16, accentColor: '#A96F22', cursor: (on && langs.length === 1) ? 'not-allowed' : 'pointer' }} />
                <span style={{ display: 'inline-flex', padding: '1px 5px', borderRadius: 4, background: 'var(--cream2, #F3E7D2)', color: 'var(--g7, #A96F22)', fontSize: 9.5, fontWeight: 800 }}>{l.flag}</span>
                <span>{l.label}</span>
              </label>
              {on ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: isDefault ? 'var(--cream2, #F3E7D2)' : 'transparent', border: isDefault ? '1px solid var(--gline, #E2C686)' : '1px solid transparent', color: isDefault ? 'var(--g7, #A96F22)' : '#8A7A66', fontSize: 11, fontWeight: isDefault ? 700 : 500, cursor: 'pointer' }}>
                  <input type="radio" name="display-default-language" checked={isDefault} disabled={busy} onChange={() => makeDefault(l.code)} aria-label={t('pos.default_label', { label: String(l.label) })} style={{ accentColor: '#A96F22', cursor: 'pointer' }} />
                  <span>{t('pos.default_4')}</span>
                </label>
              ) : null}
            </div>
          );
        })}
        <div className="sub" style={{ fontSize: 11.5, color: '#8A7A66', marginTop: 2 }}>{t('pos.guests_can_switch_for_their_own_1ufy')}</div>
      </div>
      </>) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line, #E8DFD1)' }}>
        <button className="btn primary whitespace-nowrap w-fit" disabled={!dirty || busy} onClick={() => { void save(); }} aria-label={t('pos.save_display_settings')} style={{ height: 32, padding: '0 18px', fontSize: 12, fontWeight: 800, cursor: (!dirty || busy) ? 'not-allowed' : 'pointer', opacity: (!dirty || busy) ? 0.6 : 1 }}>{busy ? t('pos.saving_2') : t('pos.save_2')}</button>
        {note ? (
          <span role="status" style={{ fontSize: 12, fontWeight: 600, color: note.ok ? '#2E7D4F' : '#B4453C', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true">{note.ok ? '✓' : '⚠'}</span>{note.msg}
          </span>
        ) : null}
      </div>
    </section>
  );
}
