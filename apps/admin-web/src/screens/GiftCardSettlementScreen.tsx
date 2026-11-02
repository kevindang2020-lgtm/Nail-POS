import { useEffect, useState } from 'react';
import { giftCardSettlementApi, type SettlementState, type ClearingEntry } from '../api/superAdminGiftCardSettlementApi';
import { superAdminApi } from '../api/superAdminApi';

const money = (c: number) => (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toFixed(2);
const STATUS_LABEL: Record<string, string> = { open: 'Open', pending_review: 'Pending review', approved: 'Approved', settled: 'Settled', disputed: 'Disputed', reversed: 'Reversed', failed: 'Failed' };
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  open: { bg: '#EAF1FF', fg: '#2F6FED' },
  pending_review: { bg: '#FBF0DC', fg: '#B7791F' },
  approved: { bg: '#E7F5EC', fg: '#1F9254' },
  settled: { bg: '#E7F5EC', fg: '#1F9254' },
  disputed: { bg: '#FDF0E6', fg: '#D07A2A' },
  reversed: { bg: '#FBE7E4', fg: '#C0392B' },
  failed: { bg: '#FBE7E4', fg: '#C0392B' },
};

const ACTIONS: Record<string, { label: string; to: string }[]> = {
  open: [{ label: 'Submit for review', to: 'pending_review' }],
  pending_review: [{ label: 'Approve', to: 'approved' }, { label: 'Dispute', to: 'disputed' }],
  approved: [{ label: 'Mark settled', to: 'settled' }, { label: 'Dispute', to: 'disputed' }],
  disputed: [{ label: 'Back to review', to: 'pending_review' }, { label: 'Reverse', to: 'reversed' }],
  settled: [{ label: 'Reverse', to: 'reversed' }],
  failed: [{ label: 'Back to review', to: 'pending_review' }],
  reversed: [],
};

