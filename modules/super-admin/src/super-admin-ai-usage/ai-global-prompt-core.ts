// Pure, DB-free engine for global AI prompts. Validates input and computes the next version. Editing a prompt bumps
// its version monotonically (an audit-friendly change record); status is constrained.

export interface GlobalPromptInput { promptKey?: string | null; name?: string | null; body?: string | null; status?: string | null }

export function validateGlobalPromptInput(input: GlobalPromptInput): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.promptKey ?? '').trim()) errors.push('A prompt key is required.');
  else if (!/^[a-z0-9_]+$/.test(String(input.promptKey))) errors.push('Prompt key must be lowercase letters, numbers, and underscores.');
  if (!String(input.name ?? '').trim()) errors.push('A name is required.');
  if (!String(input.body ?? '').trim()) errors.push('Prompt body cannot be empty.');
  if (input.status && !['active', 'draft', 'archived'].includes(String(input.status))) errors.push('Invalid status.');
  return { errors };
}

export const nextPromptVersion = (current: number): number => Math.max(1, Math.trunc(current)) + 1;
