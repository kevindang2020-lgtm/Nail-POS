// POSAccessGovernanceScreen.tsx — /tenant/security/access — the owner's access governance (BUILD_PLAN Phase 9,
// Constitution 2 §access review / high-risk report / dormant accounts / denial metrics).
//   • Access reviews: start a review (a snapshot of everyone + their high-risk permissions), decide each person — keep,
//     revoke (the account is deactivated and its sessions end) or change their role — and complete it. Deciding is a
//     step-up route.
//   • High-risk access: who holds money / refund / export / role / override / ownership keys, and why (role, template,
//     individual grant, temporary).
//   • Dormant accounts: still active, no sign-in for N days.
//   • Denials: what people keep being refused (by permission, reason and person).
// Routes: /pos/security/* (contract §3.4); roles for "change" from /pos/access/roles.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccessReviewView, DormantAccountsReport, HighRiskAccessReport, PermissionDenialMetrics, TeamRoleView } from '@aipowersalon/api-contracts/tenant';
import { posAccessGovernanceApi } from '../../api/posAccessGovernanceApi';
import { posAccessApi } from '../../api/posAccessApi';
import { useCan } from '../../components/usePermissions';
import { reportError } from '../reportsCommon';
import { SensitivityPill, Tabs, accessError, fmtWhen, reasonLabel, roleLabel, useStepUp } from './accessUi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';

type Tab = 'reviews' | 'high-risk' | 'dormant' | 'denials';
const memberLink = (userId: string, name: string) => <Link to={`/tenant/team/permissions/${encodeURIComponent(userId)}`}>{name}</Link>;

export function POSAccessGovernanceScreen() {
  const can = useCan();
  const tabs: { id: Tab; label: string }[] = [
    ...(can('access_review.view') ? [{ id: 'reviews' as Tab, label: t('pos.access_reviews') }] : []),
    ...(can('security_reports.view') ? [{ id: 'high-risk' as Tab, label: t('pos.high_risk_access') }, { id: 'dormant' as Tab, label: t('pos.dormant_accounts') }, { id: 'denials' as Tab, label: t('pos.denials') }] : []),
  ];
  const [tab, setTab] = useState<Tab | null>(tabs[0]?.id ?? null);
  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 6 }}><h1>{t('pos.access_reviews_risk')}</h1><div className="sub">{t('pos.check_regularly_who_can_do_what_1odc')}</div></div>
      {tabs.length === 0 || !tab ? <div className="err" role="alert">{t('pos.you_do_not_have_permission_to_k1l5')}</div> : (
        <>
          <Tabs label={t('pos.access_governance')} tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'reviews' && <ReviewsTab />}
          {tab === 'high-risk' && <HighRiskTab />}
          {tab === 'dormant' && <DormantTab />}
          {tab === 'denials' && <DenialsTab />}
        </>
      )}
    </div>
  );
}

