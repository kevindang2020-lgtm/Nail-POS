// ai-business-assistant-history.ts — wire types for the A4 AI Business Assistant history + Check Business Data (Nov 6 2026).
export interface AssistantHistoryItem { id: string; question: string | null; intent: string | null; preset: string | null; period: { from: string; to: string } | null; answer: string | null; answeredBy: 'ai' | 'numbers_only' | 'clarification' | 'records'; at: string | null }
export interface AssistantHistoryResponse { page: number; limit: number; total: number; totalPages: number; retentionDays: number; items: AssistantHistoryItem[] }
export interface AssistantDataCheckResponse { id: string; overall: 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA'; checks: { key: string; component: string; state: string; count: number }[]; checkedAt: string | null; reused: boolean; changesAnything: false }
export interface AssistantHistoryDeleteResponse { ok: boolean }
