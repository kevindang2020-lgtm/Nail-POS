// Verifies the canonical AI module registry against the REAL package catalog, so the spec↔catalog alias map
// can never silently drift: every non-null catalogCode must exist in AI_PACKAGE_CODES, all 15 canonical codes
// are present and unique, and the round-trip mapping holds.
import { describe, it, expect } from 'vitest';
import { AI_PACKAGE_CODES } from './ai-catalog';
import {
  CANONICAL_AI_MODULES, CANONICAL_AI_MODULE_CODES,
  canonicalToCatalog, catalogToCanonical, extraCatalogPackages,
} from './ai-module-registry';

const SPEC_CODES = [
  'ai_booking', 'ai_phone', 'ai_business', 'ai_marketing', 'ai_customer_profile',
  'ai_checkout_upsell', 'ai_money_protection', 'ai_inventory', 'ai_review_reputation',
  'ai_voice_transcription', 'ai_ocr_receipt', 'ai_analytics_forecasting',
  'ai_deposit_reconciliation', 'ai_queue_assignment', 'ai_scheduling_optimizer',
];

describe('canonical AI module registry', () => {
  it('defines exactly the 15 canonical spec codes, unique', () => {
    expect(CANONICAL_AI_MODULE_CODES.length).toBe(15);
    expect(new Set(CANONICAL_AI_MODULE_CODES).size).toBe(15);
    expect([...CANONICAL_AI_MODULE_CODES].sort()).toEqual([...SPEC_CODES].sort());
  });

  it('every non-null catalogCode is a REAL package in ai-catalog (no drift)', () => {
    for (const m of CANONICAL_AI_MODULES) {
      if (m.catalogCode) expect(AI_PACKAGE_CODES).toContain(m.catalogCode);
    }
  });

  it('catalog aliases round-trip', () => {
    for (const m of CANONICAL_AI_MODULES) {
      if (m.catalogCode) {
        expect(canonicalToCatalog(m.code)).toBe(m.catalogCode);
        expect(catalogToCanonical(m.catalogCode)).toBe(m.code);
      }
    }
  });

  it('deposit reconciliation is mapped as a non-package module (catalogCode null)', () => {
    expect(canonicalToCatalog('ai_deposit_reconciliation')).toBeNull();
  });

  it('surfaces catalog packages outside the canonical 15 (e.g. ai_reception_copilot)', () => {
    // documents, rather than hides, the extra billable package(s)
    expect(extraCatalogPackages()).toContain('ai_reception_copilot');
  });

  it('every canonical module names a backend module directory', () => {
    for (const m of CANONICAL_AI_MODULES) {
      expect(m.backendModule).toMatch(/^[a-z-]+$/);
    }
  });
});
