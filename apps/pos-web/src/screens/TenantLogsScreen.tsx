import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posLogsApi, type LogEntryView } from '../api/posLogsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { viIncludes } from '@aipowersalon/api-contracts';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { codeLabel } from '../components/codeLabel';
import { fmtDateTime } from '../i18n/format';

// TenantLogsScreen.tsx — Devices & Integrations › Device & Integration Logs (spec §54-§55), wired to GET /pos/logs.
// Read-only viewer with category/severity/source/search filters. Device logs stay empty until device producers exist
// (honest); integration logs populate from real producers such as webhook deliveries.
const fieldStyle: React.CSSProperties = { height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const dash = '—';

function sevTone(s: string): { cls: string; color?: string } {
  if (s === 'warning') return { cls: 'warn' };
  if (s === 'error' || s === 'critical') return { cls: '', color: 'var(--danger, #B4673B)' };
  return { cls: '' }; // info
}

export function TenantLogsScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<LogEntryView[] | null>(null);
  const [err, setErr] = useState(false);
  const [category, setCategory] = useState<'all' | 'device' | 'integration'>('all');
  const [severity, setSeverity] = useState<'all' | 'info' | 'warning' | 'error' | 'critical'>('all');
  const [search, setSearch] = useState('');

  const load = () => { setErr(false); posLogsApi.list({ limit: 200 }).then((d) => setRows(d?.logs || [])).catch(() => setErr(true)); };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim();
    return (rows || []).filter((r) =>
      (category === 'all' || r.category === category) &&
      (severity === 'all' || r.severity === severity) &&
      (!q || viIncludes(`${r.message} ${r.source}`, q)));   // accent-insensitive (WP-E foldVi)
  }, [rows, category, severity, search]);

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="vh" style={{ display: 'flex', alignItems: 'center' }}>
        <div><h1>{tx('pos.device_integration_logs')}</h1><div className="sub">{tx('pos.recent_device_and_integration_events_newest_1oyu')}</div></div>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={load}>{tx('pos.refresh')}</button>
      </div>

      <section className="panel">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value as any)} style={fieldStyle}><option value="all">{tx('pos.all_categories_2')}</option><option value="device">{tx('pos.device')}</option><option value="integration">{tx('pos.integration')}</option></select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as any)} style={fieldStyle}><option value="all">{tx('pos.all_severities')}</option><option value="info">{tx('pos.info')}</option><option value="warning">{tx('pos.warning_2')}</option><option value="error">{tx('pos.error')}</option><option value="critical">{tx('pos.critical')}</option></select>
          <ImeSafeInput value={search} onValue={setSearch} placeholder={tx('pos.search_message_or_source')} style={{ ...fieldStyle, flex: 1, minWidth: 180 }} />
          <span className="s" style={{ color: '#8A7A66' }}>{rows ? tx('pos.length_of_length2', { length: String(filtered.length), length2: String(rows.length) }) : ''}</span>
        </div>

        {err ? <div className="err">{tx('pos.couldn_t_load_logs')}{' '}<button className="btn ghost" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={load}>{tx('pos.retry')}</button></div>
          : !rows ? <div className="state">{tx('pos.loading_logs')}</div>
          : filtered.length === 0 ? <div className="muted">{rows.length === 0 ? tx('pos.no_logs_recorded_yet') : tx('pos.no_logs_match_these_filters')}</div>
          : (
            <div className="list" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
              <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}><div style={{ width: 150 }}>{tx('pos.time')}</div><div style={{ width: 70 }}>{tx('pos.severity_2')}</div><div style={{ width: 90 }}>{tx('pos.category')}</div><div style={{ width: 110 }}>{tx('pos.source')}</div><div style={{ flex: 1 }}>{tx('pos.message')}</div><div style={{ width: 80 }}>{tx('pos.status')}</div></div>
              {filtered.map((r) => {
                const t = sevTone(r.severity);
                return (
                  <div className="row" key={r.id}>
                    <div className="s" style={{ width: 150 }}>{r.createdIso ? fmtDateTime(r.createdIso) : dash}</div>
                    <div style={{ width: 70 }}><span className={'pill ' + t.cls} style={t.color ? { color: t.color } : undefined}>{codeLabel('admin.logs.severity', r.severity, ['level', 'priority'])}</span></div>
                    <div className="s" style={{ width: 90 }}>{codeLabel('admin.logs.category', r.category)}</div>
                    <div className="s" style={{ width: 110 }}>{codeLabel('admin.logs.source', r.source, 'source')}</div>
                    <div className="t" style={{ flex: 1, minWidth: 160 }}>{r.message}</div>
                    <div className="s" style={{ width: 80 }}>{r.status ? codeLabel('admin.logs.status', r.status, ['deviceUpdate', 'payment']) : dash}</div>
                  </div>
                );
              })}
            </div>
          )}
      </section>

      <div><button className="btn ghost" onClick={() => nav('/tenant/devices/overview')}>{tx('pos.back_to_devices_integrations')}</button></div>
    </div>
  );
}
