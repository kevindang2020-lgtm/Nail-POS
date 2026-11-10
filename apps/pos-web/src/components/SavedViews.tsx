// SavedViews.tsx — POS saved views (extras arc, Nov 9 2026: the SUNMI guides' optional "Saved Views", "Smart Filter Presets",
// "Saved Filters", "Protected Saved Filters"). One button beside a screen's filters opens the person's own named views for
// THAT screen: apply, make default, rename-by-resave, delete, and "save the current filters". The default view is applied
// once when the screen opens. A view holds filter VALUES only — the screen re-runs its own query under the person's current
// permissions, so a view never shows more than the person may see.
import { useEffect, useRef, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { checkSavedViewFilters } from '@aipowersalon/api-contracts/tenant';
import { FitDialog } from './FitKit';
import { errorTextOf } from '../i18n/error-text';
import { posSavedViewsApi, type SavedView, type SavedViewFilters } from '../api/posSavedViewsApi';

const st = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);

/** Keep only the values a view can hold (text, numbers, yes/no, empty, short text lists); drop everything else. */
export function viewableFilters(f: Record<string, unknown>): SavedViewFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || typeof v === 'function') continue;
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v;
  }
  const r = checkSavedViewFilters(out);
  return r.ok ? r.value : {};
}

/** Read a saved value back with its type: text / number / yes-no, else the fallback (a view saved by an older screen). */
export const vStr = (v: SavedViewFilters, k: string, d = '') => (typeof v[k] === 'string' ? (v[k] as string) : d);
export const vNum = (v: SavedViewFilters, k: string, d: number) => (typeof v[k] === 'number' && Number.isFinite(v[k] as number) ? (v[k] as number) : d);
export const vBool = (v: SavedViewFilters, k: string, d = false) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : d);
/** A date-range period (PeriodBar / presets + From–To) as flat view values, and back. */
export const periodToView = (p: { preset?: string; from?: string; to?: string } | null | undefined) => ({ periodPreset: p?.preset ?? null, periodFrom: p?.from ?? null, periodTo: p?.to ?? null });
export function periodFromView<P extends { preset?: string; from?: string; to?: string }>(v: SavedViewFilters, d: P): P {
  const preset = vStr(v, 'periodPreset');
  if (!preset) return d;
  return (preset === 'custom' ? { preset, from: vStr(v, 'periodFrom') || undefined, to: vStr(v, 'periodTo') || undefined } : { preset }) as P;
}

export function SavedViews({ surface, current, onApply, applyDefault = true, testId = 'saved-views' }: {
  /** the screen key, e.g. "money-protection.alerts" */
  surface: string;
  /** the screen's filters right now (what "Save current filters" stores) */
  current: Record<string, unknown>;
  /** put a view's filters back on the screen (the screen resets to page 1 and reloads) */
  onApply: (filters: SavedViewFilters, view: SavedView) => void;
  /** apply the person's default view once when the screen opens */
  applyDefault?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SavedView[] | null>(null);
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const applyRef = useRef(onApply); applyRef.current = onApply;
  const didDefault = useRef(false);

  const load = async () => {
    try {
      const r = await posSavedViewsApi.list(surface);
      setItems(r.items); setLimit(r.limit); setErr(null);
      return r.items;
    } catch (e) { setErr(errorTextOf(e, st('sv.loadFailed'))); setItems((x) => x ?? []); return null; }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await load();
      if (!alive || !applyDefault || didDefault.current || !list) return;
      didDefault.current = true;
      const d = list.find((v) => v.isDefault);
      if (d) { setActive(d.id); applyRef.current(d.filters, d); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per screen key
  }, [surface]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(errorTextOf(e, st('sv.saveFailed'))); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const v = await posSavedViewsApi.create({ surface, name: name.trim(), filters: viewableFilters(current), isDefault: makeDefault });
    setName(''); setMakeDefault(false); setActive(v.id);
  });
  const apply = (v: SavedView) => { setActive(v.id); applyRef.current(v.filters, v); setOpen(false); };
  const count = items?.length ?? 0;
  const activeName = items?.find((v) => v.id === active)?.name ?? null;

  return (
    <>
      <button type="button" className="btn btn-sm sv-open" style={{ minHeight: 44 }} onClick={() => setOpen(true)} data-testid={testId}
        aria-label={activeName ? st('sv.openNamed', { name: activeName }) : st('sv.open')}>
        {st('sv.button')}{activeName ? <span className="sv-active"> · {activeName}</span> : count ? <span className="muted"> ({count})</span> : null}
      </button>
      {open ? (
        <FitDialog title={st('sv.title')} subtitle={st('sv.sub')} onClose={() => setOpen(false)} busy={busy} testId={`${testId}-dialog`}
          footer={
            <form className="sv-save" onSubmit={(e) => { e.preventDefault(); if (name.trim() && count < limit) void save(); }}>
              <input aria-label={st('sv.name')} placeholder={st('sv.namePh')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ minHeight: 44, flex: 1 }} data-testid={`${testId}-name`} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44 }}>
                <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} data-testid={`${testId}-default`} />{st('sv.makeDefault')}
              </label>
              <button type="submit" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy || !name.trim() || count >= limit} data-testid={`${testId}-save`}>{st('sv.save')}</button>
            </form>
          }>
          {err ? <div role="alert" className="fk-error" data-testid={`${testId}-error`}>{err}</div> : null}
          {items === null ? <div className="muted">{st('sv.loading')}</div>
            : items.length === 0 ? <div className="muted" data-testid={`${testId}-empty`}>{st('sv.empty')}</div>
            : (
              <ul className="sv-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((v) => (
                  <li key={v.id} className="sv-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line, #e5e5e5)' }} data-testid={`${testId}-row`}>
                    <button type="button" className="btn btn-link" style={{ minHeight: 44, flex: 1, textAlign: 'left' }} onClick={() => apply(v)} disabled={busy} data-testid={`${testId}-apply`}>
                      {v.name}{v.isDefault ? <span className="pill" style={{ marginLeft: 8 }}>{st('sv.default')}</span> : null}{v.id === active ? <span className="muted"> · {st('sv.showing')}</span> : null}
                    </button>
                    <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} disabled={busy} onClick={() => void run(() => posSavedViewsApi.update(v.id, { isDefault: !v.isDefault }))} data-testid={`${testId}-toggle-default`}>
                      {v.isDefault ? st('sv.unsetDefault') : st('sv.setDefault')}
                    </button>
                    <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} disabled={busy} onClick={() => void run(() => posSavedViewsApi.update(v.id, { filters: viewableFilters(current) }))} data-testid={`${testId}-overwrite`}>
                      {st('sv.overwrite')}
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" style={{ minHeight: 44 }} disabled={busy} aria-label={st('sv.deleteNamed', { name: v.name })} onClick={() => void run(async () => { await posSavedViewsApi.remove(v.id); if (active === v.id) setActive(null); })} data-testid={`${testId}-delete`}>
                      {st('sv.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {count >= limit ? <div className="muted" data-testid={`${testId}-full`}>{st('sv.full', { n: limit })}</div> : null}
        </FitDialog>
      ) : null}
    </>
  );
}
