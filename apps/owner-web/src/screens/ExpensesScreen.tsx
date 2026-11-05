import { useEffect, useState } from 'react';
import { parseDollarsToCents } from '../lib/money-input';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { ownerExpensesApi, EXPENSE_CATEGORIES, type OwnerExpense, type OwnerExpenseSummary, type OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector } from '../components/PeriodSelector';
import { useOwnerNav } from '../shell/nav';
import { OwnerSkeletonBlocks } from '../components/OwnerSkeleton';

import { SelectDateModal, type DateRangeResult } from '../components/SelectDateModal';

// ExpensesScreen — record/list/delete operating costs that feed real net profit (revenue − commission − expenses).
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export function ExpensesScreen() {
  const { back } = useOwnerNav();
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const [customRange, setCustomRange] = useState<DateRangeResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [rows, setRows] = useState<OwnerExpense[] | null>(null);
  const [sum, setSum] = useState<OwnerExpenseSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ category: 'supplies', amount: '', incurredOn: todayStr(), vendor: '', description: '' });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { effectiveBranchId } = useOwnerBranch();
  const load = () => {
    setLoading(true); setErr(null);
    const dateParams = customRange ? { startDate: customRange.startDate, endDate: customRange.endDate } : undefined;
    Promise.all([
      ownerExpensesApi.list(period, effectiveBranchId, dateParams),
      ownerExpensesApi.summary(period, effectiveBranchId, dateParams),
    ])
      .then(([l, s]) => { setRows(l); setSum(s); })
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to expenses.' : e?.message || 'Unable to load expenses.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [period, effectiveBranchId, customRange]);

  const submit = () => {
    const cents = parseDollarsToCents(form.amount);              // null on invalid — never a silent $0.00
    if (!form.amount || cents == null || cents < 0) { setFormErr('Enter a valid amount.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.incurredOn)) { setFormErr('Enter a valid date.'); return; }
    setBusy(true); setFormErr(null);
    ownerExpensesApi.create({ category: form.category, amountCents: cents, incurredOn: form.incurredOn, vendor: form.vendor || null, description: form.description || null, branchId: effectiveBranchId ?? null })
      .then(() => { setAdding(false); setForm({ category: 'supplies', amount: '', incurredOn: todayStr(), vendor: '', description: '' }); load(); })
      .catch((e: any) => setFormErr(e?.status === 403 ? 'Only owners can add expenses.' : e?.message || 'Could not save.'))
      .finally(() => setBusy(false));
  };

  const remove = (id: string) => {
    setBusy(true);
    ownerExpensesApi.remove(id).then(() => load()).catch(() => load()).finally(() => setBusy(false));
  };

  return (
    <>
      <header
        className="owner-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 0px 12px',
          background: 'transparent',
          position: 'relative',
        }}
      >
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1
          className="owner-serif"
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--owner-text)',
            cursor: 'default',
            margin: 0,
            textAlign: 'center',
            flex: 1,
            letterSpacing: '-0.3px',
          }}
        >
          Expenses
        </h1>
        <button
          className={`owner-calendar-btn ${customRange ? 'active' : ''}`}
          onClick={() => setModalOpen(true)}
          aria-label="Select Date Range"
          title="Select Date Range"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        </button>
      </header>

      <div style={{ padding: '0 0 4px' }}>
        <PeriodSelector
          value={period}
          onChange={(p) => {
            setCustomRange(null);
            setPeriod(p);
          }}
          options={['today', 'week', 'month']}
          customLabel={customRange?.label}
          onClearCustom={() => {
            setCustomRange(null);
            setPeriod('month');
          }}
          onOpenCalendar={() => setModalOpen(true)}
        />
      </div>

      <button
        className="owner-linkrow"
        aria-label="Add manual"
        onClick={() => { setAdding((v) => !v); setFormErr(null); }}
        style={{ marginBottom: '10px' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--owner-primary)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span style={{ fontWeight: 600 }}>Add manual</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--owner-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={adding ? "M18 15l-6-6-6 6" : "M9 18l6-6-6-6"} />
        </svg>
      </button>

      {adding && (
        <div className="owner-chartcard" style={{ margin: '8px 16px', padding: 14 }}>
          <div className="owner-serif" style={{ fontSize: 15, marginBottom: 10 }}>New expense</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <select className="owner-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
            <input className="owner-input" inputMode="decimal" placeholder="Amount (e.g. 250.00)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className="owner-input" type="date" max={new Date().toISOString().split('T')[0]}  value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} />
            <input className="owner-input" placeholder="Vendor (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            <input className="owner-input" placeholder="Note (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {formErr && <div style={{ color: 'var(--owner-danger)', fontSize: 12.5 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="owner-actbtn" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
              <button className="owner-actbtn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {loading && !sum ? (
        <div style={{ padding: '4px 0px 16px' }}>
          <div className="owner-chartcard" style={{ padding: 14, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="owner-serif" style={{ fontSize: 15 }}>Total</div>
            <div className="owner-skel" style={{ width: 80, height: 26 }} />
          </div>
          <div className="owner-chartcard" style={{ padding: '6px 14px', marginBottom: 10 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--owner-border)' }}>
                <div className="owner-skel" style={{ width: 100, height: 16 }} />
                <div className="owner-skel" style={{ width: 60, height: 16 }} />
              </div>
            ))}
          </div>
          <OwnerSkeletonBlocks count={2} />
        </div>
      ) : err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-actbtn primary" onClick={() => load()}>Retry</button></div>
      ) : sum ? (
        <div style={{ padding: '4px 0px 16px' }}>
          <div className="owner-chartcard" style={{ padding: 14, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="owner-serif" style={{ fontSize: 15 }}>Total</div>
            <div className="owner-serif" style={{ fontSize: 22, color: 'var(--owner-primary)' }}>{money(sum.totalCents)}</div>
          </div>
          {sum.byCategory.length > 0 && (
            <div className="owner-chartcard" style={{ padding: '6px 14px', marginBottom: 10 }}>
              {sum.byCategory.map((c) => (
                <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--owner-border)' }}>
                  <span style={{ textTransform: 'capitalize' }}>{c.category}<span className="muted" style={{ fontSize: 11.5 }}> · {c.count}</span></span>
                  <span>{money(c.amountCents)}</span>
                </div>
              ))}
            </div>
          )}

          {rows && rows.length === 0 && (
            <div className="owner-state card" role="status">
              <div className="icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5 3-1.5 3 1.5V8z" />
                  <path d="M14 2v6h6" />
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="13" y2="17" />
                </svg>
              </div>
              <div className="big owner-serif">No expenses</div>
              <div className="muted" style={{ marginBottom: 16 }}>Tap + to record one.</div>
              <button
                className="owner-actbtn primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 12,
                  cursor: 'pointer',
                }}
                onClick={() => { setAdding(true); setFormErr(null); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Add Expense</span>
              </button>
            </div>
          )}
          {rows && rows.map((e) => (
            <div key={e.id} className="owner-chartcard" style={{ padding: '10px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{e.category} <span style={{ fontWeight: 400 }}>{money(e.amountCents)}</span></div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{e.incurredOn}{e.vendor ? ` · ${e.vendor}` : ''}{e.description ? ` · ${e.description}` : ''}</div>
              </div>
              <button className="owner-trash" aria-label="Delete" onClick={() => remove(e.id)} disabled={busy}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--owner-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 002 2h6a2 2 0 002-2V6" /></svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <SelectDateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        activeType={customRange ? customRange.type : period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month'}
        initialFrom={customRange?.customFrom}
        initialTo={customRange?.customTo}
        onSelect={(range) => {
          if (range.type === 'Today') {
            setPeriod('today');
            setCustomRange(null);
          } else if (range.type === 'This Week') {
            setPeriod('week');
            setCustomRange(null);
          } else if (range.type === 'This Month') {
            setPeriod('month');
            setCustomRange(null);
          } else {
            setCustomRange(range);
          }
        }}
      />
    </>
  );
}
