import { useCallback, useEffect, useState } from 'react';
import {
  technicianInventoryApi,
  type TechInvProduct,
  type TechInvReport,
  type TechReportType,
  type SubmitReportInput,
} from '../api/technicianInventoryApi';
import { useTechNav } from '../shell/nav';

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

type ReportOption = {
  label: string;
  code: TechReportType;
  emoji: string;
  bg: string;
  percent?: number;
  lowFlow?: boolean;
  notePrefill?: string;
};

const OPTIONS: ReportOption[] = [
  { label: 'Getting Low', code: 'bottle_low', emoji: '🟠', bg: 'rgba(245, 158, 11, 0.12)', lowFlow: true },
  { label: 'Almost Empty', code: 'bottle_low', emoji: '🟡', bg: 'rgba(234, 179, 8, 0.12)', percent: 10, lowFlow: true },
  { label: 'Empty', code: 'bottle_empty', emoji: '⚪', bg: 'rgba(156, 163, 175, 0.15)' },
  { label: 'Damaged', code: 'damaged', emoji: '⚠️', bg: 'rgba(239, 68, 68, 0.12)' },
  { label: 'Missing', code: 'missing', emoji: '❓', bg: 'rgba(99, 102, 241, 0.12)' },
  { label: 'Expired', code: 'expired', emoji: '⏰', bg: 'rgba(217, 119, 6, 0.12)' },
  { label: 'Wrong Product', code: 'other', emoji: '🔁', bg: 'rgba(14, 165, 233, 0.12)', notePrefill: 'Wrong product' },
  { label: 'Needs Replacement', code: 'need_reorder', emoji: '🔄', bg: 'rgba(16, 185, 129, 0.12)' },
  { label: 'Other Issue', code: 'other', emoji: '✏️', bg: 'rgba(168, 85, 247, 0.12)' },
];

const PERCENTS = [
  { val: 75, label: '75% left' },
  { val: 50, label: '50% half' },
  { val: 25, label: '25% low' },
  { val: 10, label: 'Almost empty' },
];

