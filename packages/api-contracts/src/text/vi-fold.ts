// vi-fold.ts — Vietnamese POS mandate §40–§42 (WP-E). The ONE accent-insensitive search key, used by client-side filters
// and server-side in-memory filters; its SQL twin is vi_fold(text) (apps/api/db/migrations/694_vi_search_fold.sql), which
// backs the POS search indexes. apps/api/src/pos/vi-search.pgtest.vitest.spec.ts proves foldVi(s) === vi_fold(s).
//   "Nguyễn Thị Hương" → "nguyen thi huong", "Đặng" → "dang", "  Trần   Văn " → "tran van"
// Steps: NFD (split every precomposed letter into base + combining marks) → drop the combining marks U+0300–U+036F →
// đ/Đ → d (đ has no decomposition, so NFD alone leaves it) → lower-case → collapse whitespace runs to one space → trim.
// Used ONLY to compare: stored names are never folded or rewritten (§42).

const COMBINING_MARKS = /[̀-ͯ]/g;
const D_STROKE = /[Đđ]/g;   // Đ đ
const WHITESPACE = /\s+/g;

export function foldVi(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(COMBINING_MARKS, '').replace(D_STROKE, 'd').toLowerCase().replace(WHITESPACE, ' ').trim();
}

/** True when `haystack` contains `needle` once both are folded — the client/in-memory twin of
 *  `vi_fold(column) LIKE '%' || vi_fold(query) || '%'`. An empty needle matches everything. */
export function viIncludes(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  return foldVi(haystack).includes(foldVi(needle));
}
