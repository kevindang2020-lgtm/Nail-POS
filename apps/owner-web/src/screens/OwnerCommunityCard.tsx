// OwnerCommunityCard.tsx — BUILD_PLAN Phase 8 (tenant_safety_community): the Owner App's Safety Community card, on the
// Approvals tab. Active high / critical alerts from other salons (last 72 h), the salon's advisories waiting for approval
// with Approve / Return-with-a-note (expectedVersion; a 409 reloads and says so), and the way into Community settings.
// Hidden when the owner session cannot read the community (403 on both reads); errors in plain words otherwise.
// Live: community_* events (and the stream's reconcile) reload it.
import { useCallback, useEffect, useState } from 'react';
import { ownerCommunityApi, type CommunityActiveAlert, type CommunityMyPostView } from '../api/ownerCommunityApi';
import { useOwnerStream } from '../api/useOwnerStream';
import { useOwnerNav } from '../shell/nav';

const SEV: Record<string, string> = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low', informational: 'Info' };
const pretty = (s: string | null | undefined) => (s || '').replace(/_/g, ' ');
type Err = { status?: number; code?: string; message?: string } | null;
export function ownerCommunityError(e: unknown, fallback: string): string {
  const x = e as Err;
  if (x?.code === 'version_conflict' || x?.status === 409) return 'Someone else acted on this a moment ago — the list has been refreshed.';
  if (x?.code === 'community_disabled') return 'The Safety Community is turned off for your salon.';
  if (x?.code === 'community_suspended') return 'AI PowerSalon moderators have suspended your salon from the Safety Community.';
  if (x?.code === 'community_posting_restricted' || x?.code === 'posting_restricted') return 'Moderators have paused posting for your salon — approvals are on hold.';
  if (x?.status === 403) return 'You do not have permission for this.';
  return x?.message || fallback;
}

