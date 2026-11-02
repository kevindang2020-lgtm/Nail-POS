import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { useStepUp, isStepUpCancelled } from '../screens/access/accessUi';

// TechnicianAccessPanel — what this technician can do IN THIS SALON.
//
// == WHY THIS COMPONENT DID NOT EXIST ====================================================================
//
// The endpoints behind it have been live the whole time. `GET/PATCH /pos/technicians/:id/app-access`,
// `/permissions`, `/skills`. And two things were true at once:
//
//   1. The backend accepted every write and stored NOTHING — `setPermissions` literally did `return p`, echoing
//      the input straight back. (Migration 377 gave the three of them real tables.)
//   2. There was no screen. Nothing in pos-web has ever called any of them.
//
// So the fix in (1) landed somewhere nobody could reach. Built, tested, never wired — the exact pattern this
// codebase's checkers exist for, and the one `check:crosswire` structurally cannot catch: it hunts for frontend
// calls with no backend route, and this was a backend route with no frontend call.
//
// == APP ACCESS AND PERMISSIONS ARE ONE THING ============================================================
//
// Every `can…` toggle here IS a technician permission key. The server derives them from the one permission
// matrix rather than storing them twice — their defaults used to contradict each other, which is what happens
// when the same fact lives in two places. So this panel edits ONE list, and shows it under two headings only
// because that is how a manager thinks about it.

const APP_TOGGLES: [string, string, string][] = [
  ['canAcceptTicket', 'pos.tech.accept_ticket', 'people.techAccess.acceptTicket'],
  ['canStartService', 'pos.tech.start_service', 'people.techAccess.startService'],
  ['canMarkDone', 'pos.tech.mark_done', 'people.techAccess.markDone'],
  ['canRequestBreak', 'pos.tech.request_break', 'people.techAccess.requestBreak'],
  ['canViewEarnings', 'pos.tech.view_earnings', 'people.techAccess.viewEarnings'],
  ['canEditNotes', 'pos.tech.edit_service_notes', 'people.techAccess.editNotes'],
];

// (the last column is the catalogue key of the label — translated at render)
// The three a manager should have to think twice about. The server refuses these to anyone below OWNER/MANAGER.
const SENSITIVE: [string, string][] = [
  ['pos.tech.process_payment', 'people.techAccess.takePayment'],
  ['pos.tech.reopen_service', 'people.techAccess.reopenService'],
  ['pos.tech.edit_customer', 'people.techAccess.editCustomer'],
];

const OTHER: [string, string][] = [['pos.tech.view_schedule', 'people.techAccess.viewSchedule']];

interface AppAccess {
  enabled: boolean; loginEmail: string; pinEnabled: boolean;
  allowedBranches: string[]; allowedSections: string[];
  [k: string]: unknown;
}
interface Perms { matrix: { permission: string; allowed: boolean }[] }

