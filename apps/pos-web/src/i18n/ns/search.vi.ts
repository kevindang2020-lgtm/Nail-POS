// ns/search.vi.ts — the POS "search" namespace, Vietnamese. Typed against the English keys (a missing key is a type error; the
// check-i18n gate refuses an empty value or a lost {placeholder}). New strings go into docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
import type { SEARCH_EN } from './search.en';
export const SEARCH_VI: Record<keyof typeof SEARCH_EN, string> = {
  'search.group.queue': 'Tiếp nhận & Hàng chờ',
};
