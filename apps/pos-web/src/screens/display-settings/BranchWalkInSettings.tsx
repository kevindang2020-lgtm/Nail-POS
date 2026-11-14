// BranchWalkInSettings — walk-in settings per location (migration 993; Kevin, Nov 13 2026: walk-in settings were salon-wide
// only). Each location follows the salon's switches (the card above) until the owner sets one for that location; "Use
// salon setting" clears it again. Only shown when the salon has more than one location. Reading needs settings.view,
// saving settings.edit — enforced server-side (GET / PUT /pos/settings/go-check-in/branches).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import type { WalkInBranchKey, WalkInBranchPatch, WalkInBranchSettingsList } from '@aipowersalon/api-contracts/tenant';
import { posDisplaySettingsApi } from '../../api/posDisplaySettingsApi';

const KEYS: [WalkInBranchKey, string][] = [
  ['serviceSelectionEnabled', 'admin.display.toggle.chooseServices'],
  ['technicianPreferenceEnabled', 'admin.display.toggle.askTechnician'],
  ['walkinRequireServices', 'admin.display.toggle.walkinRequireServices'],
  ['walkinShowPrices', 'admin.display.toggle.walkinShowPrices'],
  ['walkinShowDurations', 'admin.display.toggle.walkinShowDurations'],
  ['walkinAllowAddOns', 'admin.display.toggle.walkinAllowAddOns'],
];
const label: CSSProperties = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8A7A66' };

/** What changed for one location, and only that (pure): a set value, or null to follow the salon again. */
export function branchPatch(saved: Record<WalkInBranchKey, boolean | null>, form: Record<WalkInBranchKey, boolean | null>): WalkInBranchPatch {
  const p: WalkInBranchPatch = {};
  for (const [k] of KEYS) if (saved[k] !== form[k]) p[k] = form[k];
  return p;
}

export function BranchWalkInSettings({ salonVersion }: { salonVersion: number }) {
  const [data, setData] = useState<WalkInBranchSettingsList | null>(null);
  const [branchId, setBranchId] = useState('');
  const [form, setForm] = useState<Record<WalkInBranchKey, boolean | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [hidden, setHidden] = useState(false);

  // reloaded when the salon's own switches are saved (a location without its own value follows them)
  useEffect(() => {
    let live = true;
    posDisplaySettingsApi.branches()
      .then((d) => { if (!live) return; setData(d); setBranchId((cur) => (d.branches.some((b) => b.branchId === cur) ? cur : d.branches[0]?.branchId ?? '')); })
      .catch((e: any) => { if (!live) return; if (e?.status === 403 || e?.status === 404) setHidden(true); else setNote({ ok: false, msg: e?.message || t('admin.display.branch.loadFailed') }); });
    return () => { live = false; };
  }, [salonVersion]);
  const row = data?.branches.find((b) => b.branchId === branchId) ?? null;
  useEffect(() => { setForm(row ? { ...row.override } : null); setNote(null); }, [row]);
  const patch = useMemo(() => (row && form ? branchPatch(row.override, form) : {}), [row, form]);

  if (hidden || !data || data.branches.length < 2) return null;   // one location: the salon settings above ARE its settings
  const dirty = Object.keys(patch).length > 0;
  const save = async () => {
    if (!row) return;
    setBusy(true); setNote(null);
    try { setData(await posDisplaySettingsApi.saveBranch(row.branchId, patch)); setNote({ ok: true, msg: t('admin.display.branch.saved') }); }
    catch (e: any) { setNote({ ok: false, msg: e?.message || t('admin.display.branch.failed') }); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="branch-walkin-settings" style={{ marginBottom: 16, padding: 12, border: '1px dashed var(--line, #E8DFD1)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={label}>{t('admin.display.branch.title')}</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          {t('admin.display.branch.pick')}
          <select value={branchId} disabled={busy} onChange={(e) => setBranchId(e.target.value)} aria-label={t('admin.display.branch.pick')} data-testid="branch-walkin-pick" style={{ height: 30 }}>
            {data.branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName || '—'}</option>)}
          </select>
        </label>
      </div>
      <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 10, lineHeight: 1.35 }}>{t('admin.display.branch.desc')}</div>
      {form ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
          {KEYS.map(([k, key]) => {
            const own = form[k] !== null;
            const value = own ? !!form[k] : data.salon[k];
            const name = t(key);
            return (
              <div key={k} data-testid={`branch-walkin-${k}`} data-own={own ? 'yes' : 'no'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: own ? '1px solid #A96F22' : '1px solid var(--line, #E8DFD1)', background: own ? '#FFFDF8' : '#FAF8F4' }}>
                <input type="checkbox" checked={value} disabled={busy} aria-label={name} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#A96F22' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</div>
                  <div style={{ fontSize: 11, color: '#8A7A66' }}>{own ? t('admin.display.branch.ownSetting') : t('admin.display.branch.sameAsSalon')}</div>
                </div>
                {own ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setForm({ ...form, [k]: null })} data-testid={`branch-walkin-reset-${k}`} style={{ fontSize: 11, padding: '2px 8px' }}>{t('admin.display.branch.useSalon')}</button> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={!dirty || busy} onClick={() => { void save(); }} data-testid="branch-walkin-save" style={{ height: 30, padding: '0 14px', fontSize: 12, fontWeight: 800 }}>{t('admin.display.branch.save')}</button>
        {note ? <span role="status" style={{ fontSize: 12, fontWeight: 600, color: note.ok ? '#2E7D4F' : '#B4453C' }}>{note.msg}</span> : null}
      </div>
    </div>
  );
}