export function OwnerCommunityCard() {
  const { openCommunitySettings } = useOwnerNav();
  const [alerts, setAlerts] = useState<CommunityActiveAlert[]>([]);
  const [waiting, setWaiting] = useState<CommunityMyPostView[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    // Phase 12: read the salon's community settings first (200 with `enabled`) — a salon outside the Safety Community is
    // explained without asking for alerts or approvals, which would only answer 403 community_disabled. Unreadable
    // settings fall through to the two reads (they explain themselves).
    return ownerCommunityApi.settings().then((s) => !!s?.enabled, () => null).then((enabled) => {
      if (enabled === false) { setHidden(false); setAlerts([]); setWaiting([]); setError(ownerCommunityError({ code: 'community_disabled' }, '')); return undefined; }
      return loadReads();
    }).finally(() => setLoading(false));
  }, []);
  const loadReads = () => {
    return Promise.allSettled([ownerCommunityApi.activeAlerts(), ownerCommunityApi.awaitingApproval()]).then(([a, w]) => {
      const denied = (r: PromiseSettledResult<unknown>) => r.status === 'rejected' && (r.reason as Err)?.status === 403;
      if (denied(a) && denied(w)) { setHidden(true); return; }
      setHidden(false);
      setAlerts(a.status === 'fulfilled' ? a.value : []);
      setWaiting(w.status === 'fulfilled' ? w.value : []);
      const failed = [a, w].find((r) => r.status === 'rejected' && (r.reason as Err)?.status !== 403) as PromiseRejectedResult | undefined;
      setError(failed ? ownerCommunityError(failed.reason, 'Could not load the Safety Community.') : null);
    });
  };
  useEffect(() => { load(); }, [load]);
  useOwnerStream((ev) => { if (ev === 'reconcile' || ev.startsWith('community_')) load(); });

  const act = async (p: CommunityMyPostView, fn: () => Promise<CommunityMyPostView>, ok: (r: CommunityMyPostView) => string) => {
    setBusy(p.id); setError(null); setNotice(null);
    try { const r = await fn(); setNotice(ok(r)); setReturning(null); setNote(''); }
    catch (e) { setError(ownerCommunityError(e, 'That did not work.')); }
    finally { setBusy(null); await load(); }
  };

  if (hidden) return null;
  return (
    <section data-testid="owner-community" style={{ marginTop: 18 }}>
      <div className="owner-sechead"><div className="h owner-serif">Safety Community</div><div className="d">{waiting.length ? `${waiting.length} to approve` : 'Nothing to approve'}</div></div>
      {notice ? <div role="status" className="owner-text-muted" style={{ fontSize: 12.5, marginBottom: 8 }} data-testid="owner-community-notice">{notice}</div> : null}
      {error ? <div role="alert" className="owner-state" style={{ marginBottom: 8 }}>{error}</div> : null}
      {loading ? <div className="owner-state owner-text-muted">Loading…</div> : (
        <>
          {alerts.length ? (
            <div className="owner-drill" style={{ marginBottom: 12 }} aria-label="Active safety alerts">
              {alerts.map((a) => (
                <div className="owner-drillrow" key={a.postId} data-testid="owner-community-alert">
                  <div style={{ minWidth: 0 }}>
                    <div className="nm">{a.title}</div>
                    <div className="mt">{pretty(a.category)} · {a.author?.label || 'A salon'} · read it in the POS Safety Community</div>
                  </div>
                  <span className="owner-statusbadge" style={{ background: a.severity === 'critical' ? 'var(--owner-danger-bg)' : 'var(--owner-warning-bg, #FFF4DF)', color: a.severity === 'critical' ? 'var(--owner-danger)' : 'var(--owner-warning, #CE8A2C)' }}>{SEV[a.severity] ?? a.severity}</span>
                </div>
              ))}
            </div>
          ) : <div className="owner-text-muted" style={{ fontSize: 12.5, marginBottom: 10 }} data-testid="owner-community-no-alerts">No active safety alerts.</div>}
          {waiting.length ? (
            <div className="owner-drill" aria-label="Advisories waiting for approval">
              {waiting.map((p) => (
                <div className="owner-drillrow" key={p.id} data-testid="owner-community-approval" style={{ display: 'block' }}>
                  <div className="nm">{p.title}</div>
                  <div className="mt">{pretty(p.category)} · {SEV[p.severity] ?? p.severity}{p.moderationRequired ? ' · moderators review it after you approve' : ''}</div>
                  <div style={{ fontSize: 13, margin: '6px 0', whiteSpace: 'pre-wrap' }}>{p.body}</div>
                  {p.privacyScanFlags?.length ? <div className="mt">Hidden by the privacy check: {p.privacyScanFlags.map(pretty).join(', ')}</div> : null}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="owner-btn" disabled={busy === p.id} aria-label={`Approve: ${p.title}`}
                      onClick={() => act(p, () => ownerCommunityApi.approve(p.id, p.version), (r) => (r.status === 'moderation_review' ? `Approved “${p.title}” — AI PowerSalon moderators review it next.` : `Approved and published “${p.title}”.`))}>Approve</button>
                    <button className="owner-btn" disabled={busy === p.id} aria-label={`Return: ${p.title}`} onClick={() => { setReturning(p.id); setNote(''); }}>Return</button>
                  </div>
                  {returning === p.id ? (
                    <div role="group" aria-label={`Return ${p.title} for correction`} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>Note for the writer
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, borderRadius: 8, border: '1px solid var(--owner-border, #E7DCC8)' }} />
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="owner-btn" disabled={busy === p.id || note.trim().length < 3} onClick={() => act(p, () => ownerCommunityApi.returnAdvisory(p.id, p.version, note.trim()), () => `Returned “${p.title}” to the writer.`)}>Send back</button>
                        <button className="owner-btn" onClick={() => setReturning(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : <div className="owner-state" style={{ marginTop: 4 }} data-testid="owner-community-empty">No advisories waiting for your approval.</div>}
          <button className="owner-btn" style={{ marginTop: 10 }} onClick={openCommunitySettings}>Community settings</button>
        </>
      )}
    </section>
  );
}
