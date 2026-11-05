import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import {
  superAdminTechniciansApi as api,
  type SATechDetail, type SATechDuplicateGroup, type SATechRow, type SATechSupport, type SATechStatusEvent,
} from '../api/superAdminTechniciansApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';

// GlobalTechniciansScreen — the technician's PLATFORM account.
//
// Not the roster. The roster is a salon's list of who works there, and every salon has its own. This is the one
// account underneath all of them: her permanent TECH-000123, her portfolio, her followers, her rating, and the
// list of every salon she has ever worked at.
//
// It is also the only screen on the platform that can suspend, merge or erase that account — and it is
// deliberately hard to do any of the three by accident.

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#E7F3EC', fg: '#2E6B47' },
  suspended: { bg: '#FDF1DC', fg: '#8A5A16' },
  anonymized: { bg: '#F2F2F2', fg: '#777777' },
  merged: { bg: '#EEF1F6', fg: '#4A5568' },
};

const Badge = ({ s }: { s: string }) => {
  const c = STATUS_STYLE[s] ?? { bg: '#F2F2F2', fg: '#777' };
  return <span style={{ background: c.bg, color: c.fg, fontSize: 11, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{s}</span>;
};

export function GlobalTechniciansScreen() {
  const [tab, setTab] = useState<'search' | 'duplicates'>('search');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SATechRow[] | null>(null);
  const [groups, setGroups] = useState<SATechDuplicateGroup[][] | null>(null);
  const [sel, setSel] = useState<SATechDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elevated, setElevated] = useState(false);

  const search = useCallback(() => {
    api.search(q).then((r) => { setRows(r.technicians); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Couldn’t search technician accounts.'));
  }, [q]);

  useEffect(() => { const t = setTimeout(search, q ? 300 : 0); return () => clearTimeout(t); }, [search, q]);
  useEffect(() => {
    if (tab !== 'duplicates') return;
    api.duplicates().then((r) => setGroups(r.groups)).catch((e: any) => setErr(e?.message || 'Couldn’t load duplicates.'));
  }, [tab]);

  useEffect(() => { api.myElevation().then((r) => setElevated(!!r.elevated)).catch(() => setElevated(false)); }, []);

  const open = useCallback((profileId: string) => {
    setNote(null); setErr(null);
    api.detail(profileId).then(setSel).catch((e: any) => setErr(e?.message || 'Couldn’t load that account.'));
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null); setNote(null);
    try { await fn(); setNote(ok); if (sel) open(sel.profile.profileId); search(); }
    catch (e: any) { setErr(e?.message || e?.body?.message || 'That didn’t work.'); }
    finally { setBusy(false); }
  }, [sel, open, search]);

  const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #EFE7DA' };

  return (
    <div className="work !p-5">
      <div className=" flex flex-col lg:flex-row justify-between gap-3 mb-3" >
        <div className="vh">
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Technician Accounts</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>The platform account, not a salon’s roster. One per technician, permanent, owned by her.</div>
        </div>
        <div className='self-baseline' style={{ display: 'flex', gap: 6}}>
        <button className={`btn ${tab === 'search' ? '' : 'ghost'}`} onClick={() => setTab('search')}>Search</button>
        <button className={`btn ${tab === 'duplicates' ? '' : 'ghost'}`} onClick={() => setTab('duplicates')}>Duplicate profiles</button>
      </div>
      </div>
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      {note ? <div className="state" style={{ marginBottom: 10, color: '#2E6B47' }}>{note}</div> : null}

      {tab === 'search' ? (
        <section className="panel w-full max-w-full overflow-x-auto">
          <input
            placeholder="Search by TECH code, name, phone or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #E3D8C6', borderRadius: 8, marginBottom: 10,maxWidth: 400, }}
          />
          {rows === null ? <div className="state">Loading…</div> : rows.length === 0 ? (
            <div className="state">No technician accounts match that.</div>
          ) : (
              <table className="w-full min-w-[700px] border-collapse">
              <thead><tr>
                {['Tech code', 'Name', 'Status', 'Rating', 'Salons', ''].map((h) => (
                  <th key={h} style={{ ...cell, textAlign: 'left', fontSize: 11, opacity: 0.6 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.profileId}>
                    <td style={{ ...cell, fontFamily: 'monospace' }}>{t.techCode}</td>
                    <td style={cell}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ProfileAvatarWithPreview name={t.displayName} url={(t as any).avatarUrl} size={26} type="technician" subtitle={`/t/${(t as any).publicSlug || t.techCode}`} /><span>{t.displayName}</span></div></td>
                    <td style={cell}><Badge s={t.status} /></td>
                    {/* null rating renders as an em dash. A 0 would be a slander. */}
                    <td style={cell}>{t.overallRating != null ? `${t.overallRating.toFixed(1)}★ (${t.ratingCount})` : '—'}</td>
                    <td style={cell}>{t.activeSalonCount}</td>
                    <td style={cell}><button className="btn ghost" onClick={() => open(t.profileId)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="state" style={{ fontSize: 12, marginBottom: 8 }}>
            Two accounts that share a phone number or an email — usually one salon created her with a phone and
            another with an email, and neither key matched. Merging is irreversible.
          </div>
          {groups === null ? <div className="state">Loading…</div> : groups.length === 0 ? (
            <div className="state">No duplicate technician accounts detected.</div>
          ) : groups.map((g, i) => (
            <div key={i} style={{ border: '1px solid #EFE7DA', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              {g.map((p) => (
                <div key={p.profileId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.techCode}</span>
                  <span style={{ fontSize: 13 }}>{p.displayName}</span>
                  <Badge s={p.status} />
                  <button className="btn ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => open(p.profileId)}>Open</button>
                </div>
              ))}
              <MergeBox group={g} busy={busy} elevated={elevated} onMerge={(canonical, dup, reason) => act(() => api.merge(canonical, dup, reason), 'Merged.')} />
            </div>
          ))}
        </section>
      )}

      {sel ? <Detail d={sel} busy={busy} onClose={() => setSel(null)} act={act} /> : null}
    </div>
  );
}

/** Merging picks a WINNER between two accounts. The operator names which, and says why, or it does not happen. */
function MergeBox({ group, busy, elevated, onMerge }: {
  group: SATechDuplicateGroup[]; busy: boolean; elevated: boolean;
  onMerge: (canonicalId: string, duplicateId: string, reason: string) => void;
}) {
  const [keep, setKeep] = useState(group[0]?.profileId ?? '');
  const [reason, setReason] = useState('');
  const dup = group.find((p) => p.profileId !== keep);
  if (group.length !== 2) {
    return <div className="state" style={{ fontSize: 12, marginTop: 6 }}>More than two accounts in this group — merge them two at a time.</div>;
  }
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={keep} onChange={(e) => setKeep(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #E3D8C6', borderRadius: 8, fontSize: 12 }}>
        {group.map((p) => <option key={p.profileId} value={p.profileId}>Keep {p.techCode}</option>)}
      </select>
      <input
        placeholder="Why are these the same person?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ flex: 1, minWidth: 180, padding: '6px 8px', border: '1px solid #E3D8C6', borderRadius: 8, fontSize: 12 }}
      />
      <button className="btn" disabled={busy || !reason.trim() || !dup || !elevated} onClick={() => dup && onMerge(keep, dup.profileId, reason.trim())}>
        {elevated ? 'Merge' : 'Merge — needs elevated approval'}
      </button>
    </div>
  );
}

/** The account, the salons she has worked at, and the three things only Super Admin can do to it. */
function Detail({ d, busy, onClose, act }: {
  d: SATechDetail; busy: boolean; onClose: () => void;
  act: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState('technician');
  const { ask, askUi } = useInlineAsk();
  const [sup, setSup] = useState<SATechSupport | null>(null);
  const [history, setHistory] = useState<SATechStatusEvent[] | null>(null);
  const p = d.profile;
  const req = d.openDeleteRequest;
  const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid #EFE7DA' };

  useEffect(() => {
    api.support(p.profileId).then(setSup).catch(() => setSup(null));
    api.statusHistory(p.profileId).then((r) => setHistory(r.events)).catch(() => setHistory(null));
  }, [d]);          // reloads whenever act() refreshes the detail

  const scopeToggle = (scope: 'profile' | 'messaging' | 'deals', on: boolean, label: string) => {
    const paused = !on;
    if (paused) { ask(`Reason to pause ${label}?`, (why) => act(() => api.scopedPause(p.profileId, scope, true, why), `${label} paused.`)); }
    else act(() => api.scopedPause(p.profileId, scope, false), `${label} resumed.`);
  };

  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{p.displayName}</h2>
        <span style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.7 }}>{p.techCode}</span>
        <Badge s={p.status} />
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      {p.suspendReason ? <div className="state" style={{ fontSize: 12, marginTop: 4 }}>Suspended: {p.suspendReason}</div> : null}

      <h3 style={{ fontSize: 13, margin: '12px 0 4px' }}>Work history</h3>
      {d.salons.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No salon has ever employed this account.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {d.salons.map((s) => (
              <tr key={s.membershipId}>
                <td style={cell}>{s.salonName}{s.branchName ? ` · ${s.branchName}` : ''}</td>
                <td style={cell}><Badge s={s.status} /></td>
                <td style={{ ...cell, opacity: 0.7 }}>
                  {s.startedAt ? new Date(s.startedAt).toLocaleDateString() : '—'}
                  {s.endedAt ? ` → ${new Date(s.endedAt).toLocaleDateString()}` : ''}
                  {s.endedReason ? ` (${s.endedReason})` : ''}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {s.status === 'active' ? (
                    <button className="btn ghost" disabled={busy} style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => ask(`Reason to pause this membership at ${s.salonName}?`, (why) => act(() => api.pauseMembership(s.membershipId, why), 'Membership paused.'))}>
                      Pause here
                    </button>
                  ) : s.status === 'paused' ? (
                    <button className="btn" disabled={busy} style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => act(() => api.reactivateMembership(s.membershipId), 'Membership reactivated.')}>
                      Reactivate
                    </button>
                  ) : s.status === 'pending_salon_approval' ? (
                    <>
                      <button className="btn" disabled={busy} style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => act(() => api.approveDestination(s.membershipId), 'Arrival approved — awaiting technician.')}>
                        Approve arrival
                      </button>
                      <button className="btn ghost" disabled={busy} style={{ fontSize: 11, padding: '3px 8px', marginLeft: 4 }}
                        onClick={() => ask('Reason to reject this arrival?', (why) => act(() => api.rejectDestination(s.membershipId, why || undefined), 'Arrival rejected.'), { optional: true })}>
                        Reject
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ fontSize: 13, margin: '14px 0 4px' }}>Platform account</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {p.status === 'suspended' ? (
          <button className="btn" disabled={busy} onClick={() => act(() => api.restore(p.profileId), 'Account restored.')}>Restore account</button>
        ) : p.status === 'locked' ? (
          <button className="btn" disabled={busy} onClick={() => act(() => api.unlock(p.profileId), 'Account unlocked.')}>Unlock (reset lock)</button>
        ) : p.status === 'paused' ? (
          <>
            <button className="btn" disabled={busy} onClick={() => act(() => api.reactivate(p.profileId), 'Account reactivated.')}>Reactivate account</button>
            <button className="btn ghost" disabled={busy} onClick={() => ask('Reason to lock this account?', (why) => act(() => api.lock(p.profileId, why), 'Account locked.'))}>Lock</button>
          </>
        ) : p.status === 'active' ? (
          <>
            <input
              placeholder="Reason (pause or suspend)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '6px 8px', border: '1px solid #E3D8C6', borderRadius: 8, fontSize: 12 }}
            />
            <button className="btn ghost" disabled={busy || !reason.trim()} onClick={() => act(() => api.pause(p.profileId, reason.trim()), 'Account paused.')}>
              Pause account
            </button>
            <button className="btn" disabled={busy || !reason.trim()} onClick={() => act(() => api.suspend(p.profileId, reason.trim()), 'Account suspended.')}>
              Suspend account
            </button>
            <button className="btn ghost" disabled={busy || !reason.trim()} onClick={() => act(() => api.lock(p.profileId, reason.trim()), 'Account locked.')}>
              Lock
            </button>
          </>
        ) : (
          <div className="state" style={{ fontSize: 12 }}>This account is {p.status}. Nothing further can be done to it.</div>
        )}
      </div>

      {/* ── Erasure: request → decision → act. Three steps, and the UI does not let you skip one. ────────── */}
      {p.status !== 'anonymized' && p.status !== 'merged' ? (
        <>
          <h3 style={{ fontSize: 13, margin: '14px 0 4px' }}>Deletion / anonymization</h3>
          {!req ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #E3D8C6', borderRadius: 8, fontSize: 12 }}>
                <option value="technician">Technician asked</option>
                <option value="support">Support raised</option>
                <option value="legal">Legal raised</option>
              </select>
              <input
                placeholder="Reason (required — this cannot be undone)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ flex: 1, minWidth: 220, padding: '6px 8px', border: '1px solid #E3D8C6', borderRadius: 8, fontSize: 12 }}
              />
              <button className="btn ghost" disabled={busy || !reason.trim()}
                onClick={() => act(() => api.requestDeletion(p.profileId, { reason: reason.trim(), requesterKind: kind }), 'Deletion request logged.')}>
                Log deletion request
              </button>
            </div>
          ) : (
            <div style={{ border: '1px solid #E3D8C6', borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12.5 }}>
                Request is <b>{req.status}</b>{req.legalHold ? ' · UNDER LEGAL HOLD' : ''} — “{req.reason}”
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {req.status === 'pending' ? (
                  <>
                    <button className="btn" disabled={busy} onClick={() => act(() => api.decideDeletion(req.requestId, 'approve'), 'Request approved. It can now be carried out.')}>Approve request</button>
                    <button className="btn ghost" disabled={busy} onClick={() => act(() => api.decideDeletion(req.requestId, 'reject'), 'Request rejected.')}>Reject</button>
                  </>
                ) : (
                  <button
                    className="btn"
                    disabled={busy || req.legalHold || !sup?.elevatedForDangerousActions}
                    style={{ background: '#B3403C', borderColor: '#B3403C', color: '#fff' }}
                    onClick={() => act(() => api.anonymize(p.profileId), 'Account anonymized. The technician ID is retired and will never be reused.')}
                  >
                    {req.legalHold ? 'Blocked by legal hold' : !sup?.elevatedForDangerousActions ? 'Needs elevated approval' : 'Anonymize this account'}
                  </button>
                )}
              </div>
              <div className="state" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
                Anonymizing erases her name, photo, bio, portfolio and followers, and releases her phone and email.
                Her <b>{p.techCode}</b> is retired and never reused. Every salon’s tickets, payroll and audit history
                are untouched — those belong to the salon and key on its own employment record, not on this account.
              </div>
            </div>
          )}
        </>
      ) : null}
      {/* ── Support & security: scoped pauses, live sessions, open tickets ─────────────────────────────── */}
      {p.status !== 'anonymized' && p.status !== 'merged' ? (
        <>
          <h3 style={{ fontSize: 13, margin: '14px 0 4px' }}>Support &amp; security</h3>
          {!sup ? <div className="state" style={{ fontSize: 12 }}>Loading…</div> : (
            <div style={{ border: '1px solid #E3D8C6', borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className={`btn ${sup.security.profileHidden ? '' : 'ghost'}`} disabled={busy} style={{ fontSize: 11.5 }}
                  onClick={() => scopeToggle('profile', !sup.security.profileHidden, 'public profile')}>
                  {sup.security.profileHidden ? 'Profile hidden — resume' : 'Hide public profile'}
                </button>
                <button className={`btn ${sup.security.messagingPaused ? '' : 'ghost'}`} disabled={busy} style={{ fontSize: 11.5 }}
                  onClick={() => scopeToggle('messaging', !sup.security.messagingPaused, 'messaging')}>
                  {sup.security.messagingPaused ? 'Messaging paused — resume' : 'Pause messaging'}
                </button>
                <button className={`btn ${sup.security.dealsFrozen ? '' : 'ghost'}`} disabled={busy} style={{ fontSize: 11.5 }}
                  onClick={() => scopeToggle('deals', !sup.security.dealsFrozen, 'deals')}>
                  {sup.security.dealsFrozen ? 'Deals frozen — unfreeze' : 'Freeze deals'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, fontSize: 12.5 }}>
                <span><b>{sup.activeSessions}</b> live session{sup.activeSessions === 1 ? '' : 's'}</span>
                <button className="btn ghost" disabled={busy || sup.activeSessions === 0} style={{ fontSize: 11.5 }}
                  onClick={() => act(() => api.revokeSessions(p.profileId), 'Sessions revoked.')}>Revoke all sessions</button>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, padding: '2px 8px', borderRadius: 10, background: sup.elevatedForDangerousActions ? '#E4F3E4' : '#FBECEC', color: sup.elevatedForDangerousActions ? '#2E6B2E' : '#8A2E2E' }}>
                  {sup.elevatedForDangerousActions ? 'Elevated — erase/merge allowed' : 'Not elevated — erase/merge need an approved grant'}
                </span>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Open support tickets ({sup.openTicketCount})</div>
                {sup.openTickets.length === 0 ? <div className="state" style={{ fontSize: 12 }}>None open.</div> : sup.openTickets.map((t) => (
                  <div key={t.ticketId} style={{ fontSize: 12, padding: '3px 0' }}>· {t.subject} <span style={{ opacity: 0.6 }}>({t.status})</span></div>
                ))}
              </div>
            </div>
          )}

          <h3 style={{ fontSize: 13, margin: '14px 0 4px' }}>Status history</h3>
          {!history || history.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No status changes recorded.</div> : (
            <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #EFE7DA', borderRadius: 8 }}>
              {history.map((e, i) => (
                <div key={i} style={{ ...cell, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <span><b>{e.action}</b>{e.reason ? ` — ${e.reason}` : ''}</span>
                  <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
      {askUi}
    </section>
  );
}
