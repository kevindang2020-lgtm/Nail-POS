import { describe, it, expect } from 'vitest';
import { validateGlobalPromptInput, nextPromptVersion } from './ai-global-prompt-core';

describe('ai-global-prompt engine', () => {
  it('requires key (lowercase/underscore), name, and body', () => {
    const e = validateGlobalPromptInput({ promptKey: 'Bad Key', name: '', body: '' });
    expect(e.errors.some((x) => x.includes('lowercase'))).toBe(true);
    expect(e.errors).toContain('A name is required.');
    expect(e.errors).toContain('Prompt body cannot be empty.');
  });

  it('accepts a valid prompt', () => {
    expect(validateGlobalPromptInput({ promptKey: 'smart_reminders', name: 'Smart Reminders', body: 'You are…' }).errors).toHaveLength(0);
  });

  it('rejects an invalid status', () => {
    expect(validateGlobalPromptInput({ promptKey: 'x', name: 'X', body: 'b', status: 'nope' }).errors).toContain('Invalid status.');
  });

  it('bumps version monotonically', () => {
    expect(nextPromptVersion(1)).toBe(2);
    expect(nextPromptVersion(0)).toBe(2);
  });
});
