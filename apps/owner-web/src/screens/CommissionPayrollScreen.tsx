import { useEffect, useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { CommissionRulesPanel } from './CommissionRulesPanel';
import { TierPlansPanel } from './TierPlansPanel';
import { RetailCommissionCard } from './RetailCommissionCard';
import { BonusRulesPanel } from './BonusRulesPanel';
import { CompliancePanel } from './CompliancePanel';
import { AgreementsPanel } from './AgreementsPanel';
import { ownerPayrollApi, ownerCompensationApi, type OwnerPayrollListResp, type OwnerPayrollPeriodDetailResp, type OwnerPayrollPeriodSummary, type TipSplitMethod } from '../api/ownerApi';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';
import { OwnerPaycheckPanel } from './OwnerPaycheckPanel';
import type { PaycheckWeek } from '@aipowersalon/api-contracts/tenant';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Commission & Payroll — Module 13 (read surface). Surfaces the canonical compensation/payroll engine's stored periods
// + per-technician payout lines (already computed; never recalculated here), scoped to the owner's allowed branches.
// Read-only in this pass: approve / reject / lock (with fresh authentication) are a separate, deliberately-isolated unit.

const money = (c: number): string => formatCurrency(c, { fractionDigits: 2 });
const statusColor = (s: string): string => s === 'paid' ? 'var(--owner-success)' : s === 'finalized' ? 'var(--owner-primary)' : s === 'review' ? 'var(--owner-warning, #a96f22)' : 'var(--owner-text-muted)';
// Payroll wave 2: 'review' = prepared on the POS (lines frozen, validated) and ready for the owner's approval
const statusLabel = (s: string): string => s === 'paid' ? 'Paid' : s === 'finalized' ? 'Approved' : s === 'review' ? 'Ready to approve' : 'Draft';

// Salon tip-split policy for 3+ technicians (spec §11). Self-contained: own GET on mount, PUT on change. Shows an
// honest error (with Retry) rather than a fabricated default — this is a real compensation setting the owner is
// changing, so it must never silently show the wrong policy. Reverts the selection if the save fails.
function TipSplitPolicyCard() {
  const [method, setMethod] = useState<TipSplitMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    setLoading(true); setError(null);
    ownerCompensationApi.tipPolicy()
      .then((r) => setMethod(r.manyTechTipMethod))
      .catch((e: any) => setError(e?.message || 'Could not load the tip-split policy.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const choose = (m: TipSplitMethod) => {
    if (m === method || saving) return;
    const prev = method;
    setMethod(m); setSaving(true); setSaved(false); setError(null);
    ownerCompensationApi.setTipPolicy(m)
      .then((r) => { setMethod(r.manyTechTipMethod); setSaved(true); })
      .catch((e: any) => { setMethod(prev); setError(e?.message || 'Could not save the policy.'); })
      .finally(() => setSaving(false));
  };

  const options: { m: TipSplitMethod; label: string; desc: string }[] = [
    // Kevin, Nov 13 2026: equal ("same three way split", exact cents) is the default; proportional is the salon's choice.
    { m: 'equal', label: 'Equal (default)', desc: 'Split evenly among all technicians on the ticket, to the cent.' },
    { m: 'proportional', label: 'Proportional', desc: 'By each technician’s share of the service revenue on the ticket.' },
  ];

  return (
    <div className="owner-chartcard">
      <div className="head">
        <div className="t">Tip Split — 3+ Technicians</div>
        {saving ? <div className="u">Saving…</div> : saved ? <div className="u" style={{ color: 'var(--owner-success)' }}>Saved</div> : null}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>How a combined tip is divided when three or more technicians work one ticket. (Two-technician tickets always split 50/50; an explicit or customer-directed tip always wins.)</div>
      {loading ? (
        <div className="muted" style={{ fontSize: 13, padding: '4px 0' }}>Loading…</div>
      ) : error && method === null ? (
        <div role="alert" style={{ fontSize: 13, color: 'var(--owner-danger)' }}>{error}{' '}<button className="owner-btn ghost" onClick={load} style={{ marginLeft: 6 }}>Retry</button></div>
      ) : (
        <>
          {options.map((o) => {
            const active = method === o.m;
            return (
              <button key={o.m} onClick={() => choose(o.m)} disabled={saving} aria-pressed={active} aria-label={o.label}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 8, borderRadius: 10, cursor: saving ? 'default' : 'pointer', border: `1.5px solid ${active ? 'var(--owner-primary)' : 'var(--owner-border)'}`, background: active ? 'rgba(169,111,34,0.06)' : '#fff' }}>
                <span aria-hidden style={{ marginTop: 2, minWidth: 16, height: 16, borderRadius: 8, border: `1.5px solid ${active ? 'var(--owner-primary)' : 'var(--owner-text-muted)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{active ? <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--owner-primary)' }} /> : null}</span>
                <span>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--owner-text)' }}>{o.label}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 1 }}>{o.desc}</span>
                </span>
              </button>
            );
          })}
          {error && method !== null ? <div role="alert" style={{ fontSize: 12.5, color: 'var(--owner-danger)', marginTop: 2 }}>{error}</div> : null}
        </>
      )}
    </div>
  );
}

export function CommissionPayrollScreen() {
  const { back, pushed } = useOwnerNav();
  const targetPeriodId = pushed?.kind === 'payroll' ? pushed.periodId : undefined;
  const [list, setList] = useState<OwnerPayrollListResp | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OwnerPayrollPeriodDetailResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'approve' | 'lock' | 'reopen' | null>(null);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  // Weekly Paycheck (Oct 21 2026): a week paid through pay statements is approved / returned / rejected in its own panel
  const [paycheck, setPaycheck] = useState<PaycheckWeek | null>(null);

  useEffect(() => {
    let alive = true;
    ownerPayrollApi.list()
      .then((d) => { if (!alive) return; setList(d); const target = targetPeriodId && d.periods.some((p) => p.periodId === targetPeriodId) ? targetPeriodId : (d.periods[0]?.periodId ?? null); setSelectedId(target); setLoading(false); })
      .catch((e: any) => { if (!alive) return; setError(e?.message || 'Could not load payroll.'); setLoading(false); });
    return () => { alive = false; };
  }, [targetPeriodId]);   // §39: a payroll push for another period re-selects it (the list was read once and the push ignored)

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true); setExpanded(null); setPendingAction(null); setPin(''); setActionError(null); setActionNote(null);
    ownerPayrollApi.period(selectedId)
      .then((d) => { if (!alive) return; setDetail(d); setDetailLoading(false); })
      .catch(() => { if (!alive) return; setDetail(null); setDetailLoading(false); });
    setPaycheck(null);
    Promise.resolve().then(() => ownerPayrollApi.paycheckWeek(selectedId))
      .then((w) => { if (alive) setPaycheck(w.statements.length ? w : null); })
      .catch(() => { if (alive) setPaycheck(null); });   // no paycheck statements (or no access): the period view below stands
    return () => { alive = false; };
  }, [selectedId]);

  const startAction = (kind: 'approve' | 'lock' | 'reopen') => { setPendingAction(kind); setPin(''); setReason(''); setActionError(null); setActionNote(null); };
  const submitAction = async () => {
    if (!selectedId || !pendingAction) return;
    setActionBusy(true); setActionError(null);
    try {
      if (pendingAction === 'reopen' && reason.trim().length < 3) { setActionError('Say why this approved period is being reopened.'); setActionBusy(false); return; }
      if (pendingAction === 'approve') await ownerPayrollApi.approve(selectedId, pin);
      else if (pendingAction === 'lock') await ownerPayrollApi.lock(selectedId, pin);
      else await ownerPayrollApi.reopen(selectedId, pin, reason.trim());
      const [fresh, d] = await Promise.all([ownerPayrollApi.list(), ownerPayrollApi.period(selectedId)]);
      setList(fresh); setDetail(d);
      setActionNote(pendingAction === 'approve' ? 'Payroll approved.' : pendingAction === 'lock' ? 'Payroll locked & marked paid.' : 'Payroll reopened to draft.');
      setPendingAction(null); setPin('');
    } catch (e: any) {
      setActionError(e?.message || 'That action could not be completed.');
    } finally {
      setActionBusy(false);
    }
  };

  const periods = list?.periods ?? [];
  const t = detail?.totals;
  const selected: OwnerPayrollPeriodSummary | undefined = periods.find((p) => p.periodId === selectedId);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Commission &amp; Payroll</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '10px 16px 0' }}><TipSplitPolicyCard /></div>

      <div style={{ padding: '10px 16px 0' }}><CommissionRulesPanel /></div>

      <div style={{ padding: '10px 16px 0' }}><TierPlansPanel /></div>

      <div style={{ padding: '10px 16px 0' }}><RetailCommissionCard /></div>

      <div style={{ padding: '10px 16px 16px' }}><BonusRulesPanel /></div>

      <div style={{ padding: '0 16px 16px' }}><CompliancePanel /></div>

      <div style={{ padding: '0 16px 16px' }}><AgreementsPanel /></div>

      {error ? (
        <div className="owner-state" role="alert">{error}</div>
      ) : loading && periods.length === 0 ? (
        <div style={{ padding: '0 16px 24px' }}>
          <div className="owner-tabs" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
            <div className="owner-skel" style={{ width: 120, height: 32, borderRadius: 16, display: 'inline-block', marginRight: 8 }} />
            <div className="owner-skel" style={{ width: 120, height: 32, borderRadius: 16, display: 'inline-block' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 2px 12px' }}>
            <div className="owner-skel" style={{ width: 180, height: 16 }} />
            <div className="owner-skel" style={{ width: 80, height: 24, borderRadius: 12 }} />
          </div>
          <div className="owner-kpigrid" style={{ marginBottom: 6 }}>
            <div className="owner-kpi"><div className="label">Total Payroll</div><div className="val"><div className="owner-skel" style={{ width: 80, height: 24, marginTop: 4 }} /></div></div>
            <div className="owner-kpi"><div className="label">Commissions</div><div className="val"><div className="owner-skel" style={{ width: 80, height: 24, marginTop: 4 }} /></div></div>
          </div>
          <div className="owner-kpigrid three" style={{ marginBottom: 12 }}>
            <div className="owner-kpi"><div className="label">Salary Guarantees</div><div className="val"><div className="owner-skel" style={{ width: 40, height: 24, marginTop: 4 }} /></div></div>
            <div className="owner-kpi"><div className="label">Retail Comm.</div><div className="val"><div className="owner-skel" style={{ width: 40, height: 24, marginTop: 4 }} /></div></div>
            <div className="owner-kpi"><div className="label">Tips → Techs</div><div className="val"><div className="owner-skel" style={{ width: 40, height: 24, marginTop: 4 }} /></div></div>
          </div>
          <div className="owner-text-muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '0 2px 14px' }}>
            Tips are paid 100% to technicians and are never split with the salon. Tax is tracked separately and is not part of technician commission.
          </div>
          <div className="owner-sechead"><div className="h">Payout Preview</div></div>
          <div className="owner-drill">
            <OwnerSkeletonList count={3} />
          </div>
        </div>
      ) : periods.length === 0 ? (
        <div className="owner-state">No payroll periods yet.</div>
      ) : (
        <div style={{ padding: '0 16px 24px' }}>
          {/* period selector */}
          <div className="owner-tabs" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
            {periods.map((p) => (
              <button key={p.periodId} className={`owner-tab ${selectedId === p.periodId ? 'active' : ''}`} onClick={() => setSelectedId(p.periodId)}>
                {p.label || `${p.periodStart} – ${p.periodEnd}`}
              </button>
            ))}
          </div>

          {selected && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 2px 12px' }}>
              <div className="owner-text-muted" style={{ fontSize: 12.5, fontWeight: 700 }}>Pay Period · {selected.periodStart} – {selected.periodEnd}</div>
              <span className="owner-pill" style={{ background: 'transparent', color: statusColor(selected.status), border: `1px solid ${statusColor(selected.status)}` }}>{statusLabel(selected.status)}</span>
            </div>
          )}

          {/* summary cards */}
          <div className="owner-kpigrid" style={{ marginBottom: 6 }}>
            <div className="owner-kpi"><div className="label">Total Payroll</div><div className="val">{detailLoading ? <div className="owner-skel" style={{ width: 80, height: 24 }} /> : selected ? money(selected.totalPayableCents) : '—'}</div></div>
            <div className="owner-kpi"><div className="label">Commissions</div><div className="val">{detailLoading ? <div className="owner-skel" style={{ width: 80, height: 24 }} /> : t ? money(t.commissionCents) : '—'}</div></div>
          </div>
          <div className="owner-kpigrid three" style={{ marginBottom: 12 }}>
            <div className="owner-kpi"><div className="label">Salary Guarantees</div><div className="val">{detailLoading ? <div className="owner-skel" style={{ width: 40, height: 24 }} /> : t ? money(t.guaranteeTopupCents) : '—'}</div></div>
            <div className="owner-kpi"><div className="label">Retail Comm.</div><div className="val">{detailLoading ? <div className="owner-skel" style={{ width: 40, height: 24 }} /> : t ? money(t.retailCommissionCents) : '—'}</div></div>
            <div className="owner-kpi"><div className="label">Tips → Techs</div><div className="val">{detailLoading ? <div className="owner-skel" style={{ width: 40, height: 24 }} /> : t ? money(t.tipsCents) : '—'}</div></div>
          </div>

          <div className="owner-text-muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '0 2px 14px' }}>
            Tips are paid 100% to technicians and are never split with the salon. Tax is tracked separately and is not part of technician commission.
          </div>

          {/* payout preview */}
          <div className="owner-sechead"><div className="h">Payout Preview</div><div className="d">{t ? `${t.technicianCount} technician${t.technicianCount === 1 ? '' : 's'}` : ''}</div></div>
          {detailLoading && !detail ? (
            <div className="owner-drill">
              <OwnerSkeletonList count={3} />
            </div>
          ) : detail && detail.lines.length === 0 ? <div className="owner-state">No technician payouts in this period.</div>
            : (
              <div className="owner-drill">
                {(detail?.lines ?? []).map((l) => {
                  const open = expanded === l.technicianId;
                  return (
                    <div key={l.technicianId}>
                      <button className="owner-drillrow" style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }} aria-expanded={open} onClick={() => setExpanded(open ? null : l.technicianId)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700 }}>{l.technicianName || 'Technician'}</div>
                          <div className="owner-text-muted" style={{ fontSize: 12 }}>{l.servicesCount} service{l.servicesCount === 1 ? '' : 's'} · {money(l.grossSalesCents)} sales</div>
                        </div>
                        <div style={{ fontWeight: 700, marginLeft: 10 }}>{money(l.payableCents)}</div>
                      </button>
                      {open && (
                        <div className="owner-settingspanel" style={{ margin: '0 0 8px' }}>
                          <div><div className="k">Commission</div><div className="v">{l.commissionType === 'percent' ? `${l.commissionValue}% · ${money(l.commissionCents)}` : money(l.commissionCents)}</div></div>
                          <div><div className="k">Retail Commission</div><div className="v">{money(l.retailCommissionCents)}</div></div>
                          <div><div className="k">Card Tips</div><div className="v">{money(l.cardTipCents)}</div></div>
                          <div><div className="k">Cash Tips</div><div className="v">{money(l.cashTipCents)}</div></div>
                          <div><div className="k">Guarantee Top-Up</div><div className="v">{money(l.guaranteeTopupCents)}</div></div>
                          <div><div className="k">Adjustments</div><div className="v">{money(l.adjustmentCents)}</div></div>
                          <div><div className="k" style={{ fontWeight: 700 }}>Total Payout</div><div className="v" style={{ fontWeight: 700 }}>{money(l.payableCents)}</div></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          {paycheck ? <OwnerPaycheckPanel week={paycheck} onChanged={(w) => { setPaycheck(w); ownerPayrollApi.list().then(setList).catch(() => undefined); }} /> : null}

          {/* actions — sensitive payroll state changes require the owner's PIN (fresh authentication); a week paid
              through pay statements is decided in the panel above and paid out check by check / envelope by envelope */}
          {selected && !paycheck && (
            <div style={{ marginTop: 16 }}>
              {actionNote && <div className="owner-state" style={{ color: 'var(--owner-success)', fontWeight: 700 }}>{actionNote}</div>}

              {selected.status === 'paid' ? (
                <div className="owner-text-muted" style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'center', padding: '8px 0' }}>This pay period is locked and paid. It can no longer be edited.</div>
              ) : pendingAction ? (
                <div className="owner-chartcard">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{pendingAction === 'approve' ? 'Approve payroll' : pendingAction === 'lock' ? 'Lock & mark paid' : 'Reopen to draft'}</div>
                  <div className="owner-text-muted" style={{ fontSize: 12, marginBottom: 10 }}>Enter your security PIN to confirm. {pendingAction === 'lock' ? 'Once paid, this period is locked permanently.' : ''}</div>
                  {pendingAction === 'reopen' && <textarea className="owner-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this approved period being reopened?" aria-label="Reopen reason" rows={2} style={{ width: '100%', marginBottom: 8 }} />}
                  <input className="owner-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Security PIN" aria-label="Security PIN" style={{ width: '100%', marginBottom: 8 }} onKeyDown={(e) => { if (e.key === 'Enter' && pin && !actionBusy) submitAction(); }} />
                  {actionError && <div className="owner-state" role="alert" style={{ color: 'var(--owner-danger)', padding: '6px 0' }}>{actionError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="owner-btn" disabled={actionBusy || !pin} onClick={submitAction} style={{ flex: 1, opacity: actionBusy || !pin ? 0.6 : 1 }}>{actionBusy ? 'Working…' : 'Confirm'}</button>
                    <button className="owner-tab" disabled={actionBusy} onClick={() => { setPendingAction(null); setPin(''); setActionError(null); }} style={{ flex: 1 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  {(selected.status === 'draft' || (selected.status as string) === 'review') && <button className="owner-btn" onClick={() => startAction('approve')} style={{ flex: 1 }}>Approve Payroll</button>}
                  {selected.status === 'finalized' && <button className="owner-btn" onClick={() => startAction('lock')} style={{ flex: 1 }}>Lock &amp; Pay</button>}
                  {selected.status === 'finalized' && <button className="owner-tab" onClick={() => startAction('reopen')} style={{ flex: 1 }}>Reopen to Draft</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
