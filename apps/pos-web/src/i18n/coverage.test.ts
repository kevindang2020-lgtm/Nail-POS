// round 10 (Localization 04): the coverage report counts from the catalogues — missing, likely-untranslated, error messages.
import { describe, it, expect } from 'vitest';
import { translationCoverage } from './coverage';

describe('translationCoverage', () => {
  it('counts missing Vietnamese, English left as-is (brand / codes excluded) and error messages without Vietnamese', () => {
    const r = translationCoverage(
      [{ 'a.save': 'Save', 'a.brand': 'AIPowerSalon', 'a.count': '{n} items', 'errors.denied': 'Your role cannot do this.', 'errors.gone': 'Not found.', 'a.code': 'OK' }],
      [{ 'a.save': 'Lưu', 'a.brand': 'AIPowerSalon', 'a.count': '{n} items', 'errors.denied': 'Vai trò của bạn không làm được việc này.', 'errors.gone': '' }]);
    expect(r).toMatchObject({ total: 6, translated: 4, missingVi: ['a.code', 'errors.gone'], sameAsEnglish: ['a.count'], errorsTotal: 2, errorsMissing: ['errors.gone'] });
    expect(r.percent).toBe(66.6);
  });
  it('runs on the real POS catalogues: every key is either translated or listed — the numbers add up', () => {
    const r = translationCoverage();
    expect(r.total).toBeGreaterThan(1000);
    expect(r.translated + r.missingVi.length).toBe(r.total);
    expect(r.percent).toBeGreaterThan(90);
  });
});
