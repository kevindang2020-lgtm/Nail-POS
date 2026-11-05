import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechWorkplace } from '../api/techApi';
import { useTechNav } from '../shell/nav';

// TechWorkplacesScreen — one profile, several salons.
//
// The technician's global account belongs to HER. This screen is where that stops being an architecture diagram
// and becomes something she can see: every salon she works at, every invitation waiting on her, every job she
// used to have — and the switch between the live ones.
//
// == THE CACHE, AND WHY THIS RELOADS ======================================================================
//
// A salon switch changes the tenant of every single thing on screen — her tickets, her queue, her schedule, her
// earnings, her customers. The spec is explicit: "Frontend clears old salon cache. App loads only selected
// salon's data."
//
// This app keeps that state in component state scattered across a dozen screens. Reaching into each of them to
// invalidate it would be a list somebody forgets to update the day a new screen lands, and the failure mode of
// forgetting is SALON A'S TICKETS RENDERED UNDER SALON B'S NAME. So the switch does a full reload: the server
// has already re-signed the session cookie for the new salon, and a reload rebuilds every screen from it with no
// possibility of a stale row surviving.
//
// A hard reload is a blunt instrument. It is also the only one here that cannot be half-right.

const STATUS_LABEL: Record<string, string> = {
  active: 'Working here',
  pending_invite: 'Invitation waiting',
  pending_tech_approval: 'Waiting for you',
  pending_salon_approval: 'Waiting for the salon',
  suspended: 'Access paused by the salon',
  former: 'Former salon',
  rejected: 'Declined by the salon',
  revoked: 'Access removed',
  cancelled: 'Cancelled',
};

const badgeStyle = (w: TechWorkplace): React.CSSProperties => {
  if (w.canWorkHere) return { background: '#E7F3EC', color: '#2E6B47' };
  if (w.awaitingMe) return { background: '#FDF1DC', color: '#8A5A16' };
  if (w.awaitingSalon) return { background: '#EEF1F6', color: '#4A5568' };
  return { background: '#F2F2F2', color: '#777' };
};
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function TechWorkplacesScreen() {
  const nav = useTechNav();
  const [rows, setRows] = useState<TechWorkplace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    techApi.workplaces()
      .then((r) => { setRows(r.workplaces); setError(null); })
      .catch((e: any) => setError(e?.message || 'Couldn’t load your salons.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key); setNote(null); setError(null);
    try { await fn(); if (msg) setNote(msg); load(); }
    catch (e: any) { setError(e?.message || 'That didn’t work.'); }
    finally { setBusy(null); }
  }, [load]);

  const switchTo = useCallback(async (w: TechWorkplace) => {
    setBusy(w.membershipId); setError(null);
    try {
      await techApi.switchSalon(w.tenantId);
      // The session cookie is now signed for the new salon. Rebuild everything from it — see the note above.
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || 'Couldn’t switch salon.');
      setBusy(null);
    }
  }, []);

  const active = (rows ?? []).filter((w) => w.canWorkHere);
  const waiting = (rows ?? []).filter((w) => w.awaitingMe);
  const pending = (rows ?? []).filter((w) => w.awaitingSalon);
  const past = (rows ?? []).filter((w) => !w.canWorkHere && !w.awaitingMe && !w.awaitingSalon);

  const card: React.CSSProperties = {
    border: '1px solid var(--tech-border)', borderRadius: 12, padding: 12, marginBottom: 8, background: 'var(--tech-surface)',
  };

  const Row = ({ w, children }: { w: TechWorkplace; children?: React.ReactNode }) => (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{w.salonName}</div>
          <div className="tech-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {w.roleLabel || 'Technician'}
            {w.isCurrentSession ? ' · you are here now' : ''}
          </div>
        </div>
        <span style={{ ...badgeStyle(w), fontSize: 11, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
          {STATUS_LABEL[w.status] ?? w.status}
        </span>
      </div>
      {children ? <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>{children}</div> : null}
    </div>
  );

  return (
    <div style={{ overflowY: 'auto', paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="tech-iconbtn" onClick={() => nav.back()}><Back /></button>
        <h1 className="t-title" style={{ margin: 0, fontSize: 19 }}>My Salons</h1>
      </div>
      <div className="tech-main-2">
        <h2 style={{ margin: '15px 0 4px', fontSize: 20, fontWeight: 400 }}>My Salons</h2>
        <div className="tech-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Your profile, portfolio, followers and rating belong to you and stay the same at every salon. Each salon
          keeps its own schedule, pay and customers — those never move.
        </div>

      {error ? <div style={{ ...card, borderColor: '#D9534F', color: '#B3403C', fontSize: 13 }}>{error}</div> : null}
      {note ? <div style={{ ...card, borderColor: '#2E6B47', color: '#2E6B47', fontSize: 13 }}>{note}</div> : null}

      {rows === null && !error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="tech-skel" style={{ width: 100, height: 14, margin: '14px 0 6px' }} />
          {[1, 2].map(i => (
            <div key={i} style={{ border: '1px solid var(--tech-border)', borderRadius: 12, padding: 12, marginBottom: 8, background: 'var(--tech-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="tech-skel" style={{ width: 140, height: 16 }} />
                  <div className="tech-skel" style={{ width: 100, height: 14 }} />
                </div>
                <div className="tech-skel" style={{ width: 80, height: 20, borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {waiting.length ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 6px', letterSpacing: 0.3 }}>WAITING FOR YOU</div>
          {waiting.map((w) => (
            <Row key={w.membershipId} w={w}>
              <button
                className="tech-btn"
                disabled={busy === w.membershipId}
                onClick={() => act(w.membershipId, () => techApi.acceptWorkplace(w.membershipId), `You now work at ${w.salonName}.`)}
              >
                Accept
              </button>
              <button
                className="tech-btn ghost"
                disabled={busy === w.membershipId}
                onClick={() => act(w.membershipId, () => techApi.declineWorkplace(w.membershipId), 'Declined.')}
              >
                Decline
              </button>
            </Row>
          ))}
        </>
      ) : null}

      {active.length ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 6px', letterSpacing: 0.3 }}>WORKING AT</div>
          {active.map((w) => (
            <Row key={w.membershipId} w={w}>
              {w.isCurrentSession ? (
                <span className="tech-muted" style={{ fontSize: 12, alignSelf: 'center' }}>This is the salon you are signed in to.</span>
              ) : (
                <button className="tech-btn" disabled={!!busy} onClick={() => switchTo(w)}>
                  {busy === w.membershipId ? 'Switching…' : `Switch to ${w.salonName}`}
                </button>
              )}
            </Row>
          ))}
        </>
      ) : null}

      {pending.length ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 6px', letterSpacing: 0.3 }}>WAITING FOR THE SALON</div>
          {pending.map((w) => <Row key={w.membershipId} w={w} />)}
        </>
      ) : null}

      {past.length ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 6px', letterSpacing: 0.3 }}>PAST</div>
          {past.map((w) => <Row key={w.membershipId} w={w} />)}
        </>
      ) : null}

      {rows !== null && rows.length === 0 ? (
        <div className="tech-muted" style={{ fontSize: 13 }}>
          You aren’t connected to any salon yet. Ask a salon for their code and send a request from My Profile.
        </div>
      ) : null}
      </div>
    </div>
  );
}
