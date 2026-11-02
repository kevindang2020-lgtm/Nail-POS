// Security Deep Scan D8: the ONE LIKE escaper — %, _ and a trailing backslash are literal (a trailing "\" used to be a 500).
import { describe, it, expect } from 'vitest';
import { escapeLike } from './list-query';
describe('escapeLike', () => {
  it('escapes wildcard characters and the escape character itself', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('plain text')).toBe('plain text');
  });
});
