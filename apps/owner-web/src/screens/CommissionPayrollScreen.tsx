import { useEffect, useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { CommissionRulesPanel } from './CommissionRulesPanel';
import { TierPlansPanel } from './TierPlansPanel';
import { RetailCommissionCard } from './RetailCommissionCard';
import { BonusRulesPanel } from './BonusRulesPanel';
import { CompliancePanel } from './CompliancePanel';
import { AgreementsPanel } from './AgreementsPanel';
import { ownerPayrollApi, ownerCompensationApi, type OwnerPayrollListResp, type OwnerPayrollPeriodDetailResp, type OwnerPayrollPeriodSummary, type TipSplitMethod } from '../api/ownerApi';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// Commission & Payroll — Module 13 (read surface). Surfaces the canonical compensation/payroll engine's stored periods
// + per-technician payout lines (already computed; never recalculated here), scoped to the owner's allowed branches.
// Read-only in this pass: approve / reject / lock (with fresh authentication) are a separate, deliberately-isolated unit.

const money = (c: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((c || 0) / 100);
const statusColor = (s: string): string => s === 'paid' ? 'var(--owner-success)' : s === 'finalized' ? 'var(--owner-primary)' : 'var(--owner-text-muted)';
const statusLabel = (s: string): string => s === 'paid' ? 'Paid' : s === 'finalized' ? 'Finalized' : 'Draft';

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
    { m: 'proportional', label: 'Proportional (default)', desc: 'By each technician’s share of the service revenue on the ticket.' },
    { m: 'equal', label: 'Equal', desc: 'Split evenly among all technicians on the ticket.' },
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
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ownerPayrollApi.list()
      .then((d) => { if (!alive) return; setList(d); const target = targetPeriodId && d.periods.some((p) => p.periodId === targetPeriodId) ? targetPeriodId : (d.periods[0]?.periodId ?? null); setSelectedId(target); setLoading(false); })
      .catch((e: any) => { if (!alive) return; setError(e?.message || 'Could not load payroll.'); setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true); setExpanded(null); setPendingAction(null); setPin(''); setActionError(null); setActionNote(null);
    ownerPayrollApi.period(selectedId)
      .then((d) => { if (!alive) return; setDetail(d); setDetailLoading(false); })
      .catch(() => { if (!alive) return; setDetail(null); setDetailLoading(false); });
    return () => { alive = false; };
  }, [selectedId]);

  const startAction = (kind: 'approve' | 'lock' | 'reopen') => { setPendingAction(kind); setPin(''); setActionError(null); setActionNote(null); };
  const submitAction = async () => {
    if (!selectedId || !pendingAction) return;
    setActionBusy(true); setActionError(null);
    try {
      const fn = pendingAction === 'approve' ? ownerPayrollApi.approve : pendingAction === 'lock' ? ownerPayrollApi.lock : ownerPayrollApi.reopen;
      await fn(selectedId, pin);
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
          <div
            style={{
              background: 'var(--owner-surface, #FFFFFF)',
              border: '1px solid var(--owner-border, #E6DAC8)',
              borderRadius: 16,
              padding: '12px 14px',
              boxShadow: 'var(--owner-shadow, 0 1px 3px rgba(0,0,0,0.04))',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
              <div className="owner-skel" style={{ width: 140, height: 32, borderRadius: 20, flexShrink: 0 }} />
              <div className="owner-skel" style={{ width: 140, height: 32, borderRadius: 20, flexShrink: 0 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--owner-border, #F0EAE1)' }}>
              <div className="owner-skel" style={{ width: 180, height: 16 }} />
              <div className="owner-skel" style={{ width: 60, height: 22, borderRadius: 6 }} />
            </div>
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
          {/* period selector card */}
          <div
            style={{
              background: 'var(--owner-surface, #FFFFFF)',
              border: '1px solid var(--owner-border, #E6DAC8)',
              borderRadius: 16,
              padding: '12px 14px',
              boxShadow: 'var(--owner-shadow, 0 1px 3px rgba(0,0,0,0.04))',
              marginBottom: 12,
            }}
          >
            <div
              className="owner-tabs"
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                padding: '2px 2px 8px',
                margin: 0,
                background: 'transparent',
                border: 'none',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {periods.map((p) => {
                const active = selectedId === p.periodId;
                return (
                  <button
                    key={p.periodId}
                    className={`owner-tab ${active ? 'active' : ''}`}
                    onClick={() => setSelectedId(p.periodId)}
                    style={{
                      flexShrink: 0,
                      appearance: 'none',
                      border: active ? '1px solid var(--owner-primary, #B8860B)' : '1px solid var(--owner-border, #E6DAC8)',
                      background: active
                        ? 'linear-gradient(135deg, var(--owner-primary, #B8860B), var(--owner-primary-dark, #8B6508))'
                        : 'var(--owner-panel, #FBF8F3)',
                      color: active ? '#FFFFFF' : 'var(--owner-text-secondary, #6B5E51)',
                      borderRadius: 20,
                      padding: '7px 15px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: active ? '0 2px 6px rgba(184, 134, 11, 0.25)' : 'none',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.label || `${p.periodStart} – ${p.periodEnd}`}
                  </button>
                );
              })}
            </div>

            {selected && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 8,
                  marginTop: 4,
                  borderTop: '1px solid var(--owner-border, #F0EAE1)',
                }}
              >
                <div className="owner-text-muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
                  Pay Period · {selected.periodStart} – {selected.periodEnd}
                  {selected.label ? <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--owner-text-muted)' }}>({selected.label})</span> : null}
                </div>
                <span
                  className="owner-pill"
                  style={{
                    background: 'transparent',
                    color: statusColor(selected.status),
                    border: `1.5px solid ${statusColor(selected.status)}`,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 6,
                  }}
                >
                  {statusLabel(selected.status)}
                </span>
              </div>
            )}
          </div>

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
          ) : detail && detail.lines.length === 0 ? (
            <div
              className="owner-state"
              style={{
                minHeight: 180,
                padding: '36px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'var(--owner-surface, #FFFFFF)',
                border: '1px solid var(--owner-border, #E6DAC8)',
                borderRadius: 16,
                boxShadow: 'var(--owner-shadow, 0 1px 3px rgba(0,0,0,0.04))',
                margin: '8px 0 16px',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                  border: '1px solid #DBCAB0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  marginBottom: 10,
                }}
              >
                💼
              </div>
              <div style={{ fontSize: 14, color: 'var(--owner-text-muted)' }}>
                No technician payouts in this period.
              </div>
            </div>
          )
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

          {/* actions — sensitive payroll state changes require the owner's PIN (fresh authentication) */}
          {selected && (
            <div style={{ marginTop: 16 }}>
              {actionNote && <div className="owner-state" style={{ color: 'var(--owner-success)', fontWeight: 700 }}>{actionNote}</div>}

              {selected.status === 'paid' ? (
                <div className="owner-text-muted" style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'center', padding: '8px 0' }}>This pay period is locked and paid. It can no longer be edited.</div>
              ) : pendingAction ? (
                <div className="owner-chartcard">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{pendingAction === 'approve' ? 'Approve payroll' : pendingAction === 'lock' ? 'Lock & mark paid' : 'Reopen to draft'}</div>
                  <div className="owner-text-muted" style={{ fontSize: 12, marginBottom: 10 }}>Enter your security PIN to confirm. {pendingAction === 'lock' ? 'Once paid, this period is locked permanently.' : ''}</div>
                  <input className="owner-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Security PIN" aria-label="Security PIN" style={{ width: '100%', marginBottom: 8 }} onKeyDown={(e) => { if (e.key === 'Enter' && pin && !actionBusy) submitAction(); }} />
                  {actionError && <div className="owner-state" role="alert" style={{ color: 'var(--owner-danger)', padding: '6px 0' }}>{actionError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="owner-btn" disabled={actionBusy || !pin} onClick={submitAction} style={{ flex: 1, opacity: actionBusy || !pin ? 0.6 : 1 }}>{actionBusy ? 'Working…' : 'Confirm'}</button>
                    <button className="owner-tab" disabled={actionBusy} onClick={() => { setPendingAction(null); setPin(''); setActionError(null); }} style={{ flex: 1 }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  {selected.status === 'draft' && <button className="owner-btn" onClick={() => startAction('approve')} style={{ flex: 1 }}>Approve Payroll</button>}
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
