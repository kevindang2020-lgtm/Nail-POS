// POSReferralsScreen.tsx — Marketing → Referrals. The salon referral program over the real /pos/referrals
// slice: program KPIs, a form to record a referral (a customer's code brought in a new customer), the list of
// referrals, and a per-row reward action. Referrer/referred names, statuses, and reward totals are all real —
// empty until referrals are recorded. Money is integer cents.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posReferralsApi } from '../api/posReferralsApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { money, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';

type Row = { id: string; referrerName: string | null; referredName: string | null; code: string; status: string; rewardCents: number; redeemedAt: string; rewardedAt: string | null };
type Kpis = { codesIssued: number; totalReferrals: number; pendingReferrals: number; rewardedReferrals: number; rewardValueCents: number };
type Hit = { customerId: string; fullName: string; phone?: string };

const statusChip = (s: string) => {
  const map: Record<string, string> = { pending: '#B5651D', rewarded: '#2E9E54', void: '#9A9A9A' };
  return <span style={{ color: map[s] ?? '#666', fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{s}</span>;
};
const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };

export function POSReferralsScreen() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // record form
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [saving, setSaving] = useState(false);
  // reward
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [rewardDollars, setRewardDollars] = useState('10');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const s = await posReferralsApi.state(); setKpis(s.kpis); setRows(s.redemptions ?? []); }
    catch (e: any) { setError(reportError(e, 'referrals')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    let on = true;
    const t = setTimeout(async () => {
      try { const r: any = await posCustomersApi.quickSearch(q.trim()); if (on) setHits((r?.items ?? []).slice(0, 6)); } catch { if (on) setHits([]); }
    }, 250);
    return () => { on = false; clearTimeout(t); };
  }, [q]);

  const record = async () => {
    if (!code.trim() || !picked) { setNote(tx('pos.enter_a_referral_code_and_pick_1w3t')); return; }
    setSaving(true); setNote(null);
    try { await posReferralsApi.record(code.trim(), picked.customerId); setCode(''); setQ(''); setPicked(null); setHits([]); setNote(tx('pos.referral_recorded')); await load(); }
    catch (e: any) { setNote(e?.message || tx('pos.could_not_record_the_referral')); }
    finally { setSaving(false); }
  };

  const doReward = async (id: string) => {
    const cents = parseDollarsToCents(rewardDollars || '0') ?? NaN;   // invalid text must FAIL isFinite below, not reward $0.00
    if (!Number.isFinite(cents) || cents < 0) { setNote(tx('pos.enter_a_valid_reward_amount')); return; }
    try { await posReferralsApi.reward(id, cents); setRewardId(null); await load(); }
    catch (e: any) { setNote(e?.message || tx('pos.could_not_reward')); }
  };

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_referral_program')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.referral_program')}</h1><div className="sub">{tx('pos.reward_customers_who_bring_in_friends')}</div></div>

      {kpis ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.referral_codes')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{kpis.codesIssued}</div></div>
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.total_referrals')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{kpis.totalReferrals}</div></div>
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.pending_reward')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{kpis.pendingReferrals}</div></div>
          <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.rewards_paid')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(kpis.rewardValueCents)}</div></div>
        </div>
      ) : null}

      <section className="panel" style={{ marginTop: 12, maxWidth: 620 }}>
        <div className="p-h">{tx('pos.record_a_referral')}</div>
        <div className="flex flex-col gap-0 mt-2">
          <div className="lf">
            <label>{tx('pos.referral_code')}</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tx('pos.e_g_alice10')} style={{ width: '100%' }} />
          </div>
          <div className="lf" style={{ alignItems: 'flex-start' }}>
            <label style={{ marginTop: 10 }}>{tx('pos.new_customer_3')}</label>
            <div style={{ width: '100%' }}>
              {picked ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{picked.fullName}</span>
                  <button className="btn ghost" onClick={() => { setPicked(null); setQ(''); }}>{tx('pos.change')}</button>
                </div>
              ) : (
                <>
                  <ImeSafeInput value={q} onValue={setQ} placeholder={tx('pos.search_customer_by_name_or_phone')} style={{ width: '100%' }} />
                  {hits.length > 0 ? (
                    <div style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                      {hits.map((h) => (
                        <button key={h.customerId} onClick={() => { setPicked(h); setHits([]); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: '#fff', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {h.fullName}{h.phone ? <span className="sub" style={{ fontSize: 12 }}> · {h.phone}</span> : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 flex items-center gap-3" style={{ borderTop: '1px solid var(--line)' }}>
            <button className="btn primary" disabled={saving} onClick={record}>{saving ? tx('pos.recording') : tx('pos.record_referral')}</button>
            {note ? <span className="sub" style={{ color: note.includes('recorded') ? '#2E9E54' : '#C0392B', fontSize: 13 }}>{note}</span> : null}
          </div>
        </div>
      </section>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{tx('pos.referrals')}</div>
        {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_referrals_recorded_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <table className="tbl">
                <thead><tr><th>{tx('pos.referrer')}</th><th>{tx('pos.new_customer')}</th><th>{tx('pos.code')}</th><th>{tx('pos.date')}</th><th>{tx('pos.status')}</th><th>{tx('pos.reward')}</th><th></th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.referrerName || '—'}</td>
                    <td>{r.referredName || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.code}</td>
                    <td className="sub" style={{ fontSize: 12.5 }}>{fmtDate(r.redeemedAt)}</td>
                    <td>{statusChip(r.status)}</td>
                    <td>{r.status === 'rewarded' ? money(r.rewardCents) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.status === 'pending' ? (
                        rewardId === r.id ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <span>$</span><input value={rewardDollars} onChange={(e) => setRewardDollars(e.target.value)} style={{ width: 60, padding: 4 }} aria-label={tx('pos.reward_amount')} />
                            <button className="btn primary" onClick={() => doReward(r.id)}>{tx('pos.confirm')}</button>
                            <button className="btn ghost" onClick={() => setRewardId(null)}>{tx('pos.cancel')}</button>
                          </span>
                        ) : <button className="btn ghost" onClick={() => { setRewardId(r.id); setNote(null); }}>{tx('pos.reward')}</button>
                      ) : null}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 10 }}>{tx('pos.referral_codes_are_created_for_customers_1jdi')}</div>
    </div>
  );
}
