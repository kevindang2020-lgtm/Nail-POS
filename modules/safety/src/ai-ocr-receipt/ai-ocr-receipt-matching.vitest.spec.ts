// ai-ocr-receipt-matching.vitest.spec.ts — advisory vendor/category/inventory matching against tenant catalogs. Every
// result is a suggestion requiring human confirmation; nothing auto-merges, auto-applies a category, or auto-receives.
import { describe, it, expect } from 'vitest';
import { matchVendor, suggestCategory, matchInventoryLine, stringSimilarity } from './ai-ocr-receipt-matching';

describe('vendor matching', () => {
  const vendors = [{ vendorId: 'v1', name: 'Sally Beauty Supply' }, { vendorId: 'v2', name: 'CosmoProf' }, { vendorId: 'v3', name: 'Home Depot' }];
  it('grades matches and never auto-confirms', () => {
    expect(stringSimilarity('Sally Beauty Inc', 'SALLY BEAUTY')).toBeGreaterThanOrEqual(0.8);
    expect(matchVendor('Sally Beauty Supply', vendors).status).toBe('exact');
    expect(['strong', 'exact']).toContain(matchVendor('Sally Beauty', vendors).status);
    expect(matchVendor('Random Nail Distributor XYZ', vendors).status).toBe('new');
    expect(matchVendor(null, vendors).status).toBe('unknown');
    expect(matchVendor('Sally Beauty Supply', vendors).confirmed).toBe(false);
  });
});

describe('category suggestion', () => {
  const categories = [{ categoryId: 'c1', name: 'Nail Polish', keywords: ['polish', 'lacquer', 'gel'] }, { categoryId: 'c2', name: 'Utilities', keywords: ['electric', 'water', 'gas'] }];
  it('prefers vendor history, then keywords, always requires review', () => {
    const byHistory = suggestCategory({ vendor: 'PG&E', lineText: 'monthly service' }, { vendorHistory: [{ vendor: 'PG&E', categoryId: 'c2', name: 'Utilities' }], categories });
    expect(byHistory.suggestions[0].source).toBe('history');
    expect(suggestCategory({ vendor: 'Sally', lineText: 'OPI gel polish set' }, { categories }).suggestions.some((s) => s.categoryId === 'c1')).toBe(true);
    expect(suggestCategory({ vendor: null, lineText: null }, { categories: [] }).requiresReview).toBe(true);
    expect(suggestCategory({ vendor: 'X', lineText: 'misc' }, { categories, aiSuggestion: { categoryId: 'c1', name: 'Nail Polish', score: 0.7, reason: 'ai', source: 'ai' } }).suggestions.some((s) => s.source === 'ai')).toBe(true);
  });
});

describe('inventory matching', () => {
  const products = [{ productId: 'p1', name: 'Gel Polish Red 15ml', sku: 'GP-RED', upc: '0123' }, { productId: 'p2', name: 'Gel Polish Blue 15ml', sku: 'GP-BLU' }, { productId: 'p3', name: 'Acetone 1gal' }];
  it('matches by code then description, never auto-confirms', () => {
    expect(matchInventoryLine({ description: 'x', sku: 'GP-RED' }, products).status).toBe('exact');
    expect(matchInventoryLine({ description: 'x', upc: '0123' }, products).status).toBe('exact');
    expect(matchInventoryLine({ description: 'Acetone 1gal' }, products).status).toBe('probable');
    expect(matchInventoryLine({ description: null }, products).status).toBe('non_inventory');
    expect(matchInventoryLine({ description: 'Reception Desk Chair Deluxe' }, products).status).toBe('new');
    expect(matchInventoryLine({ description: 'x', sku: 'GP-RED' }, products).confirmed).toBe(false);
  });
});