export function TechnicianAccessPanel({ technicianId, displayName }: { technicianId: string; displayName: string }) {
  const [access, setAccess] = useState<AppAccess | null>(null);
  const [perms, setPerms] = useState<Perms | null>(null);
  const [skills, setSkills] = useState<string[] | null>(null);
  const [skillDraft, setSkillDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Commission Security Control state
  const [commPct, setCommPct] = useState<number>(0);
  const [commDraft, setCommDraft] = useState<string>('0');
  const [history, setHistory] = useState<any[]>([]);
  const [authModal, setAuthModal] = useState(false);
  const [authCode, setAuthCode] = useState('');

  const load = useCallback(() => {
    setErr(null);
    posTechniciansApi.appAccess(technicianId).then((r) => setAccess(r as AppAccess)).catch((e: any) => setErr(e?.message || t('pos.couldn_t_load_app_access')));
    posTechniciansApi.permissions(technicianId).then((r) => setPerms(r as Perms)).catch(() => {});
    posTechniciansApi.skills(technicianId).then((r: any) => setSkills(r?.skillGroups ?? [])).catch(() => {});
    posTechniciansApi.commission(technicianId).then((r: any) => {
      const p = Number(r?.defaultPercent ?? 0);
      setCommPct(p);
      setCommDraft(String(p));
    }).catch(() => {});
    posTechniciansApi.commissionHistory(technicianId).then((r: any) => setHistory(Array.isArray(r) ? r : [])).catch(() => {});
  }, [technicianId]);
  useEffect(() => { load(); }, [load]);

  // Security Deep Scan C7: PATCH /pos/technicians/:id/permissions is a step-up route (password prompt, then one retry);
  // §59 (Oct 26 2026): PATCH /pos/technicians/:id/app-access too
  const stepUp = useStepUp(t('pos.stepup_tech_permissions_needs_password'));

  const allowed = (key: string) => !!perms?.matrix.find((m) => m.permission === key)?.allowed;

  const save = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null); setNote(null);
    try { await fn(); setNote(ok); load(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setErr(e?.message || t('pos.that_didn_t_save')); }
    finally { setBusy(false); }
  }, [load]);

  const togglePermission = (key: string, next: boolean) =>
    save(() => stepUp.run(() => posTechniciansApi.setPermissions(technicianId, [{ permission: key, allowed: next }])),
      t(next ? 'people.techAccess.granted' : 'people.techAccess.revoked', { name: displayName }));

  const submitCommissionChange = async () => {
    if (!authCode.trim()) {
      setErr(t('pos.admin_authorization_code_is_required'));
      return;
    }
    const targetVal = Number(commDraft);
    if (isNaN(targetVal) || targetVal < 0 || targetVal > 100) {
      setErr(t('pos.commission_percentage_must_be_between_0_14wz'));
      return;
    }
    setAuthModal(false);
    await save(
      () => posTechniciansApi.setCommission(technicianId, { defaultPercent: targetVal, adminAuthCode: authCode }),
      t('people.techAccess.commissionUpdated', { percent: String(targetVal) })
    );
    setAuthCode('');
  };

  const Row = ({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #F1ECE4', fontSize: 14, cursor: 'pointer' }}>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#2C2A29', cursor: 'pointer' }} />
      <span style={{ color: '#2C2A29', fontWeight: 500 }}>{label}</span>
      {hint ? <span style={{ fontSize: 12, color: '#8A7A6D', marginLeft: 'auto' }}>{hint}</span> : null}
    </label>
  );

  if (err && !access) return <div className="err" style={{ fontSize: 12 }}>{err}</div>;
  if (!access || !perms) return <div className="state" style={{ fontSize: 12 }}>{t('pos.loading_access')}</div>;

  return (
    <section style={{ marginTop: 32 }}>
      {stepUp.prompt}
      <div style={{ fontSize: 13, color: '#8A7A6D', marginBottom: 24, lineHeight: 1.6 }}>
        {t('pos.what')}{' '}{displayName} {t('pos.can_do')}{' '}<b style={{ color: '#2C2A29' }}>{t('pos.at_this_salon')}</b>{t('pos.her_profile_portfolio_followers_and_rating_1vg8')}
      </div>

      {err ? <div style={{ fontSize: 13, color: '#C0392B', background: '#FDF0EE', padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontWeight: 600 }}>{err}</div> : null}
      {note ? <div style={{ fontSize: 13, color: '#2E7D32', background: '#EEF7EF', padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontWeight: 600 }}>{note}</div> : null}

      {/* Commission Security Control Section */}
      <div style={{ background: '#FAFAF9', border: '1px solid #EFEAE1', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, margin: 0, fontWeight: 800, color: '#2C2A29', letterSpacing: '0.02em' }}>{t('pos.commission_percentage_security_controlled')}</h3>
          <span style={{ fontSize: 11, background: '#F0F9FF', color: '#0284C7', padding: '4px 10px', borderRadius: 20, fontWeight: 700 }}>{t('pos.admin_auth_required')}</span>
        </div>
        <div style={{ fontSize: 13, color: '#8A7A6D', marginBottom: 16, lineHeight: 1.5 }}>
          {t('pos.commission_rates_are_protected_modifying_this_1pra')}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="number"
            min="0"
            max="100"
            value={commDraft}
            onChange={(e) => setCommDraft(e.target.value)}
            disabled={busy}
            style={{ width: 90, padding: '10px 14px', border: '1px solid #EFEAE1', borderRadius: 10, fontSize: 15, fontWeight: 700, outline: 'none' }}
          />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#2C2A29' }}>%</span>
          <button
            style={{ marginLeft: 'auto', padding: '10px 20px', fontSize: 13, background: '#D4AF37', color: '#FFFFFF', border: 'none', borderRadius: 24, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', opacity: (busy || Number(commDraft) === commPct) ? 0.5 : 1 }}
            disabled={busy || Number(commDraft) === commPct}
            onClick={() => { setAuthCode(''); setErr(null); setAuthModal(true); }}
          >
            {t('pos.update_commission')}
          </button>
        </div>
      </div>

      {/* Admin Authorization Code Modal */}
      {authModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#FFF', borderRadius: 12, padding: 20, width: 380, maxWidth: '90%', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#111827' }}>{t('pos.admin_authorization_required')}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#4B5563', lineHeight: 1.4 }}>
              {t('pos.to_change')}{' '}<b>{displayName}’s</b> {t('pos.commission_from')}{' '}<b>{commPct}%</b> {t('pos.to')}{' '}<b>{commDraft}%</b>{t('pos.enter_your_super_admin_authorization_code')}
            </p>
            {err && (
              <div style={{ fontSize: 12, color: '#DC2626', background: '#FEE2E2', border: '1px solid #FCA5A5', padding: '6px 10px', borderRadius: 8, marginBottom: 12, fontWeight: 600 }}>
                {err}
              </div>
            )}
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              {t('pos.admin_authorization_code')}
            </label>
            <input
              type="text"
              placeholder={t('pos.e_g_admin_auth_1234')}
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => setAuthModal(false)}>{t('pos.cancel')}</button>
              <button className="btn" style={{ padding: '6px 14px', fontSize: 12 }} onClick={submitCommissionChange}>{t('pos.authorize_save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Commission Change History Log */}
      {history.length > 0 && (
        <div style={{ background: '#FFF', border: '1px solid #EFE7DA', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <h4 style={{ fontSize: 12, margin: '0 0 8px', fontWeight: 700, color: '#374151' }}>{t('pos.commission_change_history_log')}</h4>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E5E7EB', color: '#6B7280' }}>
                  <th style={{ padding: '4px 6px' }}>{t('pos.date_time')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('pos.change')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('pos.requested_by')}</th>
                  <th style={{ padding: '4px 6px' }}>{t('pos.authorized_by')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '6px' }}>{new Date(h.createdAt).toLocaleString(displayLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ padding: '6px', fontWeight: 600 }}>{h.oldCommissionPercent}% → {h.newCommissionPercent}%</td>
                    <td style={{ padding: '6px' }}>{h.requestedByName} <span style={{ color: '#9CA3AF', fontSize: 10.5 }}>({h.requestedByRole})</span></td>
                    <td style={{ padding: '6px', color: '#059669', fontWeight: 600 }}>{h.authorizedByName || t('pos.admin')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 style={{ margin: '32px 0 16px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t('pos.technician_app')}</h3>
      <Row
        label={t('pos.she_can_sign_in_to_the_1n31')}
        on={access.enabled}
        onChange={(v) => save(() => stepUp.run(() => posTechniciansApi.setAppAccess(technicianId, { ...access, enabled: v })), v ? t('pos.app_access_on') : t('pos.app_access_off'))}
        hint={access.loginEmail || undefined}
      />
      <Row
        label={t('pos.pin_sign_in')}
        // Truthful label: no sign-in method reads this setting yet. The only technician PIN is the Go Check-In clock
        // PIN, and tying this toggle to it would risk stopping technicians clocking in. See UNENFORCED-CONTROLS-SWEEP.md.
        hint={t('pos.not_active_yet_no_sign_in_o1wn')}
        on={access.pinEnabled}
        onChange={(v) => save(() => stepUp.run(() => posTechniciansApi.setAppAccess(technicianId, { ...access, pinEnabled: v })), t('people.common.saved'))}
      />

      <h3 style={{ margin: '32px 0 16px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t('pos.in_the_app_she_can')}</h3>
      {[...OTHER, ...APP_TOGGLES.map(([, key, label]) => [key, label] as [string, string])].map(([key, label]) => (
        <Row key={key} label={t(label)} on={allowed(key)} onChange={(v) => togglePermission(key, v)} />
      ))}

      <h3 style={{ margin: '32px 0 16px', fontSize: 13, color: '#C0392B', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t('pos.needs_an_owner_or_manager_to_ukf7')}</h3>
      {SENSITIVE.map(([key, label]) => (
        <Row key={key} label={t(label)} on={allowed(key)} onChange={(v) => togglePermission(key, v)} hint={t('people.techAccess.sensitive')} />
      ))}

      <h3 style={{ margin: '32px 0 16px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t('pos.skills')}</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(skills ?? []).map((g) => (
          <span key={g} style={{ background: 'linear-gradient(135deg, #FDFBF7 0%, #F1ECE4 100%)', color: '#B5821F', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: '1px solid #EADBB6', display: 'inline-flex', alignItems: 'center' }}>
            {g}
            <button
              style={{ border: 0, background: 'none', cursor: 'pointer', marginLeft: 6, padding: 0, color: '#B5821F', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center' }}
              disabled={busy}
              onClick={() => save(() => posTechniciansApi.setSkills(technicianId, (skills ?? []).filter((x) => x !== g)), t('people.techAccess.skillsSaved'))}
            >×</button>
          </span>
        ))}
        <input
          placeholder={t('pos.add_a_skill')}
          value={skillDraft}
          onChange={(e) => setSkillDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !skillDraft.trim()) return;
            const next = [...new Set([...(skills ?? []), skillDraft.trim()])];
            setSkillDraft('');
            void save(() => posTechniciansApi.setSkills(technicianId, next), t('people.techAccess.skillsSaved'));
          }}
          style={{ border: '1px dashed #D2C4B3', borderRadius: 20, padding: '6px 14px', fontSize: 13, width: 140, background: '#FAFAF9', outline: 'none' }}
        />
      </div>
    </section>
  );
}