const prettyType = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function TechReportProductScreen() {
  const nav = useTechNav();
  const [view, setView] = useState<'report' | 'mine'>('report');

  // ---- product search ----
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<TechInvProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productErr, setProductErr] = useState<string | null>(null);

  // ---- selection / report flow ----
  const [selected, setSelected] = useState<TechInvProduct | null>(null);
  const [chosen, setChosen] = useState<ReportOption | null>(null);
  const [estPercent, setEstPercent] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastRef, setLastRef] = useState<string | null>(null);

  // ---- my reports ----
  const [mine, setMine] = useState<TechInvReport[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [mineErr, setMineErr] = useState<string | null>(null);

  const loadProducts = useCallback((q: string) => {
    setLoadingProducts(true);
    setProductErr(null);
    technicianInventoryApi
      .search(q.trim() || undefined)
      .then((r) => setProducts(r.products || []))
      .catch((e: any) => setProductErr(e?.message || 'Could not load products.'))
      .finally(() => setLoadingProducts(false));
  }, []);

  const loadMine = useCallback(() => {
    setLoadingMine(true);
    setMineErr(null);
    technicianInventoryApi
      .myReports()
      .then((r) => setMine(r.reports || []))
      .catch((e: any) => setMineErr(e?.message || 'Could not load your reports.'))
      .finally(() => setLoadingMine(false));
  }, []);

  // debounced search
  useEffect(() => {
    if (view !== 'report' || selected) return;
    const t = setTimeout(() => loadProducts(search), 200);
    return () => clearTimeout(t);
  }, [search, view, selected, loadProducts]);

  useEffect(() => {
    if (view === 'mine') loadMine();
  }, [view, loadMine]);

  const pickProduct = (p: TechInvProduct) => {
    setSelected(p);
    setChosen(null);
    setEstPercent(null);
    setNote('');
    setSubmitMsg(null);
  };

  const pickType = (o: ReportOption) => {
    setChosen(o);
    setEstPercent(o.percent ?? null);
    setSubmitMsg(null);
  };

  const resetFlow = () => {
    setSelected(null);
    setChosen(null);
    setEstPercent(null);
    setNote('');
  };

  // Step-by-Step Back Navigation (1 by 1 step back)
  const handleBack = () => {
    if (view === 'report') {
      if (chosen) {
        // If on Note/Submit step -> go back to Status Selection
        setChosen(null);
        setEstPercent(null);
        return;
      }
      if (selected) {
        // If on Status Selection step -> go back to Product Search
        resetFlow();
        return;
      }
    }
    // If on root product list or My Reports -> exit screen
    nav.back();
  };

  const submit = useCallback(async () => {
    if (!selected || !chosen || submitting) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const body: SubmitReportInput = { reportType: chosen.code, productId: selected.id };
      if (chosen.lowFlow && estPercent != null) body.estimatedRemainingPercent = estPercent;
      else if (chosen.percent != null) body.estimatedRemainingPercent = chosen.percent;
      const noteFinal = (chosen.notePrefill ? chosen.notePrefill + (note.trim() ? ' — ' + note.trim() : '') : note.trim()).trim();
      if (noteFinal) body.note = noteFinal;
      const r = await technicianInventoryApi.submitReport(body);
      setLastRef(r.reportId);
      setSubmitMsg({ ok: true, text: 'Report submitted — your manager has been notified.' });
      resetFlow();
    } catch (e: any) {
      setSubmitMsg({ ok: false, text: e?.message || 'Could not submit the report. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [selected, chosen, estPercent, note, submitting]);

  const productSub = (p: TechInvProduct) =>
    [p.brand_name, p.color_number ? `#${p.color_number}` : null, p.color_name].filter(Boolean).join(' · ') ||
    p.category_name ||
    '';

  return (
    <div style={{ padding: '16px 16px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top Header with 1-by-1 Back Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: '1.5px solid rgba(120, 90, 40, 0.18)',
            background: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--tech-text, #2b2218)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            flexShrink: 0,
          }}
        >
          <BackIcon />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--tech-text, #2b2218)' }}>
            Report a Product
          </h1>
          <div style={{ fontSize: 12, color: 'var(--tech-muted, #8a7c63)', marginTop: 1 }}>
            {selected && chosen ? 'Step 3 of 3: Add Note & Submit' : selected ? 'Step 2 of 3: Select Issue' : 'Step 1 of 3: Select Product'}
          </div>
        </div>
      </div>

      {/* Segmented Control Pill */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          background: 'rgba(120, 90, 40, 0.08)',
          padding: 4,
          borderRadius: 14,
        }}
      >
        {(['report', 'mine'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              if (v === 'report') setSubmitMsg(null);
            }}
            style={{
              flex: 1,
              padding: '9px 0',
              borderRadius: 11,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13.5,
              background: view === v ? '#FFFFFF' : 'transparent',
              color: view === v ? 'var(--tech-text, #2b2218)' : 'var(--tech-muted, #8a7c63)',
              boxShadow: view === v ? '0 2px 8px rgba(80, 60, 20, 0.12)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {v === 'report' ? 'Report' : 'My Reports'}
          </button>
        ))}
      </div>

      {submitMsg ? (
        <div
          role={submitMsg.ok ? 'status' : 'alert'}
          style={{
            padding: '14px 16px',
            borderRadius: 14,
            fontSize: 13.5,
            fontWeight: 600,
            background: submitMsg.ok ? 'rgba(16, 185, 129, 0.10)' : 'rgba(239, 68, 68, 0.10)',
            border: `1.5px solid ${submitMsg.ok ? '#10B981' : '#EF4444'}`,
            color: submitMsg.ok ? '#065F46' : '#991B1B',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div>{submitMsg.text}</div>
          {submitMsg.ok && lastRef ? (
            <div style={{ fontSize: 11.5, opacity: 0.85 }}>Reference Code: #{lastRef.slice(0, 8)}</div>
          ) : null}
        </div>
      ) : null}

      {view === 'report' ? (
        !selected ? (
          /* STEP 1: Search & Select Product */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Search Input */}
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product, shade #, or SKU…"
                style={{
                  width: '100%',
                  height: 48,
                  borderRadius: 14,
                  border: '1.5px solid rgba(120, 90, 40, 0.20)',
                  padding: '0 38px 0 16px',
                  fontSize: 14,
                  background: '#FFFFFF',
                  color: 'var(--tech-text, #2b2218)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                  boxSizing: 'border-box',
                }}
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    fontSize: 16,
                    color: '#9CA3AF',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>

            {productErr ? (
              <div style={{ padding: 14, borderRadius: 12, background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>
                {productErr}
              </div>
            ) : loadingProducts ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: 64,
                      borderRadius: 14,
                      background: '#FFFFFF',
                      border: '1px solid rgba(120,90,40,0.12)',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ width: 140, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
                      <div style={{ width: 90, height: 12, background: '#F3F4F6', borderRadius: 4 }} />
                    </div>
                    <div style={{ width: 60, height: 14, background: '#F3F4F6', borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  background: '#FFFFFF',
                  borderRadius: 16,
                  border: '1px dashed rgba(120, 90, 40, 0.25)',
                  color: 'var(--tech-muted, #8a7c63)',
                  fontSize: 13.5,
                }}
              >
                {search ? 'No products match your search query.' : 'No products found in salon catalog.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tech-muted, #8a7c63)', paddingLeft: 4 }}>
                  SALON PRODUCTS ({products.length})
                </div>
                {products.map((p) => {
                  const onHand = p.quantity_on_hand ?? p.onHand ?? 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickProduct(p)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                        background: '#FFFFFF',
                        borderRadius: 14,
                        border: '1.5px solid rgba(120, 90, 40, 0.14)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(120, 90, 30, 0.04)',
                        transition: 'transform 0.1s ease, border-color 0.1s ease',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--tech-text, #2b2218)' }}>
                          {p.name}
                        </div>
                        {productSub(p) ? (
                          <div style={{ fontSize: 12.5, color: 'var(--tech-muted, #8a7c63)', marginTop: 2 }}>
                            {productSub(p)}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: 999,
                            background: onHand > 3 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                            color: onHand > 3 ? '#059669' : '#D97706',
                          }}
                        >
                          {onHand} on hand
                        </span>
                        <span style={{ color: '#D1D5DB', fontSize: 16 }}>›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* STEPS 2 & 3: Selection Banner + Issue / Note */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Selected Product Banner */}
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(201, 151, 27, 0.08) 0%, rgba(169, 111, 34, 0.03) 100%)',
                border: '1.5px solid rgba(201, 151, 27, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#A96F22', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  SELECTED PRODUCT
                </div>
                <div style={{ fontWeight: 800, fontSize: 15.5, color: 'var(--tech-text, #2b2218)', marginTop: 2 }}>
                  {selected.name}
                </div>
                {productSub(selected) ? (
                  <div style={{ fontSize: 12, color: 'var(--tech-muted, #8a7c63)', marginTop: 1 }}>
                    {productSub(selected)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={resetFlow}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid rgba(169, 111, 34, 0.3)',
                  color: '#A96F22',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '5px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Change
              </button>
            </div>

            {!chosen ? (
              /* STEP 2: Issue Status Selection (3x3 Grid) */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tech-text, #2b2218)' }}>
                  What is the status or issue?
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 10,
                  }}
                >
                  {OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => pickType(o)}
                      style={{
                        padding: '16px 8px',
                        borderRadius: 16,
                        border: '1.5px solid rgba(120, 90, 40, 0.15)',
                        background: '#FFFFFF',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(120, 90, 30, 0.04)',
                        transition: 'transform 0.12s ease, border-color 0.12s ease',
                      }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: o.bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 20,
                        }}
                      >
                        {o.emoji}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          textAlign: 'center',
                          color: 'var(--tech-text, #2b2218)',
                          lineHeight: 1.25,
                        }}
                      >
                        {o.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* STEP 3: Remaining Quantity & Note & Submit */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Selected Status Card */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 14,
                    background: '#FFFFFF',
                    border: '1.5px solid rgba(120, 90, 40, 0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{chosen.emoji}</span>
                    <span style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--tech-text, #2b2218)' }}>
                      {chosen.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChosen(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--tech-primary, #A96F22)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Change Issue
                  </button>
                </div>

                {/* Estimated Remaining Percent (if Low flow) */}
                {chosen.lowFlow ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tech-text, #2b2218)' }}>
                      Estimated Remaining Quantity
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {PERCENTS.map((pc) => {
                        const isSelected = estPercent === pc.val;
                        return (
                          <button
                            key={pc.val}
                            type="button"
                            onClick={() => setEstPercent(isSelected ? null : pc.val)}
                            style={{
                              padding: '10px 14px',
                              borderRadius: 12,
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 13,
                              border: isSelected ? '1.5px solid #A96F22' : '1px solid rgba(120, 90, 40, 0.20)',
                              background: isSelected ? 'rgba(169, 111, 34, 0.12)' : '#FFFFFF',
                              color: isSelected ? '#A96F22' : 'var(--tech-text, #2b2218)',
                              transition: 'all 0.15s ease',
                              textAlign: 'center',
                            }}
                          >
                            {pc.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Add a Note */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tech-text, #2b2218)' }}>
                    Add a Note for Manager (Optional)
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="E.g., Bottle cap cracked during use, need replacement soon…"
                    style={{
                      width: '100%',
                      padding: 12,
                      borderRadius: 14,
                      border: '1.5px solid rgba(120, 90, 40, 0.22)',
                      fontSize: 14,
                      resize: 'none',
                      background: '#FFFFFF',
                      color: 'var(--tech-text, #2b2218)',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Submit & Cancel Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={submit}
                    style={{
                      width: '100%',
                      height: 48,
                      borderRadius: 14,
                      border: 'none',
                      background: 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)',
                      color: '#FFFFFF',
                      fontWeight: 800,
                      fontSize: 15,
                      cursor: 'pointer',
                      boxShadow: '0 3px 12px rgba(169, 111, 34, 0.25)',
                    }}
                  >
                    {submitting ? 'Submitting Report…' : 'Submit Report'}
                  </button>

                  <button
                    type="button"
                    onClick={resetFlow}
                    style={{
                      width: '100%',
                      height: 42,
                      borderRadius: 14,
                      border: '1.5px solid rgba(120, 90, 40, 0.20)',
                      background: 'transparent',
                      color: 'var(--tech-text, #2b2218)',
                      fontWeight: 700,
                      fontSize: 13.5,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        /* MY REPORTS TAB */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tech-muted, #8a7c63)' }}>
              YOUR SUBMITTED REPORTS ({mine.length})
            </div>
            <button
              type="button"
              onClick={loadMine}
              style={{
                background: 'none',
                border: 'none',
                color: '#A96F22',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ↻ Refresh
            </button>
          </div>

          {mineErr ? (
            <div style={{ padding: 14, borderRadius: 12, background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>
              {mineErr}
            </div>
          ) : loadingMine ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 80,
                    borderRadius: 14,
                    background: '#FFFFFF',
                    border: '1px solid rgba(120,90,40,0.12)',
                    padding: 14,
                  }}
                />
              ))}
            </div>
          ) : mine.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                background: '#FFFFFF',
                borderRadius: 16,
                border: '1px dashed rgba(120, 90, 40, 0.25)',
                color: 'var(--tech-muted, #8a7c63)',
                fontSize: 13.5,
              }}
            >
              You haven't submitted any product reports yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mine.map((r) => {
                const status = (r.status || 'pending').toLowerCase();
                const badgeBg = status === 'approved' ? '#D1FAE5' : status === 'rejected' ? '#FEE2E2' : '#FEF3C7';
                const badgeColor = status === 'approved' ? '#065F46' : status === 'rejected' ? '#991B1B' : '#D97706';

                return (
                  <div
                    key={r.id}
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: '#FFFFFF',
                      border: '1.5px solid rgba(120, 90, 40, 0.14)',
                      boxShadow: '0 2px 8px rgba(120, 90, 30, 0.04)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--tech-text, #2b2218)' }}>
                          {r.product_name || 'Product'}
                          {r.color_number ? ` · #${r.color_number}` : ''}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#A96F22', fontWeight: 600, marginTop: 2 }}>
                          Issue: {prettyType(r.report_type)}
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: badgeBg,
                          color: badgeColor,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          flexShrink: 0,
                        }}
                      >
                        {status}
                      </span>
                    </div>

                    {r.note ? (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: 'var(--tech-text, #2b2218)',
                          background: 'rgba(120, 90, 40, 0.05)',
                          padding: '8px 12px',
                          borderRadius: 10,
                          marginTop: 4,
                        }}
                      >
                        Note: "{r.note}"
                      </div>
                    ) : null}

                    <div style={{ fontSize: 11.5, color: 'var(--tech-muted, #8a7c63)', marginTop: 2 }}>
                      {new Date(r.created_at).toLocaleString()}
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
}
