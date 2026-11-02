// TopSearch.tsx — tenant POS global search (top bar) with responsive mobile overlay.
// Vietnamese POS mandate WP-E (§40–§41): both search boxes are ImeSafeInput — Telex / VNI typing never fires a search
// mid-composition and never loses a half-typed accent; the server matches accent-insensitively ("nguyen" finds "Nguyễn").
// Group labels are resolved at render (instant EN/VI switch, no module-level t()); badges go through statusLabel().
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posSearchApi, type SearchGroupKey, type SearchHit } from '../api/posSearchApi';
import { useAuth } from '../auth/AuthContext';
import { Icon } from './tenant-nav';
import { t, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { statusLabel } from '../i18n/status-label';

const GROUP_ORDER: [SearchGroupKey, () => string][] = [
  ['customers', () => t('pos.customers')], ['appointments', () => t('pos.appointments')], ['queue', () => t('search.group.queue')],
  ['tickets', () => t('pos.tickets')], ['receipts', () => t('pos.transactions')], ['technicians', () => t('pos.technicians')], ['services', () => t('pos.services')],
];
/** The status domain of each group's badge (statusLabel(domain, code); the code stays the authority). */
const BADGE_DOMAIN: Record<SearchGroupKey, string> = {
  customers: 'customer', appointments: 'appointment', queue: 'queue', tickets: 'ticket', receipts: 'receipt', technicians: 'technician', services: 'service',
};

const ROUTE_FOR: Record<string, string> = {
  customer: '/customers', appointment: '/tech-appointments', queue_item: '/queue',
  ticket: '/checkout', receipt: '/reports', technician: '/technicians', service: '/services',
};

export function TopSearch() {
  const nav = useNavigate();
  useLanguage();   // re-render in place on an EN/VI switch (labels are read at render)
  const { principal } = useAuth() as any;
  const recentKey = `pos.recentSearch.${principal?.userId || principal?.id || 'anon'}`;

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Record<SearchGroupKey, SearchHit[]> | null>(null);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch { return []; }
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<any>(null);

  const flat = useMemo(() => {
    if (!groups) return [] as { key: SearchGroupKey; hit: SearchHit }[];
    const out: { key: SearchGroupKey; hit: SearchHit }[] = [];
    for (const [k] of GROUP_ORDER) for (const hit of (groups[k] || [])) out.push({ key: k, hit });
    return out;
  }, [groups]);

  // Outside click listener
  useEffect(() => {
    if (!open && !mobileSearchOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, mobileSearchOpen]);

  // Keyboard shortcut Ctrl/Cmd + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (window.innerWidth < 640) {
          setMobileSearchOpen(true);
          setTimeout(() => mobileInputRef.current?.focus(), 50);
        } else {
          setOpen(true);
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search query
  useEffect(() => {
    const term = q.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (term.length < 2) {
      setGroups(null);
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => { void doSearch(term); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  const doSearch = async (term: string) => {
    const seq = ++seqRef.current;
    setLoading(true); setError(null); setSearched(true); setOpen(true); setActive(-1);
    try {
      const r = await posSearchApi.global(term);
      if (seq !== seqRef.current) return;
      setGroups(r.groups);
    } catch (e: any) {
      if (seq !== seqRef.current) return;
      setError(e?.status === 403 ? t('pos.you_do_not_have_permission_to_ahdp') : t('pos.unable_to_search_right_now_please_p5fd'));
      setGroups(null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  const pushRecent = (term: string) => {
    if (!term) return;
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const openHit = (hit: SearchHit) => {
    setOpen(false);
    setMobileSearchOpen(false);
    pushRecent(q.trim());
    posSearchApi.recordOpen(hit.type, hit.id, q.trim()).catch(() => { });
    nav(ROUTE_FOR[hit.type] || '/overview');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setMobileSearchOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (active >= 0 && flat[active]) openHit(flat[active].hit);
      else if (q.trim().length >= 2) void doSearch(q.trim());
    }
  };

  const clear = () => {
    setQ('');
    setGroups(null);
    setError(null);
    setSearched(false);
    setOpen(false);
    if (mobileSearchOpen) {
      mobileInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  };

  const totalHits = flat.length;
  let runningIndex = -1;

  const renderDropdownPanel = () => (
    <div className="search-panel" role="listbox">
      {loading && <div className="search-msg">{t('pos.searching_2')}</div>}
      {!loading && error && <div className="search-msg err">{error}</div>}

      {!loading && !error && !searched && recent.length > 0 && (
        <div className="search-recent">
          <div className="sr-h">{t('pos.recent_searches')}</div>
          {recent.map((r) => (
            <button key={r} className="sr-item" onClick={() => setQ(r)}>
              <span className="sr-ic"><Icon name="search" /></span>{r}
            </button>
          ))}
        </div>
      )}
      {!loading && !error && !searched && recent.length === 0 && (
        <div className="search-msg">{t('pos.search_customers_appointments_tickets_services_technicians_56rm')}</div>
      )}

      {!loading && !error && searched && totalHits === 0 && (
        <div className="search-msg">{t('pos.no_matching_records_were_found_in_xs9c')}</div>
      )}

      {!loading && !error && groups && totalHits > 0 && GROUP_ORDER.map(([key, label]) => {
        const hits = groups[key] || [];
        if (hits.length === 0) return null;
        return (
          <div key={key} className="search-group">
            <div className="sg-h">{label()}</div>
            {hits.map((hit) => {
              runningIndex++;
              const idx = runningIndex;
              return (
                <button
                  key={hit.id + hit.type}
                  className={`search-hit ${idx === active ? 'active' : ''}`}
                  role="option"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => openHit(hit)}
                >
                  <span className="sh-av">{(hit.title?.[0] || '?').toUpperCase()}</span>
                  <span className="sh-id">
                    <span className="sh-name">{hit.title}</span>
                    {hit.subtitle && <span className="sh-sub">{hit.subtitle}</span>}
                  </span>
                  {hit.badge && <span className="sh-badge">{statusLabel(BADGE_DOMAIN[key], String(hit.badge))}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} className="top-search flex items-center">
      {/* 1. Mobile Search Trigger Button (Only visible on screens < sm) */}
      <button
        type="button"
        className="flex md:hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e5d8c3] bg-white text-[#5b5043] shadow-sm hover:bg-[#faf7f2] transition-colors"
        aria-label={t('pos.open_search')}
        onClick={() => {
          setMobileSearchOpen(true);
          setTimeout(() => mobileInputRef.current?.focus(), 60);
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
      </button>

      {/* 2. Desktop Search Box (Hidden on screens < sm) */}
      <div className="search !hidden md:!flex relative">
        <div className="search-box1">
          <ImeSafeInput
            ref={inputRef}
            type="search"
            value={q}
            onValue={setQ}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={t('pos.search_anything')}
            aria-label={t('pos.search_this_salon_s_pos')}
            inputMode="search"
            enterKeyHint="search"
          />
          {q && <button className="search-clear" onClick={clear} aria-label={t('pos.clear_search')}>×</button>}
          <button className="search-go" onClick={() => q.trim().length >= 2 && doSearch(q.trim())} aria-label={t('pos.search')} title={t('pos.search')}>
            <Icon name="search" />
          </button>
        </div>

        {open && renderDropdownPanel()}
      </div>

      {/* 3. Mobile Overlay Search Bar (Floats over header on click) */}
      {mobileSearchOpen && (
        <div className="absolute left-0 top-0 z-50 flex h-full w-full items-center gap-2 bg-[#f8f5ed] px-2 md:hidden shadow-md">
          <div className="search flex flex-1 relative">
            <div className="search-box1 flex-1 flex items-center">
              <ImeSafeInput
                ref={mobileInputRef}
                autoFocus
                type="search"
                value={q}
                onValue={setQ}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder={t('pos.search_anything')}
                aria-label={t('pos.search_anything_2')}
                className="w-full"
              />
              {q && <button className="search-clear" onClick={clear} aria-label={t('pos.clear_search')}>×</button>}
              <button
                type="button"
                className="search-go"
                onClick={() => q.trim().length >= 2 && doSearch(q.trim())}
                aria-label={t('pos.search')}
              >
                <Icon name="search" />
              </button>
            </div>

            {open && renderDropdownPanel()}
          </div>

          {/* Close Overlay Button */}
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e5d8c3] bg-white text-[#5b5043] shadow-sm hover:bg-[#faf7f2] transition-colors"
            aria-label={t('pos.close_search')}
            onClick={() => {
              setMobileSearchOpen(false);
              setOpen(false);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}