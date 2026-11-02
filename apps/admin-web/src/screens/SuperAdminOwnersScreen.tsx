import { useCallback, useEffect, useState } from 'react';
import { superAdminApi, type SaOwnerRow, type SaOwnerDetail, type SaPortfolioSalon, SaOwnerActivity } from '../api/superAdminApi';
import { SalonsInPortfolio, AddNewSalon, InviteSalonUser } from './OwnerPortfolioPanels';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';

// SuperAdminOwnersScreen — Owner Multi-Salon assignment console (spec: SuperAdminOwnerListScreen +
// SuperAdminOwnerDetailScreen + OwnerBranchAssignmentPanel). Left: every OWNER user across tenants with their assigned
// salon count. Right: the selected owner's assigned salons (access level + primary, editable/removable) and an
// "assign a salon" panel listing only that owner's tenant branches. All writes hit the proven super-admin backend,
// which enforces within-tenant-only assignment and primary exclusivity; this UI never bypasses that.

const ACCESS = ['owner', 'manager', 'viewer', 'report_only'];

// Friendly labels for the owner audit timeline.
const ACTIVITY_LABELS: Record<string, string> = {
  super_admin_owner_branch_assigned: 'Salon assigned',
  super_admin_owner_branch_removed: 'Salon unassigned',
  super_admin_owner_branch_updated: 'Salon access changed',
  super_admin_owner_salon_created: 'New salon created',
  super_admin_owner_branch_pin_set: 'Salon PIN set',
  super_admin_owner_branch_pin_cleared: 'Salon PIN cleared',
  super_admin_owner_updated: 'Owner updated',
  owner_context_loaded: 'Opened the app',
  owner_branch_selected: 'Switched to a salon',
  owner_all_salons_selected: 'Viewed all salons',
  owner_dashboard_viewed: 'Viewed dashboard',
  owner_reports_viewed: 'Viewed reports',
  owner_export_created: 'Exported a report',
  owner_unauthorized_branch_access_blocked: 'Blocked: unassigned salon',
};
const activityLabel = (a: string) => ACTIVITY_LABELS[a] ?? a.replace(/_/g, ' ');
const activityWhen = (iso: string) => {
  const d = new Date(iso); const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function SuperAdminOwnersScreen() {
  const [owners, setOwners] = useState<SaOwnerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaOwnerDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Bumped after a salon is created so the portfolio table refetches. The table owns its own fetch — a salon
  // is a TENANT, and `detail` only ever knows about the owner's home tenant, so it cannot supply this list.
  const [portfolioKey, setPortfolioKey] = useState(0);
  const [portfolioSalons, setPortfolioSalons] = useState<SaPortfolioSalon[]>([]);

  // The invite panel needs the owner's real salon list (across tenants) to scope an invitation correctly.
  useEffect(() => {
    if (!openId) { setPortfolioSalons([]); return; }
    let alive = true;
    // try/catch, not just .catch(): if the call throws SYNCHRONOUSLY the promise never exists, so a `.catch()`
    // alone cannot save it — and an exception in an effect unmounts the WHOLE screen. That is what happened:
    // one supporting panel failing took the entire Super Admin owners console down with it. A side panel is not
    // allowed to do that; it degrades to an empty invite list and everything else keeps working.
    try {
      Promise.resolve(superAdminApi.ownerPortfolio(openId))
        .then((r) => { if (alive) setPortfolioSalons(r?.portfolio?.salons ?? []); })
        .catch(() => { if (alive) setPortfolioSalons([]); });
    } catch {
      setPortfolioSalons([]);
    }
    return () => { alive = false; };
  }, [openId, portfolioKey]);
  const [activity, setActivity] = useState<SaOwnerActivity[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // form state for the assign panel
  const [selBranch, setSelBranch] = useState('');
  const [selAccess, setSelAccess] = useState('owner');
  const [selPrimary, setSelPrimary] = useState(false);
  // form state for creating a brand-new salon (no cap on how many an owner can have)
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [newPin, setNewPin] = useState('');
  // inline 6-digit switch-PIN editor (multi-salon only): which assigned salon is being edited + its draft PIN
  const [pinEditId, setPinEditId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');

  const loadOwners = useCallback(() => {
    superAdminApi.owners()
      .then((r) => setOwners(r.owners))
      .catch((e: any) => setError(e?.message || 'Could not load owners.'));
  }, []);
  useEffect(() => { loadOwners(); }, [loadOwners]);

  const openOwner = useCallback((ownerId: string) => {
    setOpenId(ownerId); setDetail(null); setDetailErr(null); setActivity(null); setNote(null); setSelBranch(''); setSelAccess('owner'); setSelPrimary(false); setNewName(''); setNewCity(''); setNewState(''); setNewPin(''); setPinEditId(null); setPinValue('');
    superAdminApi.owner(ownerId)
      .then(setDetail)
      .catch((e: any) => setDetailErr(e?.message || 'Could not load this owner.'));
    superAdminApi.ownerActivity(ownerId).then(setActivity).catch(() => setActivity([]));
  }, []);

  const applyDetail = (d: SaOwnerDetail) => { setDetail(d); setOwners((prev) => prev ? prev.map((o) => o.ownerId === d.ownerId ? { ...o, assignedBranchCount: d.assignedBranches.length } : o) : prev); superAdminApi.ownerActivity(d.ownerId).then(setActivity).catch(() => {}); };

  const doAssign = () => {
    if (!openId || !selBranch) { setNote('Pick a salon to assign.'); return; }
    setBusy('assign'); setNote(null);
    superAdminApi.assignOwnerBranch(openId, { branchId: selBranch, accessLevel: selAccess, isPrimaryOwner: selPrimary })
      .then((d) => { applyDetail(d); setSelBranch(''); setSelPrimary(false); })
      .catch((e: any) => setNote(e?.message || 'Could not assign that salon.'))
      .finally(() => setBusy(null));
  };
  const setAccess = (branchId: string, accessLevel: string) => {
    if (!openId) return; setBusy('row-' + branchId);
    superAdminApi.updateOwnerBranch(openId, branchId, { accessLevel })
      .then(applyDetail).catch((e: any) => setNote(e?.message || 'Update failed.')).finally(() => setBusy(null));
  };
  const makePrimary = (branchId: string) => {
    if (!openId) return; setBusy('row-' + branchId);
    superAdminApi.updateOwnerBranch(openId, branchId, { isPrimaryOwner: true })
      .then(applyDetail).catch((e: any) => setNote(e?.message || 'Update failed.')).finally(() => setBusy(null));
  };
  const remove = (branchId: string) => {
    if (!openId) return; setBusy('row-' + branchId);
    superAdminApi.removeOwnerBranch(openId, branchId)
      .then(() => openOwner(openId)).catch((e: any) => setNote(e?.message || 'Remove failed.')).finally(() => setBusy(null));
  };
  const createSalon = () => {
    if (!openId || !newName.trim()) { setNote('Enter a salon name to create a new location.'); return; }
    if (newPin && !/^\d{6}$/.test(newPin)) { setNote('The switch PIN must be exactly 6 digits.'); return; }
    setBusy('create'); setNote(null);
    superAdminApi.createOwnerSalon(openId, { name: newName.trim(), city: newCity.trim() || undefined, state: newState.trim() || undefined, switchPin: /^\d{6}$/.test(newPin) ? newPin : undefined })
      .then((d) => { applyDetail(d); setNewName(''); setNewCity(''); setNewState(''); setNewPin(''); })
      .catch((e: any) => setNote(e?.message || 'Could not create that salon.'))
      .finally(() => setBusy(null));
  };

  // ── Branch switch PIN (multi-salon only) ─────────────────────────────────────
  // A PIN is a credential: drawn from the browser's CSPRNG (never Math.random), rejection-sampled so every 6-digit PIN is
  // equally likely (100000–999999).
  const genPin = () => {
    const buf = new Uint32Array(1); const limit = Math.floor(0x1_0000_0000 / 900000) * 900000;
    do { globalThis.crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return String(100000 + (buf[0] % 900000));
  };
  const openPinEditor = (branchId: string) => { setNote(null); setPinEditId(branchId); setPinValue(genPin()); };
  const savePin = (branchId: string) => {
    if (!openId) return;
    if (!/^\d{6}$/.test(pinValue)) { setNote('A salon PIN must be exactly 6 digits.'); return; }
    setBusy('pin-' + branchId);
    superAdminApi.setOwnerBranchPin(openId, branchId, pinValue)
      .then((d) => { applyDetail(d); setPinEditId(null); setPinValue(''); })
      .catch((e: any) => setNote(e?.message || 'Could not set that PIN.'))
      .finally(() => setBusy(null));
  };
  const clearPin = (branchId: string) => {
    if (!openId) return; setBusy('pin-' + branchId);
    superAdminApi.clearOwnerBranchPin(openId, branchId)
      .then((d) => { applyDetail(d); setPinEditId(null); setPinValue(''); })
      .catch((e: any) => setNote(e?.message || 'Could not clear that PIN.'))
      .finally(() => setBusy(null));
  };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!owners) return <div className="work"><div className="state">Loading owners…</div></div>;

  const q = search.trim().toLowerCase();
  const rows = q ? owners.filter((o) => o.fullName.toLowerCase().includes(q) || (o.email || '').toLowerCase().includes(q) || (o.tenantName || '').toLowerCase().includes(q)) : owners;
  const assignable = detail ? detail.assignableBranches.filter((b) => !detail.assignedBranches.some((a) => a.branchId === b.branchId)) : [];

  const inpStyle: React.CSSProperties = {
    height: 34,
    border: '1px solid var(--line)',
    borderRadius: 9,
    padding: '0 10px',
    background: '#FFFDF8',
    fontFamily: 'inherit',
    fontSize: 12.5,
    color: 'var(--text)',
    outline: 'none',
  };

  return (
    <div className="work">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-3 mb-3">
        <div className="vh" style={{ flex: 1, margin: 0 }}>
          <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: 0 }}>
            Owner Salons <span aria-hidden style={{ color: 'var(--gold,#A96F22)' }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Assign and oversee multi-salon owner accounts across tenants · {owners.length} owners registered.
          </div>
        </div>
        <div className='items-baseline' style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={loadOwners} title="Refresh owners list" style={{ minHeight: 36 }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Owner Portfolio: Salons in Portfolio · Add New Salon · Create/Invite Salon User ── */}
      {openId && detail ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr] gap-4 items-start mb-4">
          <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
            <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15, fontWeight: 700 }}>Salons in Portfolio</h2>
            </div>
            <div className='overflow-x-auto' style={{ padding: 14 }}>
              <SalonsInPortfolio ownerId={openId} reloadKey={portfolioKey} />
            </div>
          </section>
          <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
            <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15, fontWeight: 700 }}>Add New Salon</h2>
            </div>
            <div style={{ padding: 14 }}>
              <AddNewSalon
                ownerEmail={detail.email}
                ownerName={detail.fullName}
                onCreated={() => { setPortfolioKey((k) => k + 1); void openOwner(openId); }}
              />
            </div>
          </section>
          <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
            <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 15, fontWeight: 700 }}>Create / Invite Salon User</h2>
            </div>
            <div style={{ padding: 14 }}>
              <InviteSalonUser salons={portfolioSalons} />
            </div>
          </section>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] gap-4 items-start">
        {/* ── Owner list panel ─────────────────────────────────────────── */}
        <section className="panel" style={{ padding: 0, overflow: 'hidden', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          <div className="hd" style={{ background: '#FFF9EF', padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
              Owners Directory <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({rows.length})</span>
            </h2>
          </div>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: '#FFFDF8' }}>
            <input
              placeholder="Search owner, email, or salon business…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inpStyle, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div className="list overflow-x-auto" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', gap: 0 }}>
            {rows.length === 0 ? (
              <div style={{ padding: '30px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>No owners match your search.</div>
            ) : null}
            {rows.map((o) => (
              <div key={o.ownerId} className="min-w-[580px] sm:min-w-auto">
              <button
                className={'row' + (openId === o.ownerId ? ' active' : '')}
                onClick={() => openOwner(o.ownerId)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: '12px 14px',
                  background: openId === o.ownerId ? '#FBF4E6' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--line)',
                  borderRadius: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'background 0.15s ease',
                  boxShadow: openId === o.ownerId ? 'inset 3px 0 0 var(--gold, #caa45a)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 170, flex: 1 }}>
                  <ProfileAvatarWithPreview name={o.fullName || 'Owner'} url={(o as any).avatarUrl} size={34} type="superadmin" />
                  <div style={{ minWidth: 0 }}>
                    <div className="t" style={{ fontWeight: 700, color: 'var(--text)' }}>{o.fullName}</div>
                    <div className="s" style={{ color: 'var(--muted)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.email || '—'} · {o.tenantName || 'No salon business'}
                    </div>
                  </div>
                </div>
                <span className="pill" style={{ marginLeft: 'auto', background: '#FFFDF8' }}>
                  {o.assignedBranchCount} salon{o.assignedBranchCount === 1 ? '' : 's'}
                </span>
                <span className={'pill ' + (o.status === 'active' ? 'ok' : '')}>{o.status}</span>
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Selected owner detail + assignment ─────────────────────── */}
        <section className="panel overflow-x-auto" style={{ padding: 0, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          {!openId ? (
            <div style={{ padding: '64px 20px', textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--cream2,#F7F2E9)', color: 'var(--gold,#A96F22)', display: 'grid', placeItems: 'center', fontSize: 24, margin: '0 auto 14px' }}>👤</div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Select an Owner Account</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>
                Choose an owner from the directory on the left to manage their assigned salon branches, multi-location switch PINs, and portfolio access.
              </div>
            </div>
          ) : detailErr ? (
            <div style={{ padding: 20 }}>
              <div className="err">{detailErr}</div>
            </div>
          ) : !detail ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)' }}>Loading owner details…</div>
          ) : (
            <>
                    <div className="hd min-w-[600px]" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProfileAvatarWithPreview name={detail.fullName || 'Owner'} url={(detail as any).avatarUrl} size={36} type="superadmin" />
                  <div>
                    <h2 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 16, fontWeight: 700 }}>
                      {detail.fullName}
                    </h2>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {detail.email || '—'} · {(detail as any).tenantName || 'No home tenant'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="pill" style={{ background: '#FFFDF8' }}>{detail.assignedBranches.length} Salons</span>
                  {detail.isMultiSalon ? <span className="pill ok">Multi-Salon</span> : null}
                </div>
              </div>

              <div className='min-w-[600px]' style={{ padding: 18 }}>
                {note ? <div className="err" style={{ marginBottom: 14 }}>{note}</div> : null}

                {/* Assigned Salons */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Assigned Salons</div>
                    <span className="muted" style={{ fontSize: 11.5 }}>{detail.assignedBranches.length} assigned</span>
                  </div>
                  {detail.isMultiSalon ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, background: 'var(--cream2,#F7F2E9)', padding: '8px 12px', borderRadius: 8 }}>
                      Multi-salon owner — in the POS, a manager or receptionist must enter a salon’s 6-digit PIN to switch into it. Set each salon’s PIN below.
                    </div>
                  ) : null}
                  {detail.assignedBranches.length === 0 ? (
                    <div style={{ padding: '16px', background: '#FFFDF8', border: '1px dashed var(--line)', borderRadius: 10, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
                      No salons assigned yet — this owner currently sees their whole tenant. Assign specific salons below to restrict them.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {detail.assignedBranches.map((b) => (
                        <div key={b.branchId} style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
                          <div className="row" style={{ border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 160 }}>
                              <div className="t" style={{ fontWeight: 700, fontSize: 13 }}>
                                {b.branchName} {b.isPrimaryOwner ? <span className="pill ok" style={{ marginLeft: 6 }}>Primary</span> : null}
                              </div>
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <select value={b.accessLevel} disabled={busy === 'row-' + b.branchId} onChange={(e) => setAccess(b.branchId, e.target.value)} aria-label={`Access level for ${b.branchName}`} style={inpStyle}>
                                {ACCESS.map((a) => <option key={a} value={a}>{a}</option>)}
                              </select>
                              {!b.isPrimaryOwner ? <button className="btn ghost" disabled={busy === 'row-' + b.branchId} onClick={() => makePrimary(b.branchId)} style={{ minHeight: 34, fontSize: 12 }}>Make primary</button> : null}
                              <button className="btn ghost" disabled={busy === 'row-' + b.branchId} onClick={() => remove(b.branchId)} style={{ minHeight: 34, fontSize: 12 }}>Remove</button>
                            </div>
                          </div>
                          {detail.isMultiSalon ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                              <span className="muted" style={{ fontSize: 12 }}>Switch PIN:</span>
                              {b.hasSwitchPin ? <span className="pill ok">PIN set</span> : <span className="pill">No PIN</span>}
                              {pinEditId === b.branchId ? (
                                <>
                                  <input value={pinValue} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} aria-label={`Switch PIN for ${b.branchName}`} style={{ ...inpStyle, width: 96, letterSpacing: 3, textAlign: 'center', fontWeight: 700 }} />
                                  <button className="btn ghost" type="button" onClick={() => setPinValue(genPin())} style={{ minHeight: 34, fontSize: 12 }}>Generate</button>
                                  <button className="btn" disabled={busy === 'pin-' + b.branchId} onClick={() => savePin(b.branchId)} style={{ minHeight: 34, fontSize: 12 }}>{busy === 'pin-' + b.branchId ? 'Saving…' : 'Save PIN'}</button>
                                  <button className="btn ghost" type="button" onClick={() => { setPinEditId(null); setPinValue(''); }} style={{ minHeight: 34, fontSize: 12 }}>Cancel</button>
                                </>
                              ) : (
                                <>
                                  <button className="btn ghost" onClick={() => openPinEditor(b.branchId)} style={{ minHeight: 30, padding: '0 10px', fontSize: 11.5 }}>{b.hasSwitchPin ? 'Change PIN' : 'Set PIN'}</button>
                                  {b.hasSwitchPin ? <button className="btn ghost" disabled={busy === 'pin-' + b.branchId} onClick={() => clearPin(b.branchId)} style={{ minHeight: 30, padding: '0 10px', fontSize: 11.5 }}>Clear</button> : null}
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assign a Salon Form */}
                <div style={{ marginBottom: 20, padding: 14, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Assign a Salon</div>
                  {assignable.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>All of this owner’s tenant salons are already assigned.</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <select value={selBranch} onChange={(e) => setSelBranch(e.target.value)} aria-label="Salon to assign" style={{ ...inpStyle, minWidth: 160 }}>
                        <option value="">Choose a salon…</option>
                        {assignable.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
                      </select>
                      <select value={selAccess} onChange={(e) => setSelAccess(e.target.value)} aria-label="Access level" style={inpStyle}>
                        {ACCESS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selPrimary} onChange={(e) => setSelPrimary(e.target.checked)} /> Primary
                      </label>
                      <button className="btn" disabled={busy === 'assign' || !selBranch} onClick={doAssign} style={{ minHeight: 34, fontSize: 12 }}>
                        {busy === 'assign' ? 'Assigning…' : 'Assign salon'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Create a New Salon */}
                <div style={{ marginBottom: 20, padding: 14, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Create a New Salon Location</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Add a brand-new location to this owner. There’s no limit on how many salons one owner can have.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <input placeholder="Salon name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New salon name" style={{ ...inpStyle, minWidth: 180 }} />
                    <input placeholder="City (optional)" value={newCity} onChange={(e) => setNewCity(e.target.value)} aria-label="New salon city" style={{ ...inpStyle, width: 130 }} />
                    <input placeholder="State (optional)" value={newState} onChange={(e) => setNewState(e.target.value)} aria-label="New salon state" style={{ ...inpStyle, width: 90 }} />
                    {detail.assignedBranches.length >= 1 ? (
                      <input placeholder="Switch PIN (6-digit)" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} aria-label="New salon switch PIN" style={{ ...inpStyle, width: 150, letterSpacing: 2, textAlign: 'center' }} />
                    ) : null}
                    <button className="btn" disabled={busy === 'create' || !newName.trim()} onClick={createSalon} style={{ minHeight: 34, fontSize: 12 }}>
                      {busy === 'create' ? 'Creating…' : 'Create & assign salon'}
                    </button>
                  </div>
                </div>

                {/* Recent Activity Timeline */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Recent Owner Activity</div>
                  {activity === null ? (
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Loading activity…</div>
                  ) : activity.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No recorded activity yet for this owner.</div>
                  ) : (
                    <div className="activity" aria-label="Owner activity timeline" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
                      {activity.slice(0, 12).map((e, i) => (
                        <div className="arow" key={i} style={{ padding: '8px 4px' }}>
                          <span className={'adot' + (e.action.includes('blocked') ? ' warn' : e.action.startsWith('super_admin') ? ' admin' : '')} aria-hidden />
                          <span className="alabel" style={{ fontWeight: 600 }}>{activityLabel(e.action)}</span>
                          {e.role === 'SUPER_ADMIN' ? <span className="pill" style={{ fontSize: 9.5, padding: '2px 6px' }}>by admin</span> : null}
                          <span className="awhen" style={{ fontSize: 11.5, color: 'var(--muted)' }}>{activityWhen(e.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
