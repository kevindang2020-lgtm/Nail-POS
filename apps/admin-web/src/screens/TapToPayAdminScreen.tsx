// TapToPayAdminScreen.tsx — Super Admin → Tap to Pay (Owner & Manager Payment App mandate §5–§9, §34, §123, §145).
// Per tenant: the SAFE onboarding status — Apple Tap to Pay entitlement, the Fiserv Tap to Pay merchant enrollment, whether the
// platform's processor credentials are present (yes/no only — never the values) and whether Tap to Pay is live for the
// salon — plus the operator's record of that progress, and the salon's payment phones (trust state, health) with approve /
// revoke. The platform-wide and provider kill switches live in the Kill-Switch Centre (payments.tap_to_pay /
// payments.fiserv_tap_to_pay); this screen links there instead of duplicating them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useInlineConfirm } from '@aipowersalon/ui';
import { superAdminApi } from '../api/superAdminApi';
import {
  tapToPayAdminApi,
  TTP_APPLE_STATUSES,
  TTP_PSP_STATUSES,
  type TtpOnboardingAdminView,
  type TtpDeviceAdminRow,
  type TtpAppleEntitlementStatus,
  type TtpPspEnrollmentStatus,
} from '../api/tapToPayAdminApi';

type TenantLite = {
  id: string;
  n?: string;
  name?: string;
  displayName?: string;
  salonName?: string;
  tenantName?: string;
  code?: string;
  salonCode?: string;
  tenantCode?: string;
};

const tenantLabel = (t: TenantLite) => {
  const name = t.n || t.displayName || t.name || t.salonName || t.tenantName || 'Salon';
  const code = t.code || t.salonCode || t.tenantCode;
  return code ? `${name} (${code})` : name;
};

const label = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

const when = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const badge = (s: string) =>
  s === 'active'
    ? { bg: '#EAF5EE', fg: '#2E7D32', border: '#C8E6C9' }
    : s === 'pending' || s === 'disabled'
    ? { bg: '#FFF6E5', fg: '#B7791F', border: '#FFE0B2' }
    : { bg: '#FDE8E8', fg: '#C53030', border: '#FFCDD2' };

const selectStyle: React.CSSProperties = {
  height: 38,
  border: '1px solid #E2D9CC',
  borderRadius: 10,
  padding: '0 12px',
  fontFamily: 'inherit',
  background: '#FFFDF8',
  color: '#2A2520',
  fontSize: 13,
  fontWeight: 500,
  outline: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
};