function ReviewsTab() {
  const can = useCan();
  const { run, prompt } = useStepUp();
  const [list, setList] = useState<AccessReviewView[] | null>(null);
  const [open, setOpen] = useState<AccessReviewView | null>(null);
  const [roles, setRoles] = useState<TeamRoleView[]>([]);
  const [dueAt, setDueAt] = useState('');
  const [draft, setDraft] = useState<Record<string, { decision: 'keep' | 'revoke' | 'change'; note: string; templateKey: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await posAccessGovernanceApi.reviews()); setError(null); } catch (e: any) { setError(reportError(e, t('admin.access.noun.reviews'))); setList([]); }
  }, []);
  useEffect(() => { void load(); posAccessApi.roles().then(setRoles).catch(() => setRoles([])); }, [load]);
  const openReview = async (id: string) => { try { setOpen(await posAccessGovernanceApi.review(id)); setNote(null); } catch (e: any) { setNote(reportError(e, t('admin.access.noun.review'))); } };
  const start = async () => {
    setBusy('start'); setNote(null);
    try { const r = await posAccessGovernanceApi.startReview({ dueAt: dueAt ? new Date(dueAt + 'T23:59:59').toISOString() : null }); setOpen(r); await load(); }
    catch (e: any) { setNote(accessError(e, t('admin.access.error.startReview'))); }
    finally { setBusy(null); }
  };
  const decide = async (userId: string) => {
    if (!open) return; const d = draft[userId]; if (!d) return;
    setBusy(userId); setNote(null);
    try {
      const r = await run(() => posAccessGovernanceApi.decide(open.id, { userId, decision: d.decision, note: d.note.trim() || null, templateKey: d.decision === 'change' ? (d.templateKey || null) : null }));
      setOpen(r); setDraft((x) => { const n = { ...x }; delete n[userId]; return n; });
      setNote(d.decision === 'revoke' ? t('pos.access_revoked_their_sessions_are_ended') : t('pos.decision_saved'));
    } catch (e: any) { setNote(accessError(e, t('admin.access.error.saveDecision'))); }
    finally { setBusy(null); }
  };
  const complete = async () => {
    if (!open) return; setBusy('complete'); setNote(null);
    try { setOpen(await posAccessGovernanceApi.completeReview(open.id)); setNote(t('pos.review_completed')); await load(); }
    catch (e: any) { setNote(accessError(e, t('admin.access.error.completeReview'))); }
    finally { setBusy(null); }
  };
  if (list === null) return <div className="state">{t('pos.loading_reviews')}</div>;
  if (error) return <div className="err" role="alert">{error}</div>;
  const manage = can('access_review.manage');
  return (
    <>
      {prompt}
      <section className="panel" aria-label={t('pos.access_reviews')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0, flex: 1 }}>{t('pos.access_reviews')}</h2>
          {manage && <><input type="date" aria-label={t('pos.review_due_date')} value={dueAt} onChange={(e) => setDueAt(e.target.value)} /><button className="btn primary" disabled={busy === 'start'} onClick={() => void start()}>{t('pos.start_a_review')}</button></>}
        </div>
        {list.length === 0 ? <div className="muted">{t('pos.no_reviews_yet_a_review_lists_6omy')}</div> : (
          <div className="w-full overflow-x-auto"><table className="tbl min-w-[600px]">
            <thead><tr><th>{t('pos.started_2')}</th><th>{t('pos.by_2')}</th><th>{t('pos.due')}</th><th>{t('pos.progress')}</th><th>{t('pos.status')}</th><th /></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} data-testid="review-row"><td>{fmtWhen(r.createdAt)}</td><td>{r.startedByName ?? '—'}</td><td>{r.dueAt ? fmtWhen(r.dueAt) : '—'}</td>
                <td>{r.items.filter((i) => i.decision).length} / {r.items.length}</td><td><span className={'pill ' + (r.status === 'open' ? 'warn' : 'ok')}>{roleLabel(r.status)}</span></td>
                <td><button className="btn ghost" onClick={() => void openReview(r.id)}>{t('pos.open')}</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {note && <div className="sub" role="status" style={{ marginTop: 8 }}>{note}</div>}
      </section>
      {open && (
        <section className="panel" aria-label={t('pos.review')} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, flex: 1 }}>{t('pos.review_of')}{' '}{fmtWhen(open.createdAt)} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {roleLabel(open.status)}</span></h2>
            {manage && open.status === 'open' && <button className="btn primary" disabled={busy === 'complete' || open.items.some((i) => !i.decision)} onClick={() => void complete()}>{t('pos.complete_review')}</button>}
          </div>
          <div className="w-full overflow-x-auto"><table className="tbl min-w-[760px]">
            <thead><tr><th>{t('pos.person')}</th><th>{t('pos.role_2')}</th><th>{t('pos.high_risk_permissions')}</th><th>{t('pos.last_sign_in')}</th><th>{t('pos.decision')}</th></tr></thead>
            <tbody>{open.items.map((i) => {
              const d = draft[i.userId];
              return (
                <tr key={i.userId} data-testid="review-item">
                  <td>{memberLink(i.userId, i.name)}</td><td>{roleLabel(i.role)}{i.templateKey ? <div className="muted" style={{ fontSize: 11 }}>{i.templateKey}</div> : null}</td>
                  <td style={{ fontSize: 11.5 }}>{i.highRiskPermissions.length ? i.highRiskPermissions.join(', ') : '—'}</td>
                  <td>{fmtWhen(i.lastLoginAt)}</td>
                  <td>{i.decision ? <span><span className={'pill ' + (i.decision === 'revoke' ? 'bad' : 'ok')}>{roleLabel(i.decision)}</span>{i.note ? <div className="muted" style={{ fontSize: 11 }}>{i.note}</div> : null}</span>
                    : manage && open.status === 'open' ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select aria-label={t('pos.decision_for_name', { name: String(i.name) })} value={d?.decision ?? ''} onChange={(e) => setDraft((x) => ({ ...x, [i.userId]: { decision: e.target.value as 'keep' | 'revoke' | 'change', note: d?.note ?? '', templateKey: d?.templateKey ?? '' } }))}>
                          <option value="">{t('pos.decide')}</option><option value="keep">{t('pos.keep_2')}</option><option value="change">{t('pos.change_role')}</option><option value="revoke">{t('pos.revoke_access')}</option>
                        </select>
                        {d?.decision === 'change' && <select aria-label={t('pos.new_role_for_name', { name: String(i.name) })} value={d.templateKey} onChange={(e) => setDraft((x) => ({ ...x, [i.userId]: { ...d, templateKey: e.target.value } }))}>
                          <option value="">{t('pos.choose_a_role')}</option>{roles.filter((r) => r.baseRole === i.role).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                        </select>}
                        {d && <input aria-label={t('pos.note_for_name', { name: String(i.name) })} placeholder={t('pos.note')} value={d.note} onChange={(e) => setDraft((x) => ({ ...x, [i.userId]: { ...d, note: e.target.value } }))} />}
                        {d && <button className="btn" disabled={busy === i.userId || (d.decision === 'change' && !d.templateKey)} onClick={() => void decide(i.userId)}>{t('pos.save_2')}</button>}
                      </div>
                    ) : <span className="muted">{t('pos.pending')}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}

function HighRiskTab() {
  const [r, setR] = useState<HighRiskAccessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { posAccessGovernanceApi.highRisk().then(setR).catch((e) => setError(reportError(e, t('admin.access.noun.highRisk')))); }, []);
  if (error) return <div className="err" role="alert">{error}</div>;
  if (!r) return <div className="state">{t('pos.loading')}</div>;
  return (
    <section className="panel" aria-label={t('pos.high_risk_access')}>
      <div className="sub" style={{ marginBottom: 6 }}>{t('pos.generated_2')}{' '}{fmtWhen(r.generatedAt)} · {r.rows.length} {t('pos.people_hold_high_risk_or_critical_aw77')}</div>
      {r.rows.length === 0 ? <div className="muted">{t('pos.nobody_holds_a_high_risk_permission')}</div> : (
        <div className="w-full overflow-x-auto"><table className="tbl min-w-[640px]">
          <thead><tr><th>{t('pos.person')}</th><th>{t('pos.role_2')}</th><th>{t('pos.permissions_2')}</th></tr></thead>
          <tbody>{r.rows.map((x) => (
            <tr key={x.userId} data-testid="high-risk-row"><td>{memberLink(x.userId, x.name)}</td><td>{roleLabel(x.role)}</td>
              <td>{x.permissions.map((p) => <div key={p.key} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ fontWeight: 600 }}>{p.key}</span><SensitivityPill s={p.sensitivity} /><span className="muted">{reasonLabel(p.via)}</span></div>)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function DormantTab() {
  const [days, setDays] = useState(60);
  const [r, setR] = useState<DormantAccountsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setR(null); posAccessGovernanceApi.dormant(days).then(setR).catch((e) => setError(reportError(e, t('admin.access.noun.dormant')))); }, [days]);
  if (error) return <div className="err" role="alert">{error}</div>;
  return (
    <section className="panel" aria-label={t('pos.dormant_accounts')}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <span className="sub">{t('pos.active_accounts_with_no_sign_in_h07w')}</span>
        <select aria-label={t('pos.dormant_after')} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} {t('pos.days')}</option>)}</select>
      </div>
      {!r ? <div className="state">{t('pos.loading')}</div> : r.rows.length === 0 ? <div className="muted">{t('pos.no_dormant_accounts')}</div> : (
        <div className="w-full overflow-x-auto"><table className="tbl min-w-[560px]">
          <thead><tr><th>{t('pos.person')}</th><th>{t('pos.role_2')}</th><th>{t('pos.last_sign_in')}</th><th>{t('pos.days_2')}</th><th>{t('pos.status')}</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.userId} data-testid="dormant-row"><td>{memberLink(x.userId, x.name)}</td><td>{roleLabel(x.role)}</td><td>{fmtWhen(x.lastLoginAt)}</td><td>{x.daysSince ?? 'never'}</td><td>{roleLabel(x.status)}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function DenialsTab() {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [r, setR] = useState<PermissionDenialMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setR(null); posAccessGovernanceApi.denials({ from, to }).then(setR).catch((e) => setError(reportError(e, t('admin.access.noun.denials')))); }, [from, to]);
  if (error) return <div className="err" role="alert">{error}</div>;
  return (
    <section className="panel" aria-label={t('pos.denials')}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <input type="date" aria-label={t('pos.from')} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" aria-label={t('pos.to_2')} value={to} onChange={(e) => setTo(e.target.value)} />
        {r && <span className="sub" data-testid="denials-total">{r.total} {t('pos.refused_request')}{enPlural(r.total === 1 ? '' : 's')}</span>}
      </div>
      {!r ? <div className="state">{t('pos.loading')}</div> : r.total === 0 ? <div className="muted">{t('pos.nobody_was_refused_in_this_period')}</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div><div style={{ fontWeight: 800, fontSize: 12 }}>{t('pos.by_permission')}</div>{r.byKey.map((x) => <div key={x.key} data-testid="denial-key" style={{ fontSize: 12 }}>{x.key} — {x.count}</div>)}</div>
          <div><div style={{ fontWeight: 800, fontSize: 12 }}>{t('pos.by_reason')}</div>{r.byReason.map((x) => <div key={x.reason} style={{ fontSize: 12 }}>{reasonLabel(x.reason)} — {x.count}</div>)}</div>
          <div><div style={{ fontWeight: 800, fontSize: 12 }}>{t('pos.by_person')}</div>{r.byUser.map((x) => <div key={x.userId} style={{ fontSize: 12 }}>{memberLink(x.userId, x.name)} — {x.count}</div>)}</div>
        </div>
      )}
    </section>
  );
}
