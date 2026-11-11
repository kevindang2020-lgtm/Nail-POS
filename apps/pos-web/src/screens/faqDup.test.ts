import { describe, it, expect } from 'vitest';
import { similarFaqs } from './faqDup';
const items = [{ id: 'f1', question: 'Do you take walk-ins?', status: 'published' }, { id: 'f2', question: 'What are your Sunday hours?', status: 'draft' }, { id: 'f3', question: 'Is parking free?', status: 'archived' }];
describe('similarFaqs', () => {
  it('flags the same question in other words; ignores unrelated and archived ones', () => {
    expect(similarFaqs('Can I walk-in without booking?', items).map((x) => x.id)).toEqual([]);
    expect(similarFaqs('Do you accept walk-ins?', items).map((x) => x.id)).toEqual(['f1']);
    expect(similarFaqs('Sunday hours?', items).map((x) => x.id)).toEqual(['f2']);
    expect(similarFaqs('Is parking free at the salon?', items)).toEqual([]);
    expect(similarFaqs('Hi', items)).toEqual([]);
  });
});
