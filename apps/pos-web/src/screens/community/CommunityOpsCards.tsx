// CommunityOpsCards.tsx — three Safety Community extras (Nov 12 2026), each a read-only view over a server answer:
//   • 08 Permission-Aware Role Preview (settings managers): pick a default staff role → every community action with "can" /
//     "cannot" and WHY (role permission · community role · this salon's setting · community off). The server evaluates the
//     real route permission + capability checks; nothing here re-derives a rule, and the preview never grants anything.
//   • 09 Safe diagnostics export (settings managers): one range (≤ 92 days) → the server's sanitized CSV (settings + counts
//     only), recorded by the server before the file leaves.
//   • 06 Corrections & Retractions inbox (approvers): own published advisories that changed after publication — each change,
//     how many following salons it reached in-app, and the salon's appeals / open disputes on them.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommunityCorrectionsInbox, CommunityPostStatus, CommunityRolePreview } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCommunityApi as api } from '../../api/posCommunityApi';
import { codeLabel } from '../../components/codeLabel';
import { StatusPill, btnGhost, btnGold, card, cardHead, communityErrorText, errText, input, label, muted, okText, row, when } from './communityUi';

const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);

export function CommunityRolePreviewCard() {
  const [data, setData] = useState<CommunityRolePreview | null>(null);
  const [role, setRole] = useState<string>('RECEPTIONIST');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError(null);
    try { setData(await api.rolePreview()); } catch (e) { setError(communityErrorText(e, tt('growth.community.roles.failed'))); } finally { setBusy(false); }
  };
  const r = data?.roles.find((x) => x.key === role) ?? data?.roles[0];
  return (
    <section style={{ ...card, display: 'grid', gap: 8 }} aria-label={tt('growth.community.roles.title')} data-testid="community-role-preview">
      <div style={cardHead}>{tt('growth.community.roles.title')}</div>
      <div style={muted}>{tt('growth.community.roles.sub')}</div>
      {!data ? <div><button style={btnGhost} disabled={busy} data-testid="community-role-preview-load" onClick={load}>{busy ? tt('pos.loading') : tt('growth.community.roles.load')}</button></div> : null}
      {error ? <div role="alert" style={errText}>{error}</div> : null}
      {data && r ? (
        <>
          <label style={label}>{tt('growth.community.roles.pick')}
            <select style={input} data-testid="community-role-preview-role" value={r.key} onChange={(e) => setRole(e.target.value)}>
              {data.roles.map((x) => <option key={x.key} value={x.key}>{codeLabel('growth.community.roles.name', x.key) || x.name}</option>)}
            </select>
          </label>
          {!data.communityEnabled ? <div style={errText} data-testid="community-role-preview-off">{tt('growth.community.roles.off')}</div> : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {r.actions.map((a) => (
              <li key={a.action} data-testid="community-role-action" data-action={a.action} data-allowed={a.allowed ? 'yes' : 'no'} style={{ ...row, justifyContent: 'space-between', fontSize: 13 }}>
                <span>{tt('growth.community.roles.action.' + a.action)}</span>
                <span style={a.allowed ? okText : muted}>{a.allowed ? tt('growth.community.roles.can') : tt('growth.community.roles.cannot', { why: tt('growth.community.roles.why.' + (a.blockedBy ?? 'role_permission')) })}</span>
              </li>
            ))}
          </ul>
          <div style={muted}>{tt('growth.community.roles.foot')}{data.customRoles ? ' ' + tt('growth.community.roles.custom', { n: data.customRoles }) : ''}</div>
        </>
      ) : null}
    </section>
  );
}

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function CommunityDiagnosticsCard() {
  const [to, setTo] = useState(() => ymdLocal(new Date()));
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return ymdLocal(d); });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true); setNote(null);
    try {
      const csv = await api.diagnosticsExport(from, to);
      const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'safety-community-diagnostics.csv'; a.click(); URL.revokeObjectURL(a.href);
      setNote({ ok: true, text: tt('growth.community.diag.done') });
    } catch (e) { setNote({ ok: false, text: communityErrorText(e, tt('growth.community.diag.failed')) }); }
    finally { setBusy(false); }
  };
  return (
    <section style={{ ...card, display: 'grid', gap: 8 }} aria-label={tt('growth.community.diag.title')} data-testid="community-diagnostics">
      <div style={cardHead}>{tt('growth.community.diag.title')}</div>
      <div style={muted}>{tt('growth.community.diag.sub')}</div>
      <div style={row}>
        <label style={label}>{tt('pos.from')}<input type="date" style={input} data-testid="community-diag-from" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={label}>{tt('pos.to_2')}<input type="date" style={input} data-testid="community-diag-to" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button style={btnGold} disabled={busy || !from || !to} data-testid="community-diag-export" onClick={run}>{busy ? tt('pos.exporting') : tt('growth.community.diag.btn')}</button>
      </div>
      {note ? <div role={note.ok ? 'status' : 'alert'} style={note.ok ? okText : errText} data-testid="community-diag-note">{note.text}</div> : null}
    </section>
  );
}

