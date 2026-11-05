import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// ActiveSupportSessions — who has elevated access into a customer's live business RIGHT NOW, and the button
// that takes it away.
//
// == THE BUG THIS CLOSES ==================================================================================
//
// A Super Admin could START a support session into any tenant — elevated access to a live salon's real data,
// with a reason and a duration — and the confirmation said:
//
//     "visible banner active, every action audited, auto-expires."
//
// All true. And then:
//
//     superAdminApi.supportSessions(active)   — EXISTED. No screen called it.
//     superAdminApi.endSupportSession(id)     — EXISTED. No screen called it.
//     POST /super-admin/platform/support-sessions/:id/end  — live, guarded, audited.
//
// So the platform could grant itself access into a paying customer's business, and then:
//
//   • nobody could SEE which sessions were currently live, and
//   • nobody could END one early. You waited for the clock.
//
// "It auto-expires" is not a revocation story. If a session is started by mistake, or with too long a window, or
// by an account that has since been compromised, or if a customer asks *"is anyone in my system right now?"* —
// there was no answer and no off switch. An elevated access grant with no revoke is not a controlled session.
//
// Start with no stop. That is the whole bug, and it is the same shape as `reactivate` (a tenant that can be
// suspended and never un-suspended) and `unassignTechnician` (assign with no undo).

interface SupportSession {
  id: string;
  tenant_id: string;
  admin_email: string | null;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
}

const mins = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));

export function ActiveSupportSessions({ onChanged }: { onChanged?: (msg: string) => void }) {
  const [rows, setRows] = useState<SupportSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    superAdminApi.supportSessions(true)
      .then((r: any) => { setRows((Array.isArray(r) ? r : r?.sessions ?? []).filter((s: SupportSession) => !s.ended_at)); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Couldn’t load active support sessions.'));
  }, []);

  useEffect(() => {
    load();
    // Access that expires on a clock needs a view that follows the clock.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const end = async (s: SupportSession) => {
    setBusy(s.id); setErr(null);
    try {
      await superAdminApi.endSupportSession(s.id);
      onChanged?.('Support session ended. Access revoked immediately.');
      load();
    } catch (e: any) {
      setErr(e?.message || 'Couldn’t end that session.');
    } finally { setBusy(null); }
  };

  const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #EFE7DA', textAlign: 'left' };

  return (
    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span style={{ fontSize: 13, fontWeight: 700, color: '#5A4B37' }}>
          Active support sessions
        </span>

        <span className="" style={{ fontSize: 11.5 }}>
          Who has elevated access into a customer’s live business right now.
        </span>

        <button
          className="btn ghost"
          style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {err ? (
        <div className="err" style={{ fontSize: 12, marginBottom: 8 }}>
          {err}
        </div>
      ) : null}

      {rows === null ? (
        <div className="state" style={{ fontSize: 12 }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="state" style={{ fontSize: 12.5 }}>
          Nobody has support access to any tenant right now.
        </div>
      ) : (
        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                {['Tenant', 'Admin', 'Reason', 'Expires in', ''].map((h) => (
                  <th
                    key={h}
                    style={{ ...cell, fontSize: 11, opacity: 0.6 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td
                    style={{
                      ...cell,
                      fontFamily: 'monospace',
                      fontSize: 11.5,
                    }}
                  >
                    {s.tenant_id.slice(0, 8)}…
                  </td>

                  <td style={cell}>{s.admin_email || '—'}</td>

                  <td style={{ ...cell, maxWidth: 260 }}>
                    {s.reason}
                  </td>

                  <td
                    style={{
                      ...cell,
                      color: mins(s.expires_at) <= 5 ? '#B3403C' : undefined,
                    }}
                  >
                    {mins(s.expires_at)} min
                  </td>

                  <td style={cell}>
                    <button
                      className="btn"
                      style={{
                        background: '#B3403C',
                        borderColor: '#B3403C',
                        color: '#fff',
                        fontSize: 11,
                      }}
                      disabled={busy === s.id}
                      onClick={() => end(s)}
                    >
                      {busy === s.id ? 'Ending…' : 'End now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
