import { useCallback, useEffect, useState } from 'react';
import { superAdminNailShowcaseApi, type SaNSReport, type SaNSReportedProfile } from '../api/superAdminNailShowcaseApi';

// Super Admin NailShowcase moderation — the platform-wide reported-content queue plus a reported-creators queue. Remove
// is a hard takedown that works regardless of which salon owns the content; Suspend pulls a creator out of every
// NailShowcase ranking (and clears their stored rank), Unsuspend restores them. Reads the real /super-admin/nail-showcase/*
// routes, all gated by SuperAdminGuard.
const fmt = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

export function SuperAdminNailShowcaseModerationScreen() {
  const [reports, setReports] = useState<SaNSReport[] | null>(null);
  const [creators, setCreators] = useState<SaNSReportedProfile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    superAdminNailShowcaseApi.reports().then((d) => { setReports(d); setErr(null); })
      .catch((e: { message?: string }) => setErr(e?.message || 'Failed to load the report queue.'));
    superAdminNailShowcaseApi.reportedProfiles().then(setCreators)
      .catch((e: { message?: string }) => setErr(e?.message || 'Failed to load reported creators.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); load(); }
    catch (e) { setErr((e as { message?: string })?.message || 'Action failed.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="work" style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr)', height: '100%' }}>
      <div className="vh">
        <h1>NailShowcase Moderation</h1>
        <div className="sub">Platform-wide · {reports?.length ?? '—'} open reports · {creators?.length ?? '—'} reported creators</div>
      </div>

      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : <div />}

      <div style={{ minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section className="panel">
          <div className="t" style={{ marginBottom: 8 }}>Reported creators</div>
          {!creators ? <div className="state">Loading…</div>
            : creators.length === 0 ? <div className="state">No reported creators. 🎉</div>
            : (
              <div className="list" style={{ maxHeight: 'none' }}>
                {creators.map((c) => (
                  <div key={c.customerId} className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div className="t">
                        {c.displayName}
                        {c.isSuspended ? <span className="pill" style={{ marginLeft: 6 }}>Suspended</span> : null}
                        {!c.isPublic ? <span className="pill" style={{ marginLeft: 6 }}>Private</span> : null}
                      </div>
                      <div className="s">
                        {c.reportCount} report{c.reportCount === 1 ? '' : 's'}
                        {c.rank != null ? ` · rank #${c.rank}` : ''}
                        {` · score ${c.score.toLocaleString()}`}
                        {c.lastReportedAt ? ` · last ${fmt(c.lastReportedAt)}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      {c.isSuspended
                        ? <button className="btn ghost" disabled={busy === 'un' + c.customerId} onClick={() => act('un' + c.customerId, () => superAdminNailShowcaseApi.unsuspendProfile(c.customerId))}>Unsuspend</button>
                        : <button className="btn" disabled={busy === 'su' + c.customerId} onClick={() => act('su' + c.customerId, () => superAdminNailShowcaseApi.suspendProfile(c.customerId))}>Suspend from rankings</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </section>

        <section className="panel">
          <div className="t" style={{ marginBottom: 8 }}>Reported content</div>
          {!reports ? <div className="state">Loading…</div>
            : reports.length === 0 ? <div className="state">No open reports across the platform. 🎉</div>
            : (
              <div className="list" style={{ maxHeight: 'none' }}>
                {reports.map((r) => (
                  <div key={r.id} className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div className="t">
                        {r.postId ? 'Post' : r.commentId ? 'Comment' : 'Content'} reported
                        <span className="pill" style={{ marginLeft: 6, textTransform: 'capitalize' }}>{r.reason}</span>
                      </div>
                      <div className="s">
                        {fmt(r.createdAt)}
                        {r.postId ? ` · post ${r.postId.slice(0, 8)}…` : ''}
                        {r.commentId ? ` · comment ${r.commentId.slice(0, 8)}…` : ''}
                        {r.details ? ` · ${r.details.slice(0, 90)}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      {r.postId ? <button className="btn" disabled={busy === 'rp' + r.id} onClick={() => act('rp' + r.id, () => superAdminNailShowcaseApi.removePost(r.postId!))}>Remove post</button> : null}
                      {r.commentId ? <button className="btn" disabled={busy === 'rc' + r.id} onClick={() => act('rc' + r.id, () => superAdminNailShowcaseApi.removeComment(r.commentId!))}>Remove comment</button> : null}
                      <button className="btn ghost" disabled={busy === 'at' + r.id} onClick={() => act('at' + r.id, () => superAdminNailShowcaseApi.resolveReport(r.id, 'action_taken'))}>Action taken</button>
                      <button className="btn ghost" disabled={busy === 'dm' + r.id} onClick={() => act('dm' + r.id, () => superAdminNailShowcaseApi.resolveReport(r.id, 'dismissed'))}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
