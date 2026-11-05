import { useEffect, useState } from 'react';
import { giftCardProgramsApi, type GiftCardProgramsState } from '../api/superAdminGiftCardProgramsApi';
import { superAdminApi } from '../api/superAdminApi';

const SCOPE_LABEL: Record<string, string> = { tenant_only: 'Tenant only', owner_portfolio: 'Owner portfolio', network: 'AI PowerSalon network' };
const SCOPES = ['tenant_only', 'owner_portfolio', 'network'];
const STATUSES = ['active', 'paused', 'archived'];

export default function GiftCardProgramsScreen() {
  const [state, setState] = useState<GiftCardProgramsState | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string; code?: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [scope, setScope] = useState('network');
  const [busy, setBusy] = useState(false);
  const [memberInputs, setMemberInputs] = useState<Record<string, string>>({});

  const load = () => giftCardProgramsApi.state().then(setState).catch((e: any) => setErr(e?.message || 'Could not load gift-card programs.'));

  useEffect(() => {
    load();
    superAdminApi.state()
      .then((r: any) => {
        const list = (r?.tenants || []).map((t: any) => ({
          id: t.id,
          name: t.n || t.name || t.displayName || t.businessName || t.code || t.id,
          code: t.code || '',
        }));
        setTenants(list);
        if (list.length > 0 && !owner) {
          setOwner(list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const create = async () => {
    const trimmedName = name.trim();
    let trimmedOwner = owner.trim();

    if (!trimmedName || !trimmedOwner || busy) return;

    // If user selected or typed a salon name that matches our list, resolve its ID
    const matched = tenants.find((t) => t.name.toLowerCase() === trimmedOwner.toLowerCase() || t.id === trimmedOwner);
    if (matched) {
      trimmedOwner = matched.id;
    }

    setBusy(true);
    setErr(null);
    try {
      await giftCardProgramsApi.create({ name: trimmedName, ownerTenantId: trimmedOwner, scope });
      setName('');
      if (tenants.length > 0) {
        setOwner(tenants[0].id);
      } else {
        setOwner('');
      }
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Could not create the program. Please ensure the Owner Tenant ID is a valid salon UUID.');
    } finally {
      setBusy(false);
    }
  };

  const changeScope = async (id: string, s: string) => { setErr(null); try { await giftCardProgramsApi.update(id, { scope: s }); await load(); } catch (e: any) { setErr(e?.message || 'Could not update scope.'); } };
  const changeStatus = async (id: string, s: string) => { setErr(null); try { await giftCardProgramsApi.update(id, { status: s }); await load(); } catch (e: any) { setErr(e?.message || 'Could not update status.'); } };
  const addMember = async (id: string) => {
    let t = (memberInputs[id] || '').trim();
    if (!t) return;
    const matched = tenants.find((item) => item.name.toLowerCase() === t.toLowerCase() || item.id === t);
    if (matched) t = matched.id;
    setErr(null);
    try {
      await giftCardProgramsApi.addMember(id, t);
      setMemberInputs((m) => ({ ...m, [id]: '' }));
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Could not add the tenant. Please verify the Tenant ID.');
    }
  };
  const toggleMember = async (id: string, tenantId: string, status: string) => { setErr(null); try { await giftCardProgramsApi.setMemberStatus(id, tenantId, status === 'active' ? 'suspended' : 'active'); await load(); } catch (e: any) { setErr(e?.message || 'Could not update the member.'); } };

  const totalPrograms = state?.programs.length ?? 0;
  const activePrograms = state?.programs.filter((p) => p.status === 'active').length ?? 0;
  const networkPrograms = state?.programs.filter((p) => p.scope === 'network').length ?? 0;
  const totalMembers = state?.programs.reduce((acc, p) => acc + (p.members?.length || p.memberCount || 0), 0) ?? 0;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Gift Card Programs
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Cross-tenant gift-card programs. A program's scope controls where its cards can be redeemed; member tenants opt in here. Redemption clearing and settlement are handled separately and stay human-reviewed.
          </div>
        </div>
      </div>

      {err && (
        <div style={{ color: '#C0392B', background: '#FBE7E4', border: '1px solid #F3C4BE', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {err}</span>
          <button className="btn ghost sm" style={{ padding: '0 8px', height: 24 }} onClick={() => setErr(null)}>✕</button>
        </div>
      )}

      {/* 4 LUXURY KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[
          { label: 'Total Programs', val: totalPrograms, icon: '🎁', bg: '#EAF1FF', fg: '#2F6FED' },
          { label: 'Active Programs', val: activePrograms, icon: '✓', bg: '#E7F5EC', fg: '#1F9254' },
          { label: 'Network Scope', val: networkPrograms, icon: '🌐', bg: '#FBF0DC', fg: '#B7791F' },
          { label: 'Enrolled Members', val: totalMembers, icon: '🏪', bg: '#F3ECFB', fg: '#7C3AED' },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</span>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: k.bg, color: k.fg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{k.icon}</span>
            </div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
              {k.val}
            </div>
          </div>
        ))}
      </div>

      {/* CREATE NEW PROGRAM PANEL */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>✨</span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Create New Gift Card Program</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: 4 }}>Program Name</label>
            <input aria-label="Program name" placeholder="e.g. Metro Salon Gift Network" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} style={INPUT} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: 4 }}>
              Owner Tenant / Salon
            </label>
            {tenants.length > 0 ? (
              <select
                aria-label="Owner tenant ID"
                value={owner}
                onChange={(e) => { setOwner(e.target.value); setErr(null); }}
                style={INPUT}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    🏪 {t.name} {t.code ? `(${t.code})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Owner tenant ID"
                placeholder="e.g. 00000000-0000-0000-0000-000000000001"
                value={owner}
                onChange={(e) => { setOwner(e.target.value); setErr(null); }}
                style={INPUT}
              />
            )}
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: 4 }}>Program Scope</label>
            <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} style={INPUT}>
              {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <button disabled={busy || !name.trim() || !owner.trim()} onClick={create} className="btn" style={{ height: 38, width: '100%', fontWeight: 800 }}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </section>

      {/* PROGRAMS DIRECTORY */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!state ? (
          <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
            Loading gift-card programs…
          </div>
        ) : state.programs.length === 0 ? (
          <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 36, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎁</div>
            No gift-card programs yet. Create one above to start a cross-tenant network.
          </div>
        ) : (
          state.programs.map((p) => {
            const ownerSalon = tenants.find((t) => t.id === p.ownerTenantId);
            return (
              <section key={p.id} className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF9EF', border: '1px solid #E2C686', display: 'grid', placeItems: 'center', fontSize: 16 }}>🎁</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{p.name}</h3>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>Owner:</span>
                        {ownerSalon ? (
                          <strong style={{ color: 'var(--text)' }}>🏪 {ownerSalon.name}</strong>
                        ) : (
                          <span style={{ fontFamily: 'ui-monospace, monospace', background: '#FFF9EF', padding: '1px 6px', borderRadius: 4, color: '#8B5A18' }}>{p.ownerTenantId}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: p.status === 'active' ? '#E7F5EC' : '#F0EFF4', color: p.status === 'active' ? '#1F9254' : '#6B7280', border: `1px solid ${p.status === 'active' ? '#1F925430' : '#6B728030'}` }}>
                      {p.memberCount} active member{p.memberCount === 1 ? '' : 's'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select aria-label={`Scope for ${p.name}`} value={p.scope} onChange={(e) => changeScope(p.id, e.target.value)} style={{ ...INPUT, height: 32, fontSize: 12 }}>
                        {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                      </select>
                      <select aria-label={`Status for ${p.name}`} value={p.status} onChange={(e) => changeStatus(p.id, e.target.value)} style={{ ...INPUT, height: 32, fontSize: 12 }}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Member Tenants Section */}
                <div style={{ background: '#FFFBF2', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 8 }}>
                    Enrolled Member Tenants
                  </div>
                  {p.members.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 8 }}>No member tenants yet.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginBottom: 10 }}>
                      {p.members.map((m) => {
                        const memberSalon = tenants.find((t) => t.id === m.tenantId);
                        return (
                          <div key={m.tenantId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FFFFFF', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 13 }}>🏪</span>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                                  {memberSalon ? memberSalon.name : m.tenantId}
                                </div>
                                {memberSalon && (
                                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--muted)' }}>
                                    {memberSalon.code ? `${memberSalon.code} · ` : ''}{m.tenantId.slice(0, 8)}…
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: m.status === 'active' ? '#1F9254' : '#6B7280' }}>
                                {m.status}
                              </span>
                              <button onClick={() => toggleMember(p.id, m.tenantId, m.status)} className="btn ghost sm" style={{ padding: '2px 8px', fontSize: 11 }}>
                                {m.status === 'active' ? 'Suspend' : 'Reactivate'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <input
                      aria-label={`Add tenant to ${p.name}`}
                      placeholder="Enter or select Tenant ID to add to network..."
                      list={`tenants-datalist-${p.id}`}
                      value={memberInputs[p.id] || ''}
                      onChange={(e) => setMemberInputs((mm) => ({ ...mm, [p.id]: e.target.value }))}
                      style={{ ...INPUT, flex: 1, height: 34, fontSize: 12 }}
                    />
                    <datalist id={`tenants-datalist-${p.id}`}>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </datalist>
                    <button disabled={!(memberInputs[p.id] || '').trim()} onClick={() => addMember(p.id)} className="btn sm" style={{ height: 34, padding: '0 14px', fontWeight: 800 }}>
                      Add tenant
                    </button>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 13,
  background: '#FFFFFF',
  color: 'var(--text)',
  boxSizing: 'border-box',
};
