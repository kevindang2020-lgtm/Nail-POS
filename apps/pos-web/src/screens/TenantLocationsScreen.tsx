// TenantLocationsScreen.tsx — Management → Locations. Lists each branch, summary KPIs, and a full editor
// (basic info + address/map-pin + publish workflow). Reuses the canonical /tenant/locations API. Each
// branch is independent; editing one never touches another.
import { useEffect, useState } from 'react';
import { posLocationsApi, type SalonLocation, type LocationSummary } from '../api/posLocationsApi';
import { SalonLocationMapEditor } from './locations/SalonLocationMapEditor';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
const FIELD = (label: string, value: any, set: (v: any) => void, type = 'text') => (
  <label className="lf"><span>{label}</span><input type={type} value={value ?? ''} onChange={(e) => set(e.target.value)} /></label>
);
const TOGGLE = (label: string, value: boolean, set: (v: boolean) => void) => (
  <label className="lt"><input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} /><span>{label}</span></label>
);

function StatusPill({ l }: { l: SalonLocation }) {
  const v = l.verification_status || 'draft';
  const pub = l.is_public === true;
  const tone = v === 'verified' ? 'ok' : v === 'rejected' || v === 'suspended' ? 'red' : v === 'pending_review' ? 'blue' : 'mut';
  return <span className={`lpill ${tone}`}>{pub ? tx('pos.published_3') : ''}{statusLabel('location', v)}</span>;
}