export function CommunityCorrectionsList() {
  const [pageNo, setPageNo] = useState(1);
  const [data, setData] = useState<CommunityCorrectionsInbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); api.corrections(pageNo).then(setData).catch((e) => setError(communityErrorText(e, tt('growth.community.corr.failed')))); }, [pageNo]);
  useEffect(load, [load]);
  if (error) return <div role="alert" style={errText}>{error}</div>;
  if (!data) return <div style={muted}>{tt('pos.loading')}</div>;
  if (!data.items.length) return <div style={{ ...card, ...muted }} data-testid="community-corrections-empty">{tt('growth.community.corr.none')}</div>;
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="community-corrections">
      <div style={muted}>{tt('growth.community.corr.sub')}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {data.items.map((p) => (
          <li key={p.postId} style={card} data-testid="community-correction">
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <Link to={`/community/posts/${encodeURIComponent(p.postId)}`} style={{ fontWeight: 700, color: '#2C2A27' }}>{p.title}</Link>
              <StatusPill s={p.status as CommunityPostStatus} />
            </div>
            <div style={{ ...muted, marginTop: 4 }}>{tt('growth.community.corr.meta', { p: when(p.publishedAt), f: p.followers, o: p.disputes.open })}</div>
            {p.removedNote ? <div style={{ ...errText, marginTop: 4 }}>{tt('growth.community.corr.removedNote', { n: p.removedNote })}</div> : null}
            {p.resolutionNote ? <div style={{ ...muted, marginTop: 4 }}>{tt('growth.community.corr.resolutionNote', { n: p.resolutionNote })}</div> : null}
            <ol style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 2, fontSize: 12.5 }}>
              {p.changes.map((c, i) => (
                <li key={i} data-testid="community-correction-change" data-kind={c.kind}>
                  <strong>{codeLabel('growth.community.corr.kind', c.kind)}</strong>{' · '}{when(c.at)}{' · '}{c.byModeration ? tt('growth.community.corr.byMod') : tt('growth.community.corr.byUs')}
                  {' · '}<span data-testid="community-correction-reach">{c.notifiedSalons == null ? '—' : tt('growth.community.corr.reach', { n: c.notifiedSalons })}</span>
                  {c.note ? <div style={muted}>{c.note}</div> : null}
                </li>
              ))}
            </ol>
            {p.appeals.length ? (
              <div style={{ marginTop: 6, fontSize: 12.5 }} data-testid="community-correction-appeals">
                {p.appeals.map((a) => <div key={a.id}>{tt('growth.community.corr.appeal', { s: codeLabel('growth.community.corr.subject', a.subject), st: codeLabel('growth.community.corr.appealStatus', a.status), at: when(a.createdAt) })}{a.decisionNote ? ` — ${a.decisionNote}` : ''}</div>)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {data.totalPages > 1 ? (
        <div style={row}>
          <button style={btnGhost} disabled={data.page <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>{tt('pos.previous_page')}</button>
          <span style={muted}>{tt('pos.page')}{' '}{data.page} {tt('pos.of')}{' '}{data.totalPages}</span>
          <button style={btnGhost} disabled={data.page >= data.totalPages} onClick={() => setPageNo((n) => n + 1)}>{tt('pos.next_page')}</button>
        </div>
      ) : null}
    </div>
  );
}
