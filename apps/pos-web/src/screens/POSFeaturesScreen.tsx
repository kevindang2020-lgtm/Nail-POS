// POSFeaturesScreen.tsx — Management → Features. A read-only view of which product features the tenant's
// plan enables (feature flags resolved by the entitlements engine: plan default + account override).
// Reuses GET /tenant/account/usage-limits/state (settings.view), which returns { plan, limits, features }.
// Feature overrides are managed by the platform (super-admin), so this surface is read-only.
//
// Features SUNMI guide (Nov 9 2026): keep Current Plan / Enabled / Available, add Needs attention, search + status
// filter, a details overlay, and a real diagnostic when the list is empty (the pilot screenshot showed no rows because
// the salon's plan text is not linked to a catalogue plan — the page now says so instead of a bare "none").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posUsageLimitsApi } from '../api/posUsageLimitsApi';
import { reportError } from './reportsCommon';
import { FitDialog, KpiCard, Empty, ErrorRetry } from '../components/FitKit';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabelOrNull } from '../i18n/status-label';

type Feature = { featureKey: string; planState: string | null; override: string | null; enabled: boolean; source: string; blocked: boolean };
type Plan = { text?: string | null; mapped?: boolean; code?: string | null; name?: string | null } | null;

// a feature key → admin.features.<key>, else a canonical status label, else the key humanised (AI / SMS / API kept upper-case)
const label = (key: string) => { const k = `admin.features.${key}`; const l = t(k); return l !== k ? l : statusLabelOrNull('featureKey', key) ?? humanizeKey(key); };
const humanizeKey = (key: string) => key
  .replace(/_/g, ' ')
  .replace(/\bai\b/gi, 'AI')
  .replace(/\bsms\b/gi, 'SMS')
  .replace(/\bapi\b/gi, 'API')
  .replace(/\b\w/g, (c) => c.toUpperCase());
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const STATUS = ['all', 'enabled', 'off', 'attention'] as const;
/** the effective state staff see — from the server's resolution, never a frontend guess */
const stateOf = (f: Feature): 'enabled' | 'blocked' | 'override_off' | 'not_in_plan' => f.blocked ? 'blocked' : f.enabled ? 'enabled' : f.source === 'override' ? 'override_off' : 'not_in_plan';

