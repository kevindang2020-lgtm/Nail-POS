// CreateIncidentModal — open a new platform incident. It starts in Investigating; publishing a public update and
// notifying tenants are separate, explicitly-permissioned steps (not bundled into creation).
import { useState } from 'react';
import { superAdminApi, type SystemStatusOverview } from '../api/superAdminApi';

const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };

export function CreateIncidentModal({ services, onClose, onCreated }: { services: SystemStatusOverview['services']; onClose: () => void; onCreated: (msg: string) => void }) {
  const [f, setF] = useState({ title: '', componentKey: services[0]?.key || '', severity: 'high', impact: 'major', affectedTenants: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: string[] = [];
    if (!f.title.trim()) e.push('An incident title is required.');
    if (!f.componentKey) e.push('An affected service is required.');
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.createIncident({ title: f.title.trim(), componentKey: f.componentKey, severity: f.severity, impact: f.impact, affectedTenants: f.affectedTenants ? Number(f.affectedTenants) : 0 });
      if (!res.ok || !res.incident) { setErrors(res.errors || ['Could not create incident.']); setBusy(false); return; }
      onCreated(`Incident ${res.incident.incidentId} created (${res.incident.status}). Publishing a public update and notifying tenants are separate steps.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Create incident" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Create Incident</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        <label style={{ ...lab, display: 'block' }}>Title<input className="inp" style={fld} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Booking System latency" /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Affected service<select className="inp" style={fld} value={f.componentKey} onChange={(e) => setF({ ...f, componentKey: e.target.value })}>{services.map((s) => <option key={s.key} value={s.key}>{s.service}</option>)}</select></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Severity<select className="inp" style={fld} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{['critical', 'high', 'medium', 'low', 'informational'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label style={lab}>Impact<select className="inp" style={fld} value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })}>{['none', 'minor', 'major', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label style={lab}>Affected tenants<input className="inp" style={fld} type="number" min={0} value={f.affectedTenants} onChange={(e) => setF({ ...f, affectedTenants: e.target.value })} /></label>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>New incidents start in <b>Investigating</b>. Move them forward as you identify, mitigate, monitor, and resolve.</div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create incident'}</button>
        </div>
      </div>
    </div>
  );
}

export function PublishUpdateModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ title: '', body: '', audience: 'all_tenants' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!f.title.trim()) { setErrors(['An update title is required.']); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.publishStatusUpdate({ title: f.title.trim(), body: f.body.trim() || undefined, audience: f.audience });
      if (!res.ok || !res.update) { setErrors(res.errors || ['Could not publish.']); setBusy(false); return; }
      onDone(`Public status update published to ${res.update.audience}.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Publish public status update" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Publish Public Status Update</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
        <label style={{ ...lab, display: 'block' }}>Title<input className="inp" style={fld} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Queue Sync Partial Outage Update" /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Message<textarea className="inp" style={{ ...fld, height: 'auto', minHeight: 90, padding: '8px 10px' }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Audience<select className="inp" style={fld} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{[['all_tenants', 'All tenants'], ['affected_tenants', 'Affected tenants'], ['internal', 'Internal only']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>{busy ? 'Publishing…' : 'Publish update'}</button></div>
      </div>
    </div>
  );
}

export function NotifyTenantsModal({ incidents, onClose, onDone }: { incidents: SystemStatusOverview['activeIncidents']; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ message: '', channel: 'email', audience: 'affected_tenants', incidentReference: incidents[0]?.incidentId || '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!f.message.trim()) { setErrors(['A message is required.']); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.notifyTenants({ message: f.message.trim(), channel: f.channel, audience: f.audience, incidentReference: f.incidentReference.trim() || undefined });
      if (!res.ok || !res.sent) { setErrors(res.errors || ['Could not send.']); setBusy(false); return; }
      onDone(`Notification sent via ${res.sent.channel} to ${res.sent.audience}. Only affected tenants receive incident-scoped messages.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Notify affected tenants" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Notify Affected Tenants</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
        <label style={{ ...lab, display: 'block' }}>Related incident<input className="inp" style={{ ...fld, fontFamily: 'monospace' }} value={f.incidentReference} onChange={(e) => setF({ ...f, incidentReference: e.target.value })} placeholder="INC-…" list="notify-incidents" />
          <datalist id="notify-incidents">{incidents.map((i) => <option key={i.incidentId} value={i.incidentId} />)}</datalist>
        </label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Customer-safe message<textarea className="inp" style={{ ...fld, height: 'auto', minHeight: 90, padding: '8px 10px' }} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="e.g. We're investigating booking latency and will update shortly." /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Channel<select className="inp" style={fld} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{[['email', 'Email'], ['sms', 'SMS'], ['push', 'Push'], ['in_app', 'In-app'], ['tenant_notice', 'Tenant notice']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={lab}>Audience<select className="inp" style={fld} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{[['affected_tenants', 'Affected tenants'], ['all_tenants', 'All tenants']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Delivery goes through the Communications module; only a safe summary is logged — never private tenant contact details.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send notification'}</button></div>
      </div>
    </div>
  );
}

export function PostIncidentReportModal({ incidents, onClose, onDone }: { incidents: SystemStatusOverview['activeIncidents']; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ title: '', incidentReference: incidents[0]?.incidentId || '', rootCause: '', summary: '', owner: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const e: string[] = [];
    if (!f.title.trim()) e.push('A report title is required.');
    if (!f.incidentReference.trim()) e.push('A related incident is required.');
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.createPostIncidentReport({ title: f.title.trim(), incidentReference: f.incidentReference.trim(), rootCause: f.rootCause.trim() || undefined, summary: f.summary.trim() || undefined, owner: f.owner.trim() || undefined });
      if (!res.ok || !res.report) { setErrors(res.errors || ['Could not create report.']); setBusy(false); return; }
      onDone(`Post-incident report ${res.report.reportReference} ${res.report.status.toLowerCase()}.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Create post-incident report" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Create Post-Incident Report</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
        <label style={{ ...lab, display: 'block' }}>Title<input className="inp" style={fld} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Booking System Report" /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Related incident<input className="inp" style={{ ...fld, fontFamily: 'monospace' }} value={f.incidentReference} onChange={(e) => setF({ ...f, incidentReference: e.target.value })} placeholder="INC-2026-0506-001" list="ss-incidents" />
          <datalist id="ss-incidents">{incidents.map((i) => <option key={i.incidentId} value={i.incidentId} />)}</datalist>
        </label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Root cause<input className="inp" style={fld} value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Summary<textarea className="inp" style={{ ...fld, height: 'auto', minHeight: 80, padding: '8px 10px' }} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Owner<input className="inp" style={fld} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create report'}</button></div>
      </div>
    </div>
  );
}

export function ScheduleMaintenanceModal({ services, onClose, onDone }: { services: SystemStatusOverview['services']; onClose: () => void; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ service: services[0]?.service || '', scope: 'Global', windowStart: '', windowEnd: '', tenantImpact: '', owner: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const e: string[] = [];
    if (!f.service.trim()) e.push('A service is required.');
    if (!f.windowStart) e.push('A start time is required.');
    if (!f.windowEnd) e.push('An end time is required.');
    if (f.windowStart && f.windowEnd && new Date(f.windowEnd) < new Date(f.windowStart)) e.push('The maintenance window cannot end before it starts.');
    if (e.length) { setErrors(e); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.scheduleMaintenance({ service: f.service, scope: f.scope, windowStart: new Date(f.windowStart).toISOString(), windowEnd: new Date(f.windowEnd).toISOString(), tenantImpact: f.tenantImpact ? Number(f.tenantImpact) : 0, owner: f.owner.trim() || undefined });
      if (!res.ok || !res.maintenance) { setErrors(res.errors || ['Could not schedule.']); setBusy(false); return; }
      onDone(`Maintenance scheduled for ${res.maintenance.service} (${res.maintenance.scope}) and notice ${res.maintenance.noticeStatus.toLowerCase()}.`);
    } catch (err: any) { setErrors([err?.message || 'Request failed.']); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Schedule maintenance" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '5vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Schedule Maintenance</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
        <label style={{ ...lab, display: 'block' }}>Service<select className="inp" style={fld} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>{services.map((s) => <option key={s.key} value={s.service}>{s.service}</option>)}</select></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={lab}>Window start<input className="inp" style={fld} type="datetime-local" value={f.windowStart} onChange={(e) => setF({ ...f, windowStart: e.target.value })} /></label>
          <label style={lab}>Window end<input className="inp" style={fld} type="datetime-local" value={f.windowEnd} onChange={(e) => setF({ ...f, windowEnd: e.target.value })} /></label>
          <label style={lab}>Scope<select className="inp" style={fld} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>{['Global', 'Regional', 'Single tenant'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label style={lab}>Tenant impact<input className="inp" style={fld} type="number" min={0} value={f.tenantImpact} onChange={(e) => setF({ ...f, tenantImpact: e.target.value })} /></label>
        </div>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Owning team<input className="inp" style={fld} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="e.g. Infra Team" /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>{busy ? 'Scheduling…' : 'Schedule maintenance'}</button></div>
      </div>
    </div>
  );
}
