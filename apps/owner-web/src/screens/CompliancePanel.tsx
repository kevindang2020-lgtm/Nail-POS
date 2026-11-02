import { useEffect, useState } from 'react';
import { ownerCompensationApi, type ClassificationRow, type WorkerClassification, type WageConfig, type CompliancePreview, type PeriodComplianceRow } from '../api/ownerApi';
import { centsToUsdFixed } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const money = (c: number) => centsToUsdFixed(c);
const CLASS_LABEL: Record<WorkerClassification, string> = { employee: 'Employee', contractor: 'Contractor', booth_renter: 'Booth renter' };

/**
 * Worker Classification & Compliance (spec §18). The owner records each technician's classification — a decision they and
 * their advisors make, never auto-derived — and the salon's minimum wage / overtime threshold. The review tool then flags
 * exceptions (e.g. an employee below minimum wage) for a period. Flags are for review before finalizing; nothing here
 * changes pay or enforces anything. Rendered inside the (reachable) Commission & Payroll screen.
 */
export function CompliancePanel() {
  const [classes, setClasses] = useState<ClassificationRow[] | null>(null);
  const [, setWage] = useState<WageConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [techId, setTechId] = useState('');
  const [cls, setCls] = useState<WorkerClassification>('employee');
  const [minWage, setMinWage] = useState('');
  const [otThreshold, setOtThreshold] = useState('');
  const [previewTech, setPreviewTech] = useState('');
  const [pay, setPay] = useState('');
  const [hours, setHours] = useState('');
  const [preview, setPreview] = useState<CompliancePreview | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [periodRows, setPeriodRows] = useState<PeriodComplianceRow[] | null>(null);

  const loadClasses = () => ownerCompensationApi.classifications().then(setClasses).catch((e) => { setClasses([]); setError(e?.message || 'Failed to load'); });
  const loadWage = () => ownerCompensationApi.wageConfig().then((w) => { setWage(w); setMinWage((w.minHourlyWageCents / 100).toFixed(2)); setOtThreshold(String(w.overtimeThresholdHours)); }).catch(() => {});
  useEffect(() => { loadClasses(); loadWage(); }, []);

  const saveClass = async () => {
    if (!techId.trim()) { setError('Enter a technician ID'); return; }
    setBusy(true); setError(null);
    try { await ownerCompensationApi.setClassification(techId.trim(), cls); setTechId(''); loadClasses(); }
    catch (e: any) { setError(e?.message || 'Could not save the classification'); } finally { setBusy(false); }
  };
  const saveWage = async () => {
    setBusy(true); setError(null);
    try { const w = await ownerCompensationApi.setWageConfig({ minHourlyWageCents: Math.round(Number(minWage || 0) * 100), overtimeThresholdHours: Math.round(Number(otThreshold || 0)) }); setWage(w); }
    catch (e: any) { setError(e?.message || 'Could not save'); } finally { setBusy(false); }
  };
  const runPreview = async () => {
    if (!previewTech.trim()) { setError('Enter a technician ID for the review'); return; }
    setError(null);
    try { setPreview(await ownerCompensationApi.compliancePreview({ technicianId: previewTech.trim(), periodPayCents: Math.round(Number(pay || 0) * 100), hoursWorked: Number(hours || 0) })); }
    catch (e: any) { setError(e?.message || 'Review failed'); }
  };
  const reviewPeriod = async () => {
    if (!periodId.trim()) { setError('Enter a payroll period ID'); return; }
    setError(null);
    try { setPeriodRows(await ownerCompensationApi.compliancePeriodReview(periodId.trim())); }
    catch (e: any) { setError(e?.message || 'Period review failed'); setPeriodRows([]); }
  };

  return (
    <div className="owner-chartcard">
      <div className="head"><div className="t">Worker Classification & Compliance</div>{busy ? <div className="u">Working…</div> : null}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Classification is a determination you and your advisors make — it's recorded here, never decided automatically. The review below flags exceptions (like an employee below minimum wage) for you to review before finalizing payroll; it doesn't change pay.</div>
      {error ? <div role="alert" style={{ fontSize: 13, color: 'var(--owner-danger)', marginBottom: 8 }}>{error}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
        <label style={{ fontSize: 12 }}>Technician ID<br /><input aria-label="Classification technician" value={techId} onChange={(e) => setTechId(e.target.value)} className="owner-input" style={{ width: 120 }} /></label>
        <label style={{ fontSize: 12 }}>Classification<br /><select aria-label="Classification value" value={cls} onChange={(e) => setCls(e.target.value as WorkerClassification)} className="owner-input"><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="booth_renter">Booth renter</option></select></label>
        <button className="owner-btn" disabled={busy} onClick={saveClass}>Set</button>
      </div>

      {classes && classes.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {classes.map((c) => <div key={c.technicianId} style={{ fontSize: 12.5 }}>Tech {c.technicianId}: <b>{CLASS_LABEL[c.classification]}</b></div>)}
        </div>
      ) : <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No classifications set.</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ fontSize: 12 }}>Minimum wage ($/hr)<br /><input aria-label="Minimum wage" value={minWage} onChange={(e) => setMinWage(e.target.value)} className="owner-input" inputMode="decimal" style={{ width: 100 }} /></label>
        <label style={{ fontSize: 12 }}>Overtime after (hrs)<br /><input aria-label="Overtime threshold" value={otThreshold} onChange={(e) => setOtThreshold(e.target.value)} className="owner-input" inputMode="decimal" style={{ width: 100 }} /></label>
        <button className="owner-btn" disabled={busy} onClick={saveWage}>Save thresholds</button>
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Review a technician's period for compliance flags:</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12 }}>Technician ID<br /><input aria-label="Review technician" value={previewTech} onChange={(e) => setPreviewTech(e.target.value)} className="owner-input" style={{ width: 120 }} /></label>
        <label style={{ fontSize: 12 }}>Period pay ($)<br /><input aria-label="Review pay" value={pay} onChange={(e) => setPay(e.target.value)} className="owner-input" inputMode="decimal" style={{ width: 100 }} /></label>
        <label style={{ fontSize: 12 }}>Hours worked<br /><input aria-label="Review hours" value={hours} onChange={(e) => setHours(e.target.value)} className="owner-input" inputMode="decimal" style={{ width: 90 }} /></label>
        <button className="owner-btn ghost" onClick={runPreview}>Review</button>
      </div>

      {preview ? (
        <div style={{ fontSize: 12.5, marginTop: 8, padding: 8, border: '1px solid var(--owner-border, #eee)', borderRadius: 6 }}>
          <div>Classified as <b>{CLASS_LABEL[preview.classification]}</b>{preview.classificationSet ? '' : ' (default — not set)'}.</div>
          {preview.flags.length === 0 ? <div style={{ color: 'var(--owner-success)' }}>No compliance flags.</div>
            : preview.flags.map((f, i) => <div key={i} role="alert" style={{ color: 'var(--owner-danger)', marginTop: 4 }}>⚠ {f.message}</div>)}
        </div>
      ) : null}

      <div className="muted" style={{ fontSize: 12, margin: '14px 0 4px' }}>Review a built payroll period (uses each technician's actual pay and worked hours):</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12 }}>Payroll period ID<br /><input aria-label="Period review id" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="owner-input" style={{ width: 200 }} /></label>
        <button className="owner-btn ghost" onClick={reviewPeriod}>Review period</button>
      </div>
      {periodRows ? (
        periodRows.length === 0 ? <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>No lines for that period.</div>
          : <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(() => { const flagged = periodRows.filter((r) => r.flags.length > 0); return (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{flagged.length} of {periodRows.length} technician{periodRows.length === 1 ? '' : 's'} flagged</div>
                {flagged.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--owner-success)' }}>No compliance flags for this period.</div>
                  : flagged.map((r) => (
                    <div key={r.technicianId} role="alert" style={{ fontSize: 12.5, color: 'var(--owner-danger)' }}>
                      ⚠ {r.technicianName || r.technicianId} ({money(r.payableCents)}, {r.hoursWorked}h): {r.flags.map((f) => f.message).join('; ')}
                    </div>
                  ))}
              </>
            ); })()}
          </div>
      ) : null}
    </div>
  );
}