export function POSFeaturesScreen() {
  const nav = useNavigate();
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [plan, setPlan] = useState<Plan>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUS)[number]>('all');
  const [open, setOpen] = useState<Feature | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await posUsageLimitsApi.state();
      setFeatures(((s?.features || []) as Feature[]).slice().sort((a, b) => label(a.featureKey).localeCompare(label(b.featureKey))));
      setPlan((s?.plan as Plan) ?? null);
    } catch (e: any) { setError(reportError(e, 'features')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => features || [], [features]);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return list.filter((x) => (!f || fold(label(x.featureKey)).includes(f) || fold(x.featureKey).includes(f))
      && (status === 'all' || (status === 'enabled' ? x.enabled : status === 'attention' ? x.blocked : !x.enabled)));
  }, [list, q, status]);

  const planName = plan?.name || plan?.text || null;
  const enabledCount = list.filter((f) => f.enabled).length;
  const attention = list.filter((f) => f.blocked).length;
  const known = !loading && !error;

  return (
    <div className="work" data-testid="ftx-screen">
      <div className="vh ftx-head">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}><h1>{t('pos.features')}</h1><div className="sub">{t('pos.what_s_included_with_your_plan')}</div></div>
        <button className="btn ghost" data-testid="ftx-refresh" onClick={load}>{t('dfx.refresh')}</button>
        <button className="btn ghost" data-testid="ftx-subscription" onClick={() => nav('/tenant/account/subscription')}>{t('ftx.subscription')}</button>
        <button className="btn ghost" data-testid="ftx-usage" onClick={() => nav('/tenant/account/usage-limits')}>{t('ftx.usage')}</button>
      </div>

      <div className="kpis ftx-kpis" data-testid="ftx-kpis">
        <KpiCard testId="ftx-kpi-plan" label={t('pos.current_plan')} value={known ? (planName || t('pos.no_plan')) : '—'} loading={loading} sub={known && plan && plan.mapped === false && planName ? t('ftx.planUnlinked') : undefined} tone={known && plan?.mapped === false ? 'warn' : undefined} />
        <KpiCard testId="ftx-kpi-enabled" label={t('pos.enabled')} value={known ? String(enabledCount) : '—'} loading={loading} sub={t('ftx.enabledSub')} tone="ok" onClick={() => setStatus('enabled')} />
        <KpiCard testId="ftx-kpi-available" label={t('pos.available')} value={known ? String(list.length) : '—'} loading={loading} sub={t('ftx.availableSub')} onClick={() => setStatus('all')} />
        <KpiCard testId="ftx-kpi-attention" label={t('ftx.attention')} value={known ? String(attention) : '—'} loading={loading} sub={t('ftx.attentionSub')} tone={attention ? 'warn' : undefined} onClick={() => setStatus('attention')} />
      </div>

      {error ? <ErrorRetry message={error} onRetry={load} /> : loading ? <div className="state">{t('pos.loading_features')}</div> : list.length === 0 ? (
        <section className="panel ftx-empty" data-testid="ftx-empty">
          <Empty title={t('pos.no_plan_features_are_configured_for_1wd9')} />
          {/* the real reason, not a bare zero */}
          <p className="sub" data-testid="ftx-why">{plan && plan.mapped === false && planName ? t('ftx.why.unlinked', { plan: planName }) : !planName ? t('ftx.why.noPlan') : t('ftx.why.empty')}</p>
        </section>
      ) : (<>
        <section className="panel rvw-filters ftx-filters" data-testid="ftx-filters">
          <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setQ(draft); }}>
            <input className="rvw-search" type="search" data-testid="ftx-search" value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value) setQ(''); }} placeholder={t('ftx.searchPh')} aria-label={t('ftx.searchPh')} />
            <button className="btn" type="submit">{t('dfx.search')}</button>
          </form>
          <label className="rvw-f"><span>{t('pos.status')}</span>
            <select data-testid="ftx-status" value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS)[number])}>{STATUS.map((s) => <option key={s} value={s}>{t('ftx.f.' + s)}</option>)}</select></label>
          {q || status !== 'all' ? <button className="btn ghost" data-testid="ftx-clear" onClick={() => { setDraft(''); setQ(''); setStatus('all'); }}>{t('locx.clear')}</button> : null}
          <span className="sub" data-testid="ftx-count">{t('ftx.count', { n: String(shown.length), total: String(list.length) })}</span>
        </section>
        <section className="panel" style={{ padding: 0, overflow: 'hidden' }} data-testid="ftx-results">
          {shown.length === 0 ? <div style={{ padding: 16 }}><Empty title={t('ftx.noMatch')} /></div> : (
            <div className="rvw-table-wrap"><table className="tbl">
              <thead><tr><th>{t('pos.feature')}</th><th>{t('pos.status')}</th><th>{t('pos.source')}</th><th /></tr></thead>
              <tbody>{shown.map((f) => (
                <tr key={f.featureKey} data-testid="ftx-row" style={f.enabled ? undefined : { opacity: 0.7 }}>
                  <td style={{ fontWeight: 700 }}>{label(f.featureKey)}</td>
                  <td><span className={'chip ' + (f.blocked ? 'warn' : f.enabled ? 'ok' : '')} data-state={stateOf(f)}>{t('ftx.st.' + stateOf(f))}</span></td>
                  <td className="sub" style={{ fontSize: 12.5 }}>
                    {f.source === 'override' ? (f.override === 'enabled' ? t('pos.enabled_for_your_account') : t('pos.disabled_for_your_account')) : (f.enabled ? t('pos.included_in_your_plan') : t('pos.not_in_your_plan'))}
                  </td>
                  <td className="nowrap"><button className="btn ghost sm" data-testid="ftx-view" onClick={() => setOpen(f)}>{t('dfx.view')}</button></td>
                </tr>
              ))}</tbody>
            </table></div>)}
        </section>
      </>)}
      <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>{t('pos.features_are_set_by_your_plan_b85k')}</div>

      {open ? (
        <FitDialog testId="ftx-detail" title={label(open.featureKey)} subtitle={t('ftx.st.' + stateOf(open))} onClose={() => setOpen(null)}
          footer={<><button className="btn ghost" onClick={() => nav('/tenant/account/subscription')}>{t('ftx.subscription')}</button><button className="btn" onClick={() => setOpen(null)}>{t('pos.close')}</button></>}>
          <div className="list">
            {([[t('ftx.d.key'), open.featureKey], [t('ftx.d.plan'), open.planState ? (statusLabelOrNull('featureState', open.planState) ?? open.planState) : t('ftx.d.notInPlan')],
              [t('ftx.d.override'), open.override ? (statusLabelOrNull('featureState', open.override) ?? open.override) : t('ftx.d.none')], [t('pos.source'), open.source === 'override' ? t('ftx.d.srcOverride') : t('ftx.d.srcPlan')],
              [t('ftx.d.effective'), open.enabled ? t('pos.on') : t('pos.off')]] as [string, string][]).map(([k, v]) => (
              <div className="row" key={k}><div className="t" style={{ flex: 1, color: 'var(--muted)' }}>{k}</div><div style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</div></div>))}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>{open.blocked ? t('ftx.d.blocked') : t('ftx.d.readOnly')}</p>
        </FitDialog>
      ) : null}
    </div>
  );
}
