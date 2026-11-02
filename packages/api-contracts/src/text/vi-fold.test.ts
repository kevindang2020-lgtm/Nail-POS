import { describe, it, expect } from 'vitest';
import { foldVi, viIncludes } from './vi-fold';

// Vietnamese POS mandate §41 (WP-E): one fold, used client- and server-side. The SQL twin's parity with this function is
// proven in apps/api/src/pos/vi-search.pgtest.vitest.spec.ts.

const NAMES: Array<[string, string]> = [
  ['Nguyễn', 'nguyen'],
  ['Đặng', 'dang'],
  ['Nguyễn Thị Hương', 'nguyen thi huong'],
  ['Đặng Minh Tuấn', 'dang minh tuan'],
  ['Trần Văn Ấn', 'tran van an'],
  ['Lê Thị Bích Ngọc', 'le thi bich ngoc'],
  ['Phạm Quỳnh Như', 'pham quynh nhu'],
  ['Hoàng Đức Thắng', 'hoang duc thang'],
  ['Huỳnh Thị Mỹ Duyên', 'huynh thi my duyen'],
  ['Võ Thị Ánh Tuyết', 'vo thi anh tuyet'],
  ['Bùi Xuân Trường', 'bui xuan truong'],
  ['Đỗ Thị Hồng Nhung', 'do thi hong nhung'],
  ['Ngô Gia Bảo', 'ngo gia bao'],
  ['Dương Thùy Linh', 'duong thuy linh'],
  ['Lý Thường Kiệt', 'ly thuong kiet'],
  ['Tạ Thị Yến', 'ta thi yen'],
  ['Châu Ngọc Ước', 'chau ngoc uoc'],
  ['ĐOÀN THỊ ỬNG', 'doan thi ung'],
  ['Olivia Brown', 'olivia brown'],
  ['Gel Móng Tay Đắp Bột', 'gel mong tay dap bot'],
];

// Every Vietnamese letter (§38 alphabet): 12 vowels × 6 tones, both cases, plus đ/Đ.
const VOWELS = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y'];
const TONES = ['', '̀', '́', '̉', '̃', '̣'];   // ngang, huyền, sắc, hỏi, ngã, nặng
const BASE: Record<string, string> = { ă: 'a', â: 'a', ê: 'e', ô: 'o', ơ: 'o', ư: 'u' };

describe('foldVi — Vietnamese name list', () => {
  it.each(NAMES)('%s → %s', (input, folded) => { expect(foldVi(input)).toBe(folded); });

  it('folds every Vietnamese vowel with every tone, in both cases, to its ASCII base', () => {
    for (const v of VOWELS) for (const t of TONES) {
      const lower = (v + t).normalize('NFC');
      const want = BASE[v] ?? v;
      expect(foldVi(lower)).toBe(want);
      expect(foldVi(lower.toUpperCase())).toBe(want);
    }
    expect(foldVi('đ')).toBe('d');
    expect(foldVi('Đ')).toBe('d');
  });

  it('a name stored decomposed (NFD, as some keyboards send it) folds the same as its precomposed form', () => {
    expect(foldVi('Nguyễn'.normalize('NFD'))).toBe('nguyen');
    expect(foldVi('Đặng'.normalize('NFD'))).toBe(foldVi('Đặng'.normalize('NFC')));
  });

  it('collapses whitespace runs and trims the ends', () => {
    expect(foldVi('  Trần   Văn\tẤn \n')).toBe('tran van an');
  });

  it('is idempotent and tolerates null / undefined', () => {
    for (const [n] of NAMES) expect(foldVi(foldVi(n))).toBe(foldVi(n));
    expect(foldVi(null)).toBe('');
    expect(foldVi(undefined)).toBe('');
  });

  it('never changes the stored value — it returns a new key', () => {
    const stored = 'Nguyễn Thị Hương';
    foldVi(stored);
    expect(stored).toBe('Nguyễn Thị Hương');
  });
});

describe('viIncludes', () => {
  it('matches unaccented and accented queries against an accented name', () => {
    expect(viIncludes('Nguyễn Thị Hương', 'nguyen')).toBe(true);
    expect(viIncludes('Nguyễn Thị Hương', 'Nguyễn')).toBe(true);
    expect(viIncludes('Nguyễn Thị Hương', 'thi huong')).toBe(true);
    expect(viIncludes('Đặng Minh Tuấn', 'dang')).toBe(true);
    expect(viIncludes('Đặng Minh Tuấn', 'DANG')).toBe(true);
    expect(viIncludes('Đặng Minh Tuấn', 'nguyen')).toBe(false);
  });
  it('an empty query matches everything (the caller decides whether to search at all)', () => {
    expect(viIncludes('anything', '')).toBe(true);
  });
});