export function TenantLocationsScreen() {
  const [rows, setRows] = useState<SalonLocation[]>([]);
  const [summary, setSummary] = useState<LocationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SalonLocation | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try { const r = await posLocationsApi.list(); setRows(r.locations); setSummary(r.summary); }
    catch (e: any) { setError(e?.message || tx('pos.could_not_load_locations')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    try { const r = await posLocationsApi.create({ name: newName.trim() }); setAdding(false); setNewName(''); await load(); setEditing(r.location); }
    catch (e: any) { setError(e?.message || tx('pos.could_not_create_the_location')); }
  };

  const summaryCards: [string, number | string, string][] = summary ? [
    [tx('admin.locations.kpi.total'), summary.total, 'mut'], [tx('pos.active_3'), summary.active, 'ok'], [tx('status.location.published'), summary.published, 'blue'],
    [tx('pos.unverified'), summary.unverified, summary.unverified ? 'orange' : 'mut'],
    [tx('admin.locations.kpi.missingPins'), summary.missingPins, summary.missingPins ? 'red' : 'mut'],
    [tx('admin.locations.kpi.acceptingBookings'), summary.acceptingBookings, 'ok'],
  ] : [];

  if (editing) return <LocationEditor location={editing} onBack={() => { setEditing(null); void load(); }} onSaved={(l) => setEditing(l)} />;

  return (
    <div className="work loc-work">
      <div className="loc-head flex flex-col lg:flex-row gap-3 justify-between">
        <div>
          <h1>{tx('pos.salon_locations')}</h1>
          <p className="sub">{tx('pos.manage_branch_details_map_locations_public_1rip')}</p>
        </div>
        <div className="loc-actions ">
          <button className="btn  ghost whitespace-nowrap" onClick={() => load()}>{tx('pos.refresh')}</button>
          <button className="btn primary whitespace-nowrap" onClick={() => setAdding(true)}>{tx('pos.add_location_2')}</button>
        </div>
      </div>

      <div className="loc-kpis">
        {summaryCards.map(([l, v, t]) => (<div key={l} className={`loc-kpi ${t}`}><div className="lk-v">{v}</div><div className="lk-l">{l}</div></div>))}
      </div>

      {adding && (
        <div className="loc-add">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder={tx('pos.new_branch_name_e_g_downtown_14zp')} />
          <button className="btn primary" onClick={create}>{tx('pos.create_2')}</button>
          <button className="btn ghost" onClick={() => { setAdding(false); setNewName(''); }}>{tx('pos.cancel')}</button>
        </div>
      )}

      {error && <div className="loc-err">{error}</div>}
      {loading ? <div className="loc-empty">{tx('pos.loading_locations')}</div>
        : rows.length === 0 ? <div className="loc-empty">{tx('pos.no_locations_yet_add_your_first_9muq')}</div>
        : (
          <div className="loc-list">
            {rows.map((l) => (
              <div key={l.id} className="loc-card flex justify-between flex-col sm:flex-row !items-baseline justify-start">
                <div className="lc-main">
                  <div className="lc-name">{l.public_display_name || l.name || tx('pos.branch')}</div>
                  <div className="lc-sub">{l.formatted_address || [l.address, l.city, l.state, l.zip].filter(Boolean).join(', ') || tx('pos.no_address_set')}</div>
                  <div className="lc-meta">
                    <StatusPill l={l} />
                    <span className={`lchip ${l.latitude != null ? 'ok' : 'red'}`}>{l.latitude != null ? (l.map_pin_confirmed_at ? tx('pos.pin_confirmed') : tx('pos.pin_set')) : tx('pos.no_map_pin')}</span>
                    {l.salon_code && <span className="lchip mut">{tx('pos.code')}{' '}{l.salon_code}</span>}
                    <span className={`lchip ${l.is_online_booking_enabled !== false ? 'ok' : 'mut'}`}>{l.is_online_booking_enabled !== false ? tx('pos.online_booking_2') : tx('pos.booking_off')}</span>
                  </div>
                </div>
                <div className="lc-actions ">
                  <button className="btn whitespace-nowrap" onClick={() => setEditing(l)}>{tx('pos.edit_map_pin')}</button>
                  {l.is_public === true
                    ? <button className="btn ghost whitespace-nowrap" onClick={async () => { await posLocationsApi.unpublish(l.id); void load(); }}>{tx('pos.unpublish')}</button>
                    : <button className="btn ghost whitespace-nowrap" onClick={async () => { try { await posLocationsApi.publish(l.id); void load(); } catch (e: any) { setError(e?.message || tx('pos.cannot_publish_yet')); } }}>{tx('pos.publish')}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function LocationEditor({ location, onBack, onSaved }: { location: SalonLocation; onBack: () => void; onSaved: (l: SalonLocation) => void }) {
  const [l, setL] = useState<SalonLocation>(location);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof SalonLocation) => (v: any) => setL((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setError(null); setMsg(null);
    try {
      const body: any = {};
      ['name', 'public_display_name', 'salon_code', 'description', 'phone', 'public_email', 'website', 'address', 'address_line2', 'suite_unit', 'city', 'state', 'zip', 'timezone', 'manager_name', 'manager_phone', 'manager_email', 'internal_notes', 'is_online_booking_enabled', 'accepts_walk_ins', 'show_phone_publicly', 'show_address_publicly', 'show_prices_publicly'].forEach((k) => { body[k] = (l as any)[k]; });
      const r = await posLocationsApi.update(l.id, body); setL(r.location); onSaved(r.location); setMsg(tx('pos.saved_2'));
    } catch (e: any) { setError(e?.message || tx('pos.could_not_save')); }
    finally { setSaving(false); }
  };

  const publish = async () => {
    setError(null); setMsg(null);
    try { const r = await posLocationsApi.publish(l.id); setL(r.location); onSaved(r.location); setMsg(tx('pos.published_to_customer_discovery')); }
    catch (e: any) { setError(e?.message || tx('pos.cannot_publish_yet')); }
  };
  const unpublish = async () => { const r = await posLocationsApi.unpublish(l.id); setL(r.location); onSaved(r.location); setMsg(tx('pos.unpublished')); };

  return (
    <div className="work loc-work">
      <div className="loc-head">
        <div>
          <button className="btn ghost" onClick={onBack}>{tx('pos.all_locations')}</button>
          <h1 style={{ marginTop: 8 }}>{l.public_display_name || l.name}</h1>
          <p className="sub"><StatusPill l={l} /></p>
        </div>
        <div className="loc-actions flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button className="btn whitespace-nowrap" onClick={save} disabled={saving}>{saving ? tx('pos.saving_2') : tx('pos.save_changes')}</button>
          {l.is_public === true ? <button className="btn ghost whitespace-nowrap" onClick={unpublish}>{tx('pos.unpublish')}</button> : <button className="btn primary whitespace-nowrap" onClick={publish}>{tx('pos.publish')}</button>}
        </div>
      </div>
      {error && <div className="loc-err">{error}</div>}
      {msg && <div className="loc-ok">{msg}</div>}

      <div className="loc-edit-grid">
        <section className="loc-panel">
          <h3>{tx('pos.basic_information')}</h3>
          {FIELD(tx('admin.locations.field.name'), l.name, set('name'))}
          {FIELD(tx('admin.locations.field.publicName'), l.public_display_name, set('public_display_name'))}
          {FIELD(tx('admin.locations.field.salonCode'), l.salon_code, set('salon_code'))}
          {FIELD(tx('pos.phone'), l.phone, set('phone'))}
          {FIELD(tx('admin.locations.field.publicEmail'), l.public_email, set('public_email'))}
          {FIELD(tx('pos.website'), l.website, set('website'))}
          <label className="lf"><span>{tx('pos.description')}</span><textarea value={l.description ?? ''} onChange={(e) => set('description')(e.target.value)} rows={2} /></label>
        </section>

        <section className="loc-panel">
          <h3>{tx('pos.address_2')}</h3>
          {FIELD(tx('admin.locations.field.address1'), l.address, set('address'))}
          {FIELD(tx('admin.locations.field.suite'), l.suite_unit, set('suite_unit'))}
          <div className="lf-row">{FIELD(tx('pos.city'), l.city, set('city'))}{FIELD(tx('pos.state'), l.state, set('state'))}{FIELD(tx('admin.locations.field.zip'), l.zip, set('zip'))}</div>
          {FIELD(tx('pos.timezone'), l.timezone, set('timezone'))}
        </section>

        <section className="loc-panel loc-panel-wide">
          <h3>{tx('pos.map_pin_verification')}</h3>
          <SalonLocationMapEditor location={l} onSaved={(nl) => { setL(nl); onSaved(nl); }} />
        </section>

        <section className="loc-panel">
          <h3>{tx('pos.customer_facing_options')}</h3>
          {TOGGLE(tx('admin.locations.toggle.onlineBookings'), l.is_online_booking_enabled !== false, (v) => set('is_online_booking_enabled')(v))}
          {TOGGLE(tx('admin.locations.toggle.walkIns'), l.accepts_walk_ins !== false, (v) => set('accepts_walk_ins')(v))}
          {TOGGLE(tx('admin.locations.toggle.showPhone'), l.show_phone_publicly !== false, (v) => set('show_phone_publicly')(v))}
          {TOGGLE(tx('admin.locations.toggle.showAddress'), l.show_address_publicly !== false, (v) => set('show_address_publicly')(v))}
          {TOGGLE(tx('admin.locations.toggle.showPrices'), l.show_prices_publicly === true, (v) => set('show_prices_publicly')(v))}
        </section>

        <section className="loc-panel">
          <h3>{tx('pos.manager_internal_never_shown_to_customers')}</h3>
          {FIELD(tx('admin.locations.field.manager'), l.manager_name, set('manager_name'))}
          {FIELD(tx('admin.locations.field.managerPhone'), l.manager_phone, set('manager_phone'))}
          {FIELD(tx('admin.locations.field.managerEmail'), l.manager_email, set('manager_email'))}
          <label className="lf"><span>{tx('pos.internal_notes')}</span><textarea value={l.internal_notes ?? ''} onChange={(e) => set('internal_notes')(e.target.value)} rows={2} /></label>
        </section>
      </div>
    </div>
  );
}