export function TapToPayAdminScreen() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get('tenantId') || '';
  const { confirm, confirmUi } = useInlineConfirm();
  const [tenants, setTenants] = useState<TenantLite[] | null>(null);
  const [tenantsErr, setTenantsErr] = useState(false);
  const [ob, setOb] = useState<TtpOnboardingAdminView | null>(null);
  const [devices, setDevices] = useState<TtpDeviceAdminRow[]>([]);
  const [form, setForm] = useState<{
    apple: TtpAppleEntitlementStatus;
    psp: TtpPspEnrollmentStatus;
    notes: string;
  }>({ apple: 'not_started', psp: 'not_started', notes: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (superAdminApi.state() as Promise<{ tenants: TenantLite[] }>)
      .then((r) => {
        const list = r.tenants || [];
        setTenants(list);
        setTenantsErr(false);
      })
      .catch(() => setTenantsErr(true));
  }, []);

  const selected = useMemo(() => tenants?.find((t) => t.id === tenantId) || null, [tenants, tenantId]);

  const load = useCallback(() => {
    if (!tenantId) {
      setOb(null);
      setDevices([]);
      return;
    }
    setLoading(true);
    setErr(null);
    Promise.all([tapToPayAdminApi.onboarding(tenantId), tapToPayAdminApi.devices(tenantId)])
      .then(([o, d]) => {
        setOb(o);
        setDevices(Array.isArray(d) ? d : []);
        setForm({
          apple: o.appleEntitlementStatus,
          psp: o.pspEnrollmentStatus,
          notes: o.notes || '',
        });
      })
      .catch((e: any) => setErr(e?.message || 'Failed to load Tap to Pay status.'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(load, [load]);

  const pickTenant = (id: string) => {
    const p = new URLSearchParams(params);
    if (id) p.set('tenantId', id);
    else p.delete('tenantId');
    setParams(p, { replace: true });
  };

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setErr(null);
    setNote(null);
    try {
      await fn();
      setNote(ok);
      load();
    } catch (e: any) {
      setErr(e?.message || 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const saveOnboarding = () =>
    act(
      'ob',
      () =>
        tapToPayAdminApi.setOnboarding(tenantId, {
          appleEntitlementStatus: form.apple,
          pspEnrollmentStatus: form.psp,
          notes: form.notes.trim() || undefined,
        }),
      'Onboarding status recorded.'
    );

  const activeCount = devices.filter((d) => d.status === 'active').length;
  const pendingCount = devices.filter((d) => d.status === 'pending').length;

  return (
    <div className="work" style={{ width: '100%', padding: '20px 24px 48px', boxSizing: 'border-box' }}>
      {/* HEADER SECTION */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 20,
          background: '#FFFDF9',
          padding: '20px 24px',
          borderRadius: 16,
          border: '1px solid #ECE4D8',
          boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>📱</span>
            <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, margin: 0, color: '#2C2218' }}>
              Tap to Pay on iPhone <span style={{ color: '#A96F22' }}>★</span>
            </h1>
          </div>
          <div style={{ fontSize: 13, color: '#7A6E5E', marginTop: 4 }}>
            Owner &amp; Manager Payment App — onboarding status and authorized payment phones per salon.
          </div>
        </div>

        {/* TENANT SELECTOR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#685947' }}>Salon:</span>
          <select
            value={tenantId}
            onChange={(e) => pickTenant(e.target.value)}
            aria-label="Tenant"
            style={{
              ...selectStyle,
              minWidth: 260,
              fontWeight: 600,
              cursor: 'pointer',
              borderColor: '#D8C3A5',
              background: '#FFFBF2',
            }}
          >
            <option value="">
              {tenantsErr ? 'Could not load tenants' : tenants ? 'Select a salon…' : 'Loading salons…'}
            </option>
            {(tenants || []).map((t) => (
              <option key={t.id} value={t.id}>
                {tenantLabel(t)}
              </option>
            ))}
          </select>
          {tenantId ? (
            <button
              className="btn ghost"
              onClick={load}
              disabled={loading}
              style={{
                height: 38,
                borderRadius: 10,
                padding: '0 14px',
                border: '1px solid #D8C3A5',
                background: '#FFFDF8',
                fontWeight: 600,
                color: '#685947',
              }}
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          ) : null}
        </div>
      </div>

      {note ? (
        <div
          className="toast"
          role="status"
          style={{
            background: '#EAF5EE',
            border: '1px solid #C8E6C9',
            color: '#2F6B43',
            padding: '12px 18px',
            borderRadius: 12,
            marginBottom: 16,
            fontWeight: 600,
          }}
        >
          ✓ {note}
        </div>
      ) : null}

      {err ? (
        <div
          className="toast"
          role="alert"
          style={{
            background: '#FDE8E8',
            border: '1px solid #FFCDD2',
            color: '#9A4436',
            padding: '12px 18px',
            borderRadius: 12,
            marginBottom: 16,
            fontWeight: 600,
          }}
        >
          ⚠ {err}
        </div>
      ) : null}

      {confirmUi}

      {!tenantId ? (
        <div
          className="panel"
          style={{
            padding: 32,
            color: '#7A6E5E',
            textAlign: 'center',
            background: '#FFFDF9',
            border: '1px solid #ECE4D8',
            borderRadius: 16,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏪</div>
          <h3 style={{ margin: '0 0 8px', color: '#2C2218' }}>Select a Salon to View Tap to Pay Status</h3>
          <div style={{ maxWidth: 520, margin: '0 auto', fontSize: 13.5, lineHeight: 1.5 }}>
            Pick a tenant to see its Tap to Pay onboarding and payment phones. Platform and provider kill switches are in
            the{' '}
            <Link to="/system-status" style={{ color: '#A96F22', fontWeight: 600 }}>
              Kill-Switch Centre (System Status)
            </Link>
            .
          </div>
        </div>
      ) : loading && !ob ? (
        <div
          className="panel"
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#7A6E5E',
            background: '#FFFDF9',
            borderRadius: 16,
            border: '1px solid #ECE4D8',
          }}
        >
          Loading Tap to Pay status…
        </div>
      ) : ob ? (
        <>
          {/* 4 SUMMARY STAT CARDS */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 14,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                background: '#FFFDF9',
                border: '1px solid #ECE4D8',
                borderRadius: 14,
                padding: '16px 20px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8C7D6B', textTransform: 'uppercase' }}>
                Tap to Pay Status
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: ob.onboarded ? '#2E7D32' : '#B7791F',
                  }}
                />
                <span style={{ fontSize: 17, fontWeight: 700, color: ob.onboarded ? '#2E7D32' : '#B7791F' }}>
                  {ob.onboarded ? 'Live' : 'Setup Required'}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: '#8C7D6B', marginTop: 4 }}>
                {ob.onboarded ? 'Ready for contactless card reads' : 'Setup Required to take payments'}
              </div>
            </div>

            <div
              style={{
                background: '#FFFDF9',
                border: '1px solid #ECE4D8',
                borderRadius: 14,
                padding: '16px 20px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8C7D6B', textTransform: 'uppercase' }}>
                Apple Entitlement
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: ob.appleEntitlementStatus === 'approved' ? '#EAF5EE' : '#FFF6E5',
                    color: ob.appleEntitlementStatus === 'approved' ? '#2E7D32' : '#B7791F',
                    border: `1px solid ${ob.appleEntitlementStatus === 'approved' ? '#C8E6C9' : '#FFE0B2'}`,
                  }}
                >
                  {label(ob.appleEntitlementStatus)}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: '#8C7D6B', marginTop: 6 }}>ProximityReader permission</div>
            </div>

            <div
              style={{
                background: '#FFFDF9',
                border: '1px solid #ECE4D8',
                borderRadius: 14,
                padding: '16px 20px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8C7D6B', textTransform: 'uppercase' }}>
                Fiserv CommerceHub
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: ob.pspEnrollmentStatus === 'active' ? '#EAF5EE' : '#FFF6E5',
                    color: ob.pspEnrollmentStatus === 'active' ? '#2E7D32' : '#B7791F',
                    border: `1px solid ${ob.pspEnrollmentStatus === 'active' ? '#C8E6C9' : '#FFE0B2'}`,
                  }}
                >
                  {label(ob.pspEnrollmentStatus)}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: '#8C7D6B', marginTop: 6 }}>
                Platform keys: <b>{ob.credentialsPresent ? 'Present' : 'Missing'}</b>
              </div>
            </div>

            <div
              style={{
                background: '#FFFDF9',
                border: '1px solid #ECE4D8',
                borderRadius: 14,
                padding: '16px 20px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8C7D6B', textTransform: 'uppercase' }}>
                Payment Phones
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#2C2218', marginTop: 6, fontFamily: 'Playfair Display, serif' }}>
                {devices.length} <span style={{ fontSize: 12, fontWeight: 500, color: '#7A6E5E' }}>registered</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#8C7D6B', marginTop: 4 }}>
                <span style={{ color: '#2E7D32', fontWeight: 600 }}>{activeCount} active</span> ·{' '}
                <span style={{ color: pendingCount > 0 ? '#B7791F' : '#8C7D6B', fontWeight: 600 }}>
                  {pendingCount} pending
                </span>
              </div>
            </div>
          </div>

          {/* ONBOARDING STATUS PANEL */}
          <div
            className="panel"
            style={{
              padding: '22px 24px',
              marginBottom: 20,
              background: '#FFFDF9',
              border: '1px solid #ECE4D8',
              borderRadius: 16,
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.03)',
            }}
            aria-label="Onboarding status"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#2C2218' }}>
                  {selected ? tenantLabel(selected) : 'Salon'} — {ob.onboarded ? 'Tap to Pay live' : 'Tap to Pay not live'}
                </h3>
                <div style={{ fontSize: 12.5, color: '#7A6E5E', marginTop: 3 }}>
                  Last updated: <b>{when(ob.updatedAt)}</b>
                </div>
              </div>
              <span
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background: ob.onboarded ? '#EAF5EE' : '#FFF6E5',
                  color: ob.onboarded ? '#2E7D32' : '#B7791F',
                  border: `1px solid ${ob.onboarded ? '#C8E6C9' : '#FFE0B2'}`,
                }}
              >
                {ob.onboarded ? '✓ Live' : '⚠ Setup Required'}
              </span>
            </div>

            {!ob.onboarded && (
              <div
                style={{
                  background: '#FFFBF2',
                  border: '1px solid #EEDBBE',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontSize: 12.5,
                  color: '#8A5D1A',
                  lineHeight: 1.5,
                  marginBottom: 16,
                }}
              >
                Live requires Apple entitlement <b>Approved</b>, Fiserv enrollment <b>Active</b>, and platform credentials
                present. Until then the app shows “Tap to Pay · Setup Required” and takes no card.
              </div>
            )}

            {/* Quick Record Status Controls */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                paddingTop: 8,
                borderTop: '1px solid #F0E8DC',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#7A6E5E' }}>Apple Entitlement:</span>
                <select
                  aria-label="Apple entitlement status"
                  value={form.apple}
                  onChange={(e) => setForm({ ...form, apple: e.target.value as TtpAppleEntitlementStatus })}
                  style={selectStyle}
                >
                  {TTP_APPLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#7A6E5E' }}>Fiserv Enrollment:</span>
                <select
                  aria-label="Fiserv enrollment status"
                  value={form.psp}
                  onChange={(e) => setForm({ ...form, psp: e.target.value as TtpPspEnrollmentStatus })}
                  style={selectStyle}
                >
                  {TTP_PSP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </div>

              <input
                aria-label="Onboarding notes"
                placeholder="Onboarding notes (no secrets)…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                style={{ ...selectStyle, minWidth: 260, flex: '1 1 200px' }}
              />

              <button
                className="btn"
                disabled={busy === 'ob'}
                onClick={saveOnboarding}
                style={{
                  height: 38,
                  padding: '0 18px',
                  background: 'linear-gradient(135deg, #B58438 0%, #8E601C 100%)',
                  color: '#FFF',
                  fontWeight: 600,
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(169, 111, 34, 0.2)',
                }}
              >
                {busy === 'ob' ? 'Saving…' : 'Record status'}
              </button>
            </div>
          </div>

          {/* PAYMENT PHONES TABLE */}
          <div
            className="panel"
            style={{
              padding: '22px 24px',
              background: '#FFFDF9',
              border: '1px solid #ECE4D8',
              borderRadius: 16,
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.03)',
            }}
            aria-label="Payment phones"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#2C2218' }}>
                  Payment phones ({devices.length})
                </h3>
                <div style={{ fontSize: 12.5, color: '#7A6E5E', marginTop: 2 }}>
                  Devices authorized to run the Tap to Pay on iPhone contactless card reader.
                </div>
              </div>
              {pendingCount > 0 && (
                <span
                  style={{
                    background: '#FFF6E5',
                    color: '#B7791F',
                    border: '1px solid #FFE0B2',
                    padding: '4px 12px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ⚡ {pendingCount} device{pendingCount > 1 ? 's' : ''} awaiting approval
                </span>
              )}
            </div>

            {devices.length === 0 ? (
              <div
                style={{
                  padding: 36,
                  textAlign: 'center',
                  color: '#8C7D6B',
                  background: '#FFFBF2',
                  borderRadius: 12,
                  border: '1px solid #ECE4D8',
                }}
              >
                No phones registered for this salon yet. Once staff sign into the Manager Pay app on an iPhone, it will
                appear here.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #ECE4D8', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 800 }}>
                  <thead>
                    <tr
                      style={{
                        background: '#FFFBF2',
                        borderBottom: '1px solid #ECE4D8',
                        textAlign: 'left',
                        color: '#7A6E5E',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <th style={{ padding: '12px 16px' }}>Phone / Device</th>
                      <th style={{ padding: '12px 16px' }}>Status</th>
                      <th style={{ padding: '12px 16px' }}>App Version</th>
                      <th style={{ padding: '12px 16px' }}>Last Seen</th>
                      <th style={{ padding: '12px 16px' }}>Last Payment</th>
                      <th style={{ padding: '12px 16px' }}>Last Error</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d, idx) => {
                      const b = badge(d.status);
                      const isPending = d.status === 'pending' || d.status === 'disabled';
                      return (
                        <tr
                          key={d.deviceId}
                          style={{
                            borderBottom: idx === devices.length - 1 ? 'none' : '1px solid #F0E8DC',
                            background: isPending ? '#FFFBF5' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 8,
                                  background: '#FFF9EF',
                                  border: '1px solid #E2D9CC',
                                  display: 'grid',
                                  placeItems: 'center',
                                  fontSize: 16,
                                }}
                              >
                                📱
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, color: '#2C2218' }}>
                                  {d.label || `iPhone (${d.deviceId.slice(0, 8)})`}
                                </div>
                                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#8C7D6B' }}>
                                  {label(d.platform)}
                                  {d.tapToPayCapable ? ' · Tap to Pay capable' : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span
                              style={{
                                background: b.bg,
                                color: b.fg,
                                border: `1px solid ${b.border}`,
                                borderRadius: 999,
                                padding: '3px 10px',
                                fontWeight: 700,
                                fontSize: 11.5,
                                display: 'inline-block',
                              }}
                            >
                              {label(d.status)}
                            </span>
                            {d.revokeReason ? (
                              <div style={{ fontSize: 11, color: '#C53030', marginTop: 4 }}>{d.revokeReason}</div>
                            ) : null}
                          </td>
                          <td style={{ padding: '14px 16px', color: '#685947' }}>
                            {d.appVersion ? `v${d.appVersion}` : '—'}
                          </td>
                          <td style={{ padding: '14px 16px', color: '#7A6E5E', fontSize: 12 }}>
                            {when(d.lastSeenAt)}
                          </td>
                          <td style={{ padding: '14px 16px', color: '#7A6E5E', fontSize: 12 }}>
                            {when(d.lastPaymentAt)}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {d.lastErrorCode ? (
                              <span style={{ color: '#C53030', fontSize: 11.5, fontWeight: 600 }}>
                                {d.lastErrorCode} · <span style={{ fontWeight: 400 }}>{when(d.lastErrorAt)}</span>
                              </span>
                            ) : (
                              <span style={{ color: '#A09485' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {isPending && (
                              <button
                                className="btn"
                                disabled={busy === d.deviceId}
                                onClick={() =>
                                  act(
                                    d.deviceId,
                                    () => tapToPayAdminApi.approve(tenantId, d.deviceId),
                                    `${d.label || 'Phone'} approved.`
                                  )
                                }
                                style={{
                                  height: 32,
                                  padding: '0 14px',
                                  background: '#2E7D32',
                                  color: '#FFF',
                                  fontWeight: 600,
                                  borderRadius: 8,
                                  border: 'none',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  marginRight: 6,
                                }}
                              >
                                {busy === d.deviceId ? 'Approving…' : 'Approve'}
                              </button>
                            )}
                            {d.status !== 'revoked' && (
                              <button
                                className="btn ghost"
                                disabled={busy === d.deviceId}
                                onClick={() =>
                                  confirm(
                                    `Revoke ${d.label || 'this phone'}? It stops taking payments immediately.`,
                                    () =>
                                      void act(
                                        d.deviceId,
                                        () => tapToPayAdminApi.revoke(tenantId, d.deviceId),
                                        `${d.label || 'Phone'} revoked.`
                                      )
                                  )
                                }
                                style={{
                                  height: 32,
                                  padding: '0 12px',
                                  border: '1px solid #E2D9CC',
                                  borderRadius: 8,
                                  background: '#FFFDF8',
                                  color: '#C53030',
                                  fontWeight: 600,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
