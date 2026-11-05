import { useEffect, useState } from 'react';
import { ownerCompensationApi, type BonusRule, type BonusMetric, type BonusPreview, type EarnedBonus, type PeriodBonusReview } from '../api/ownerApi';

const METRICS: { value: BonusMetric; label: string; money: boolean }[] = [
  { value: 'service_production', label: 'Service production ($)', money: true },
  { value: 'retail_sales', label: 'Retail sales ($)', money: true },
  { value: 'rebooking_count', label: 'Rebookings (count)', money: false },
  { value: 'membership_count', label: 'Memberships sold (count)', money: false },
  { value: 'attendance_days', label: 'Attendance (days)', money: false },
  { value: 'rating_avg', label: 'Average rating', money: false },
  { value: 'team_goal', label: 'Team goal', money: false },
];
const isMoney = (m: BonusMetric) => METRICS.find((x) => x.value === m)?.money ?? false;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const fmt = (m: BonusMetric, v: number) => (isMoney(m) ? money(v) : String(v));

/**
 * Bonus Rules — define target-based bonuses (spec §17): a technician who reaches a metric target earns the amount. The
 * preview evaluates the rules against a technician's real period facts and shows which qualify — a recommendation for
 * review, not an automatic payout. Rendered inside the (reachable) Commission & Payroll screen.
 */