export default function GiftCardSettlementScreen() {
  const [state, setState] = useState<SettlementState | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ClearingEntry[]>([]);

  const load = () => giftCardSettlementApi.state().then(setState).catch((e: any) => setErr(e?.message || 'Could not load settlement.'));

  useEffect(() => {
    load();
    superAdminApi.state()
      .then((r: any) => {
        const list = (r?.tenants || []).map((t: any) => ({
          id: t.id,
          name: t.n || t.name || t.displayName || t.businessName || t.code || t.id,
          code: t.code || '',
        }));
        setTenants(list);
      })
      .catch(() => {});
  }, []);

  const createBatch = async () => { if (busy) return; setBusy(true); setErr(null); try { await giftCardSettlementApi.createBatch({}); await load(); } catch (e: any) { setErr(e?.message || 'Could not create the batch.'); } finally { setBusy(false); } };
  const advance = async (id: string, to: string) => { setErr(null); try { await giftCardSettlementApi.setBatchStatus(id, to); await load(); } catch (e: any) { setErr(e?.message || 'Could not update the batch.'); } };
  const viewEntries = async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setErr(null);
    try { const r = await giftCardSettlementApi.batch(id); setEntries(r.entries); setOpenId(id); }
    catch (e: any) { setErr(e?.message || 'Could not load the batch entries.'); }
  };

  const p = state?.pending;
  const totalPendingCount = p?.count ?? 0;
  const totalPendingGross = p?.totalCents ?? 0;
  const totalPendingFee = p?.feeCents ?? 0;
  const totalPendingNet = p?.netCents ?? 0;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Gift Card Settlement
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Cross-tenant redemptions create inter-tenant obligations: the issuing salon owes the redeeming salon. Group them into batches and review before any funds move. Nothing settles automatically.
          </div>
        </div>
      </div>

      {err && (
        <div style={{ color: '#C0392B', background: '#FBE7E4', border: '1px solid #F3C4BE', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>
          {err}
        </div>
      )}

      {/* 4 LUXURY KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[
          { label: 'Pending Obligations', val: totalPendingCount, icon: '⏳', bg: '#FBF0DC', fg: '#B7791F' },
          { label: 'Gross Obligations', val: money(totalPendingGross), icon: '💵', bg: '#EAF1FF', fg: '#2F6FED' },
          { label: 'Clearing Fees', val: money(totalPendingFee), icon: '🧾', bg: '#F3ECFB', fg: '#7C3AED' },
          { label: 'Net Settlement Due', val: money(totalPendingNet), icon: '🏦', bg: '#E7F5EC', fg: '#1F9254' },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</span>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: k.bg, color: k.fg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{k.icon}</span>
            </div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
              {k.val}
            </div>
          </div>
        ))}
      </div>

      {/* PENDING OBLIGATIONS PANEL */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📋</span>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Pending obligations</h2>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {p?.count ?? 0} entr{(p?.count ?? 0) === 1 ? 'y' : 'ies'} · {money(p?.totalCents ?? 0)} gross · {money(p?.feeCents ?? 0)} fees · <strong style={{ color: '#1F9254' }}>{money(p?.netCents ?? 0)} net</strong>
            </div>
          </div>
          <div>
            <button
              disabled={busy || (p?.count ?? 0) === 0}
              onClick={createBatch}
              className="btn"
              style={{ fontWeight: 800, padding: '10px 20px', height: 40 }}
            >
              {busy ? 'Creating batch…' : 'Create settlement batch'}
            </button>
          </div>
        </div>
      </section>

      {/* POSITIONS BY SALON */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        <div style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Positions by salon (outstanding)
          </h2>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Net inter-tenant clearing liabilities
          </span>
        </div>

        <div style={{ overflowX: 'auto', width: '100%' }}>
          {!state ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading positions…</div>
          ) : state.positions.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No outstanding cross-tenant balances.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Salon (tenant)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Receivable</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Payable</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Net Position</th>
                </tr>
              </thead>
              <tbody>
                {state.positions.map((pos, idx) => {
                  const salon = tenants.find((t) => t.id === pos.tenantId);
                  return (
                    <tr
                      key={pos.tenantId}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF9EF'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span>🏪</span>
                          <div>
                            {salon ? (
                              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{salon.name}</div>
                            ) : null}
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: salon ? 'var(--muted)' : 'inherit' }}>
                              {pos.tenantId}
                            </span>
                          </div>
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#1F9254', fontWeight: 700 }}>
                        {money(pos.receivableCents)}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#C0392B', fontWeight: 700 }}>
                        {money(pos.payableCents)}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 800, color: pos.netCents >= 0 ? '#1F9254' : '#C0392B' }}>
                        {money(pos.netCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* SETTLEMENT BATCHES */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Settlement batches
          </h2>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Human-reviewed settlement lifecycle
          </span>
        </div>

        {!state ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading batches…</div>
        ) : state.batches.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: '#FFFBF2', borderRadius: 10, border: '1px dashed var(--line)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📦</div>
            No settlement batches yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.batches.map((b) => {
              const tone = STATUS_TONE[b.status] || { bg: '#F0EFF4', fg: '#6B7280' };
              return (
                <div
                  key={b.id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: 16,
                    boxShadow: '0 2px 8px rgba(169, 111, 34, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: tone.bg, color: tone.fg, border: `1px solid ${tone.fg}30` }}>
                        {STATUS_LABEL[b.status] || b.status}
                      </span>
                      <span style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                        {money(b.netCents)} net
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        ({b.entryCount} entr{b.entryCount === 1 ? 'y' : 'ies'} · {money(b.totalCents)} gross · {money(b.feeCents)} fees)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => viewEntries(b.id)}
                        className="btn ghost sm"
                        style={{ padding: '5px 12px', fontSize: 12 }}
                      >
                        {openId === b.id ? 'Hide entries' : 'View entries'}
                      </button>
                      {(ACTIONS[b.status] || []).map((a) => (
                        <button
                          key={a.to}
                          onClick={() => advance(b.id, a.to)}
                          className={a.to === 'settled' || a.to === 'approved' ? 'btn sm' : 'btn ghost sm'}
                          style={{ padding: '5px 14px', fontSize: 12, fontWeight: 800 }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {openId === b.id && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', background: '#FFFBF2', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>
                        Clearing Entries
                      </div>
                      {entries.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No entries in this batch.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {entries.map((e) => {
                            const issuingSalon = tenants.find((t) => t.id === e.issuingTenantId);
                            const redeemingSalon = tenants.find((t) => t.id === e.redeemingTenantId);
                            return (
                              <div
                                key={e.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  background: '#FFFFFF',
                                  border: '1px solid var(--line)',
                                  borderRadius: 8,
                                  padding: '6px 12px',
                                  fontSize: 12,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontWeight: 600 }}>
                                    {issuingSalon ? issuingSalon.name : e.issuingTenantId.slice(0, 8)}
                                  </span>
                                  <span style={{ color: 'var(--muted)' }}>→</span>
                                  <span style={{ fontWeight: 600 }}>
                                    {redeemingSalon ? redeemingSalon.name : e.redeemingTenantId.slice(0, 8)}
                                  </span>
                                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#E7F5EC', color: '#1F9254', fontWeight: 700 }}>
                                    {e.status}
                                  </span>
                                </div>
                                <div style={{ fontWeight: 700 }}>
                                  {money(e.amountCents)}{e.platformFeeCents ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({money(e.platformFeeCents)} fee)</span> : ''}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
