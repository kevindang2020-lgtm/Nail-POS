// CustomerInvoicesScreen.tsx — the customer's own invoices in the customer app. Lists sent/paid invoices
// and lets the customer pay an outstanding ('sent') one in-app (skip-line style). Server derives the
// customer + settles the invoice; the client never sends money or a customer id.
import { useCallback, useEffect, useState } from 'react';
import { customerInvoicesApi, type CustomerInvoice, type CustomerInvoicesResponse } from '../api/customerInvoicesApi';

const money = (c?: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso?: string | null) => { if (!iso) return ''; try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; } };
const statusPill = (status: string) => {
  const m: Record<string, { bg: string; fg: string; label: string }> = {
    sent: { bg: '#FBF3E6', fg: '#A96F22', label: 'Due' }, paid: { bg: '#E9F6EC', fg: '#2E9E54', label: 'Paid' },
    draft: { bg: '#F0F0F0', fg: '#777', label: 'Draft' }, void: { bg: '#FDEEEE', fg: '#C0392B', label: 'Void' },
  };
  const s = m[status] || m.draft;
  return <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: s.bg, color: s.fg }}>{s.label}</span>;
};

export function CustomerInvoicesScreen() {
  const [data, setData] = useState<CustomerInvoicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await customerInvoicesApi.list()); }
    catch (e: any) { setError(e?.message || 'Could not load your invoices.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pay = async (inv: CustomerInvoice) => {
    setPaying(inv.id); setNote(null);
    try { await customerInvoicesApi.pay(inv.id); setNote(`Invoice ${inv.invoiceNumber} paid — thank you!`); await load(); }
    catch (e: any) { setNote(e?.message || 'Payment could not be completed.'); }
    finally { setPaying(null); }
  };

  if (error) return <div style={{ padding: 16 }}><div className="err">{error}</div></div>;
  if (!data) return <div style={{ padding: 16 }}><div className="muted">Loading…</div></div>;

  const { invoices, kpis } = data;
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, marginBottom: 4 }}>Invoices</div>
      <div className="muted" style={{ marginBottom: 12 }}>{kpis.outstandingCents > 0 ? `${money(kpis.outstandingCents)} due across ${kpis.sent} invoice${kpis.sent === 1 ? '' : 's'}` : 'You\u2019re all paid up.'}</div>

      {note ? <div className="panel" style={{ marginBottom: 12, color: '#2E9E54', fontWeight: 600 }}>{note}</div> : null}

      <section className="panel">
        {invoices.length === 0 ? <div className="muted">No invoices yet.</div> : (
          <div className="list">
            {invoices.map((inv) => (
              <div className="row" key={inv.id} style={{ alignItems: 'center' }}>
                <div>
                  <div className="t">{inv.invoiceNumber} {statusPill(inv.status)}</div>
                  <div className="s">{inv.dueDate ? `Due ${fmtDate(inv.dueDate)}` : `Issued ${fmtDate(inv.issueDate)}`}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="r" style={{ fontWeight: 700 }}>{money(inv.totalCents)}</div>
                  {inv.status === 'sent' ? (
                    <button className="btn" disabled={paying === inv.id} onClick={() => pay(inv)}
                      style={{ background: '#A96F22', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700 }}>
                      {paying === inv.id ? 'Paying…' : 'Pay'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
