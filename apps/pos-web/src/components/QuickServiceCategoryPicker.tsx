import React, { useEffect, useMemo, useState } from 'react';
import { getLanguage } from '@aipowersalon/mobile-sdk/i18n';

/**
 * Receptionist quick picker, embedded inside the EXISTING New Booking / Walk-In
 * "Choose Your Services" step. It does not own navigation, appointments or catalog
 * writes. Categories come exclusively from the authenticated tenant's APIs.
 *
 * The first eight familiar nail categories are examples, not a hardcoded catalog
 * or a database/UI limit. Search covers every loaded category and service.
 */
export type QuickPickerService = { category: string; name: string };
type Props = {
  categories: string[];
  services: QuickPickerService[];
  activeCategory: string;
  onSelectCategory: (name: string) => void;
  allValue: string;
  allLabel: string;
};

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function categoryIcon(name: string): string {
  const n = fold(name);
  if (/mani/.test(n)) return '💅';
  if (/pedi/.test(n)) return '🦶';
  if (/gel|shellac/.test(n)) return '✨';
  if (/acrylic/.test(n)) return '🎨';
  if (/dip|powder/.test(n)) return '🌸';
  if (/nail art|design|artistic/.test(n)) return '🖌️';
  if (/wax/.test(n)) return '🪷';
  if (/add.on|additional|extra/.test(n)) return '➕';
  return '🗂️'; // Tenant-created categories are never restricted to the examples above.
}

const BATCH_SIZE = 40;

export function QuickServiceCategoryPicker({
  categories, services, activeCategory, onSelectCategory, allValue, allLabel,
}: Props) {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const vietnamese = getLanguage() === 'vi';
  const words = vietnamese
    ? { search: 'Tìm danh mục hoặc dịch vụ...', categories: 'danh mục', services: 'dịch vụ', more: 'Xem thêm danh mục', none: 'Không tìm thấy danh mục hoặc dịch vụ', all: 'Chọn tất cả dịch vụ' }
    : { search: 'Search categories or services...', categories: 'categories', services: 'services', more: 'Show more categories', none: 'No matching categories or services', all: 'Browse all services' };

  const ownCategories = useMemo(() => {
    const seen = new Set<string>();
    return categories.filter((name) => {
      if (!name || name === allValue) return false;
      const key = fold(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [categories, allValue]);

  const serviceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const service of services) {
      const key = fold(service.category || '');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [services]);

  const matchingCategories = useMemo(() => {
    const q = fold(query);
    if (!q) return ownCategories;
    const serviceMatchingCategories = new Set(services.filter((s) => fold(s.name).includes(q)).map((s) => fold(s.category)));
    return ownCategories.filter((name) => fold(name).includes(q) || serviceMatchingCategories.has(fold(name)));
  }, [ownCategories, services, query]);

  useEffect(() => { setVisibleCount(BATCH_SIZE); }, [query, categories]);
  const shown = matchingCategories.slice(0, visibleCount);

  return (
    <div data-testid="quick-category-picker" style={{ marginBottom: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ flex: '1 1 260px', minWidth: 0 }}>
          <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap' }}>
            {words.search}
          </span>
          <input
            data-testid="category-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={words.search}
            aria-label={words.search}
            style={{ width: '100%', height: 44, padding: '0 14px', background: '#FFF', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)', fontSize: 14 }}
          />
        </label>
        <span aria-live="polite" data-testid="category-count" style={{ fontSize: 13, color: 'var(--muted)' }}>
          {matchingCategories.length} {words.categories}
        </span>
        <button
          type="button"
          data-testid="category-all"
          aria-label={words.all}
          aria-pressed={activeCategory === allValue}
          onClick={() => onSelectCategory(allValue)}
          style={{ height: 44, padding: '0 16px', fontSize: 13, fontWeight: 700, border: '1px solid var(--line)', borderRadius: 11, cursor: 'pointer', color: activeCategory === allValue ? '#FFF' : 'var(--text)', background: activeCategory === allValue ? 'var(--aps-orange)' : '#FFF' }}
        >
          {allLabel}
        </button>
      </div>

      <div
        role="group"
        aria-label={vietnamese ? 'Chọn danh mục dịch vụ' : 'Choose service category'}
        data-testid="category-tile-scroll"
        style={{ maxHeight: 310, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: 4, borderRadius: 12, border: '1px solid var(--line)' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 155px), 1fr))', gap: 10 }}>
          {shown.map((name) => {
            const selected = activeCategory === name;
            const count = serviceCounts.get(fold(name)) || 0;
            return (
              <button
                key={name}
                type="button"
                data-testid="category-tile"
                aria-pressed={selected}
                onClick={() => onSelectCategory(name)}
                style={{
                  minHeight: 106, padding: 12, borderRadius: 13, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 5,
                  background: selected ? '#FFF4E4' : '#FFF', border: selected ? '2px solid var(--aps-orange)' : '1px solid #E8DED2',
                  color: 'var(--text)', boxShadow: '0 1px 4px rgba(52, 35, 15, .06)', textAlign: 'center',
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1.2 }}>{categoryIcon(name)}</span>
                <span style={{ fontSize: 14, fontWeight: 750, overflowWrap: 'anywhere' }}>{name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{count} {words.services}</span>
              </button>
            );
          })}
        </div>
        {matchingCategories.length === 0 && (
          <div role="status" style={{ padding: 18, textAlign: 'center', color: 'var(--muted)' }}>{words.none}</div>
        )}
        {visibleCount < matchingCategories.length && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <button
              type="button"
              data-testid="category-show-more"
              onClick={() => setVisibleCount((n) => n + BATCH_SIZE)}
              style={{ height: 44, padding: '0 18px', background: '#FFF7EC', border: '1px solid #D7BB89', borderRadius: 12, cursor: 'pointer', fontWeight: 700, color: '#5B3A11' }}
            >
              {words.more} ({matchingCategories.length - visibleCount})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
