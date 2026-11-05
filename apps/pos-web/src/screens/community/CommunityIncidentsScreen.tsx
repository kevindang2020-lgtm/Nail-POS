// CommunityIncidentsScreen.tsx — /community/incidents: the salon's PRIVATE incident log (contract §2.5: GET / POST
// /community/incidents, GET /community/incidents/:id). An incident is never shared and never becomes an advisory on its
// own — "Create advisory from this" opens the editor (/community/new?fromIncident=<id>) where the user writes the
// sanitized public version themselves.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CommunityCategory, CommunityIncidentView, CommunityPage, CommunitySeverity } from '@aipowersalon/api-contracts/tenant';
import { useCan } from '../../components/usePermissions';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import {
  P, CATEGORIES, CATEGORY_LABEL, SEVERITIES, SEVERITY_LABEL, CommunityHeader, CommunitySubNav, SeverityPill, body, btnGhost, btnGold,
  card, cardHead, communityErrorText, errText, input, label, muted, okText, page, row, textarea, when,
} from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function CommunityIncidentsScreen() {
  const can = useCan();
  const nav = useNavigate();
  const [pageNo, setPageNo] = useState(1);
  const [data, setData] = useState<CommunityPage<CommunityIncidentView> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState<CommunityCategory | ''>('');
  const [severity, setSeverity] = useState<CommunitySeverity>('moderate');
  const [occurredOn, setOccurredOn] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<CommunityIncidentView | null>(null);

  const load = useCallback(() => {
    if (!can(P.incident)) return Promise.resolve();
    return api.incidents(pageNo).then(setData).catch((e) => setError(communityErrorText(e, t('growth.community.couldNotLoadTheIncidents'))));
  }, [pageNo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!openId) { setOpened(null); return; }
    api.incident(openId).then(setOpened).catch((e) => setError(communityErrorText(e, t('growth.community.couldNotOpenTheIncident'))));
  }, [openId]);

  const create = async () => {
    if (!category) { setError(t('pos.choose_a_category')); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.createIncident({ category, severity, occurredOn: occurredOn || null, rawDetail: detail.trim() || null });
      setDetail(''); setOccurredOn(''); setCategory(''); setNotice(t('growth.community.incidentSavedPrivatelyNoOtherSalon'));
      await load();
    } catch (e) { setError(communityErrorText(e, t('growth.community.theIncidentWasNotSaved'))); }
    finally { setBusy(false); }
  };

  if (!can(P.incident)) return <div style={page}><CommunityHeader title={t('pos.private_incidents')} /><div style={{ padding: 20, ...muted }}>{t('pos.your_role_cannot_record_private_incidents')}</div></div>;
  const items = data?.items ?? [];
  return (
    <div style={page}>
      <CommunityHeader title={t('pos.private_incidents')} sub={t('pos.your_salon_s_own_record_never_20e8')} />
      <CommunitySubNav can={can} />
      <div style={body}>
        <section style={{ ...card, display: 'grid', gap: 10 }} aria-label={t('pos.record_a_private_incident')}>
          <div style={cardHead}>{t('pos.record_a_private_incident')}</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
            <label style={label}>{t('pos.incident_category')}
              <select style={input} value={category} onChange={(e) => setCategory(e.target.value as CommunityCategory)}>
                <option value="">{t('pos.choose')}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label style={label}>{t('pos.incident_severity')}
              <select style={input} value={severity} onChange={(e) => setSeverity(e.target.value as CommunitySeverity)}>{SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}</select>
            </label>
            <label style={label}>{t('pos.date')}<input type="date" style={input} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} /></label>
          </div>
          <label style={label}>{t('pos.private_notes_stay_inside_your_salon')}<textarea style={textarea} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
          <div style={row}><button style={btnGold} disabled={busy} onClick={create}>{t('pos.save_incident')}</button></div>
        </section>
        {notice ? <div role="status" style={okText}>{notice}</div> : null}
        {error ? <div role="alert" style={errText}>{error}</div> : null}
        {!data ? <div style={muted}>{t('pos.loading')}</div> : items.length === 0 ? <div style={{ ...card, ...muted }}>{t('pos.no_private_incidents_yet')}</div> : (
          <ul aria-label={t('pos.private_incidents')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {items.map((i) => (
              <li key={i.id} style={card} data-testid="community-incident-row">
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13.5 }}>{CATEGORY_LABEL[i.category] ?? i.category}</strong>
                  <SeverityPill s={i.severity} />
                </div>
                <div style={{ ...muted, marginTop: 4 }}>{i.occurredOn ? t('pos.happened_occurredon', { occurredOn: String(i.occurredOn) }) : ''}{t('pos.recorded')}{' '}{when(i.createdAt)}</div>
                <div style={{ ...row, marginTop: 6 }}>
                  <button style={btnGhost} onClick={() => setOpenId(openId === i.id ? null : i.id)}>{openId === i.id ? t('pos.hide_notes') : t('pos.show_notes')}</button>
                  {i.advisoryPostId ? <Link to={`/community/drafts/${encodeURIComponent(i.advisoryPostId)}`} style={{ fontSize: 12.5 }}>{t('pos.open_its_advisory')}</Link>
                    : can(P.draft) ? <button style={btnGhost} onClick={() => nav(`/community/new?fromIncident=${encodeURIComponent(i.id)}`)}>{t('pos.create_advisory_from_this')}</button> : null}
                </div>
                {openId === i.id && opened?.id === i.id ? <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 6 }} data-testid="community-incident-detail">{opened.rawDetail || t('pos.no_notes')}</div> : null}
              </li>
            ))}
          </ul>
        )}
        {data && (data.page > 1 || data.hasMore) ? (
          <div style={row}>
            <button style={btnGhost} disabled={data.page <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>{t('pos.previous_page')}</button>
            <span style={muted}>{t('pos.page')}{' '}{data.page}</span>
            <button style={btnGhost} disabled={!data.hasMore} onClick={() => setPageNo((n) => n + 1)}>{t('pos.next_page')}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