export function BonusRulesPanel() {
  const [rules, setRules] = useState<BonusRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [metric, setMetric] = useState<BonusMetric>('service_production');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('');
  const [techId, setTechId] = useState('');
  const [previewTech, setPreviewTech] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<BonusPreview | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [approveMsg, setApproveMsg] = useState<string | null>(null);
  const [periodReview, setPeriodReview] = useState<PeriodBonusReview | null>(null);

  const load = () => { setError(null); ownerCompensationApi.bonusRules().then(setRules).catch((e) => { setRules([]); setError(e?.message || 'Failed to load bonus rules'); }); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!target.trim() || !amount.trim()) { setError('Enter a target and amount'); return; }
    setBusy(true); setError(null);
    const body = { label: label.trim() || undefined, metric, target: isMoney(metric) ? Math.round(Number(target) * 100) : Number(target), amountCents: Math.round(Number(amount) * 100), technicianId: techId.trim() || undefined };
    try { await ownerCompensationApi.createBonusRule(body); setLabel(''); setTarget(''); setAmount(''); setTechId(''); load(); }
    catch (e: any) { setError(e?.message || 'Could not create the rule'); }
    finally { setBusy(false); }
  };

  const archive = async (id: string) => { setBusy(true); setError(null); try { await ownerCompensationApi.archiveBonusRule(id); load(); } catch (e: any) { setError(e?.message || 'Archive failed'); } finally { setBusy(false); } };

  const runPreview = async () => {
    if (!previewTech.trim() || !from || !to) { setError('Enter a technician and date range for the preview'); return; }
    setError(null);
    try { setPreview(await ownerCompensationApi.previewBonuses({ technicianId: previewTech.trim(), fromIso: from, toIso: to })); setApproveMsg(null); }
    catch (e: any) { setError(e?.message || 'Preview failed'); }
  };

  const approve = async (b: EarnedBonus) => {
    if (!preview) return;
    if (!periodId.trim()) { setError('Enter a payroll period ID to approve the bonus into'); return; }
    setBusy(true); setError(null); setApproveMsg(null);
    try { await ownerCompensationApi.approveBonus({ technicianId: preview.technicianId, periodId: periodId.trim(), amountCents: b.earnedCents, label: b.label }); setApproveMsg(`Approved ${b.label} (${money(b.earnedCents)}) into the period.`); }
    catch (e: any) { setError(e?.message || 'Approve failed'); }
    finally { setBusy(false); }
  };

  const reviewPeriod = async () => {
    if (!periodId.trim()) { setError('Enter a payroll period ID'); return; }
    setError(null); setApproveMsg(null);
    try { setPeriodReview(await ownerCompensationApi.bonusPeriodReview(periodId.trim())); }
    catch (e: any) { setError(e?.message || 'Period review failed'); setPeriodReview(null); }
  };
  const approvePeriodBonus = async (technicianId: string, b: EarnedBonus) => {
    setBusy(true); setError(null); setApproveMsg(null);
    try { await ownerCompensationApi.approveBonus({ technicianId, periodId: periodId.trim(), amountCents: b.earnedCents, label: b.label }); setApproveMsg(`Approved ${b.label} (${money(b.earnedCents)}) for ${technicianId}.`); }
    catch (e: any) { setError(e?.message || 'Approve failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="owner-chartcard">
      <div className="head"><div className="t">Bonus Rules</div>{busy ? <div className="u">Working…</div> : null}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Reward a technician for reaching a target. Bonuses are a recommendation — they're surfaced for review and require approval before payout, never paid automatically.</div>

      {error ? <div role="alert" style={{ fontSize: 13, color: 'var(--owner-danger)', marginBottom: 8 }}>{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', gridColumn: 'span 2' }}>
          <span>Label</span>
          <input aria-label="Bonus label" value={label} onChange={(e) => setLabel(e.target.value)} className="owner-input" placeholder="e.g. Production bonus" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Metric</span>
          <select aria-label="Bonus metric" value={metric} onChange={(e) => setMetric(e.target.value as BonusMetric)} className="owner-input">
            {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Target {isMoney(metric) ? '($)' : ''}</span>
          <input aria-label="Bonus target" value={target} onChange={(e) => setTarget(e.target.value)} className="owner-input" inputMode="decimal" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Bonus ($)</span>
          <input aria-label="Bonus amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="owner-input" inputMode="decimal" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Technician ID</span>
          <input aria-label="Bonus technician" value={techId} onChange={(e) => setTechId(e.target.value)} className="owner-input" placeholder="blank = all" />
        </label>
        <button
          className="owner-btn"
          disabled={busy}
          onClick={create}
          style={{
            gridColumn: '1 / -1',
            minHeight: 46,
            height: 46,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 10,
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Add rule
        </button>
      </div>

      {rules === null ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
        : rules.length === 0 ? <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>No bonus rules yet.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {rules.map((r) => (
              <div key={r.id} style={{ border: '1px solid var(--owner-border, #eee)', borderRadius: 8, padding: 10, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--owner-surface)' }}>
                <span><b>{r.label || r.metric}</b> — {r.metric} ≥ {fmt(r.metric, r.target)} → {money(r.amountCents)}{r.technicianId ? ' (one tech)' : ' (all)'}</span>
                <button className="owner-btn ghost" disabled={busy} onClick={() => archive(r.id)} style={{ minHeight: 32, height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8 }}>Archive</button>
              </div>
            ))}
          </div>}

      <div className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 6, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>Preview earned bonuses for a technician over a period:</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', gridColumn: 'span 2' }}>
          <span>Technician ID</span>
          <input aria-label="Preview technician" value={previewTech} onChange={(e) => setPreviewTech(e.target.value)} className="owner-input" placeholder="technician id" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>From</span>
          <input aria-label="Preview from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="owner-input" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>To</span>
          <input aria-label="Preview to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="owner-input" />
        </label>
        <button className="owner-btn ghost" onClick={runPreview} style={{ gridColumn: '1 / -1', minHeight: 44, height: 44, padding: '0 18px', fontSize: 14, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Preview</button>
      </div>

      {preview ? (
        <div style={{ fontSize: 12.5, marginTop: 8, padding: 10, border: '1px solid var(--owner-border, #eee)', borderRadius: 8, background: 'var(--owner-surface)' }}>
          {preview.bonuses.some((b) => b.qualified) ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', flex: 1 }}>
                <span>Approve into payroll period ID</span>
                <input aria-label="Approve period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="owner-input" />
              </label>
            </div>
          ) : null}
          {preview.bonuses.length === 0 ? <div className="muted">No rules apply to this technician.</div> : preview.bonuses.map((b, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span>{b.qualified ? '✓' : '·'} {b.label}: {fmt(b.metric, b.metricValue)} of {fmt(b.metric, b.target)} → <b>{b.qualified ? money(b.earnedCents) : 'not met'}</b></span>
              {b.qualified ? <button className="owner-btn ghost" disabled={busy} onClick={() => approve(b)} style={{ minHeight: 32, height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8 }}>Approve</button> : null}
            </div>
          ))}
          <div style={{ marginTop: 6, fontWeight: 600 }}>Total earned (pending approval): {money(preview.totalEarnedCents)}</div>
          {approveMsg ? <div role="status" style={{ fontSize: 12, color: 'var(--owner-success)', marginTop: 4 }}>{approveMsg}</div> : null}
        </div>
      ) : null}

      <div className="muted" style={{ fontSize: 12, margin: '14px 0 6px', fontWeight: 600, color: 'var(--owner-text-secondary)' }}>Review qualified bonuses across a whole built payroll period:</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 180px', fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Payroll period ID</span>
          <input aria-label="Bonus period review id" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="owner-input" />
        </label>
        <button className="owner-btn ghost" onClick={reviewPeriod} style={{ minHeight: 44, height: 44, padding: '0 18px', fontSize: 14, borderRadius: 10 }}>Review period bonuses</button>
      </div>
      {periodReview ? (
        periodReview.technicians.length === 0 ? <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>No qualified bonuses in this period.</div>
          : <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
            {periodReview.technicians.map((t) => (
              <div key={t.technicianId} style={{ border: '1px solid var(--owner-border, #eee)', borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: 600 }}>Tech {t.technicianId} — {money(t.totalEarnedCents)}</div>
                {t.bonuses.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span>{b.label}: {fmt(b.metric, b.metricValue)} of {fmt(b.metric, b.target)} → <b>{money(b.earnedCents)}</b></span>
                    <button className="owner-btn ghost" disabled={busy} onClick={() => approvePeriodBonus(t.technicianId, b)}>Approve</button>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ fontWeight: 600 }}>Period total (pending approval): {money(periodReview.grandTotalCents)}</div>
            {approveMsg ? <div role="status" style={{ fontSize: 12, color: 'var(--owner-success)' }}>{approveMsg}</div> : null}
          </div>
      ) : null}
    </div>
  );
}
