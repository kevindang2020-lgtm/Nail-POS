// ns/nav.vi.ts — the POS "nav" namespace, Vietnamese. Typed against the English keys (a missing key is a type error; the
// check-i18n gate refuses an empty value or a lost {placeholder}). New strings are listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
import type { NAV_EN } from './nav.en';
export const NAV_VI: Record<keyof typeof NAV_EN, string> = {
  'nav.language.menu': 'Ngôn ngữ: {current}',
  'nav.section.team': 'NHÂN VIÊN',
  'nav.language.saveFailed': 'Không lưu được ngôn ngữ của bạn. Đã chuyển lại {previous}.',
};
