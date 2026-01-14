/**
 * Tests for memory resolution utilities
 * These tests verify the resolution strategy and priority order
 */

// Mock Supabase
const mockSupabase = {
  from: jest.fn()
};

jest.mock('../services/supabase.js', () => ({
  default: mockSupabase
}));

// Test the resolution priority algorithm without database
describe('Memory Resolution Priority', () => {
  // Resolution priorities: ASIN > SKU > FINGERPRINT
  const RESOLUTION_METHODS = {
    ASIN: 1,
    SKU: 2,
    FINGERPRINT: 3
  };

  function getBestResolution(matches) {
    if (!matches || matches.length === 0) return null;

    // Sort by resolution priority (lower number = higher priority)
    const sorted = [...matches].sort((a, b) =>
      (RESOLUTION_METHODS[a.method] || 99) - (RESOLUTION_METHODS[b.method] || 99)
    );

    return sorted[0];
  }

  test('prefers ASIN match over SKU match', () => {
    const matches = [
      { id: 'mem-1', method: 'SKU', bom_id: 'bom-1' },
      { id: 'mem-2', method: 'ASIN', bom_id: 'bom-2' }
    ];

    const result = getBestResolution(matches);
    expect(result.method).toBe('ASIN');
    expect(result.id).toBe('mem-2');
  });

  test('prefers SKU match over FINGERPRINT match', () => {
    const matches = [
      { id: 'mem-1', method: 'FINGERPRINT', bom_id: 'bom-1' },
      { id: 'mem-2', method: 'SKU', bom_id: 'bom-2' }
    ];

    const result = getBestResolution(matches);
    expect(result.method).toBe('SKU');
  });

  test('returns null for empty matches', () => {
    expect(getBestResolution([])).toBe(null);
    expect(getBestResolution(null)).toBe(null);
  });

  test('returns single match regardless of method', () => {
    const matches = [{ id: 'mem-1', method: 'FINGERPRINT', bom_id: 'bom-1' }];
    const result = getBestResolution(matches);
    expect(result.method).toBe('FINGERPRINT');
  });
});

describe('Identity Normalization for Resolution', () => {
  // Simulate the normalization functions
  function normalizeAsin(asin) {
    if (!asin || typeof asin !== 'string') return null;
    const normalized = asin.toUpperCase().trim();
    return normalized.length > 0 ? normalized : null;
  }

  function normalizeSku(sku) {
    if (!sku || typeof sku !== 'string') return null;
    const normalized = sku.toUpperCase().trim();
    return normalized.length > 0 ? normalized : null;
  }

  function fingerprintTitle(title) {
    if (!title || typeof title !== 'string') return null;
    // Remove special chars, lowercase, collapse spaces
    const fingerprint = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return fingerprint.length > 0 ? fingerprint : null;
  }

  describe('ASIN normalization', () => {
    test('normalizes mixed case', () => {
      expect(normalizeAsin('b07xyz123')).toBe('B07XYZ123');
    });

    test('handles whitespace', () => {
      expect(normalizeAsin('  B07XYZ123  ')).toBe('B07XYZ123');
    });

    test('returns null for invalid input', () => {
      expect(normalizeAsin('')).toBe(null);
      expect(normalizeAsin(null)).toBe(null);
      expect(normalizeAsin(undefined)).toBe(null);
    });
  });

  describe('SKU normalization', () => {
    test('normalizes case', () => {
      expect(normalizeSku('mak-dhp481')).toBe('MAK-DHP481');
    });

    test('preserves special characters', () => {
      expect(normalizeSku('mak/dhp_481')).toBe('MAK/DHP_481');
    });
  });

  describe('Title fingerprinting', () => {
    test('removes punctuation', () => {
      expect(fingerprintTitle('Makita - DHP481 (Kit)')).toBe('makita dhp481 kit');
    });

    test('produces consistent fingerprints for similar titles', () => {
      const title1 = 'Makita DHP481 18V LXT';
      const title2 = 'MAKITA DHP481 - 18V LXT';
      expect(fingerprintTitle(title1)).toBe(fingerprintTitle(title2));
    });

    test('different titles produce different fingerprints', () => {
      const title1 = 'Makita DHP481 Body Only';
      const title2 = 'Makita DHP481 With Batteries';
      expect(fingerprintTitle(title1)).not.toBe(fingerprintTitle(title2));
    });
  });
});

describe('Resolution Conflict Handling', () => {
  // Test conflict detection logic
  function hasConflict(matches) {
    if (!matches || matches.length <= 1) return false;

    const bomIds = [...new Set(matches.map(m => m.bom_id).filter(Boolean))];
    return bomIds.length > 1;
  }

  test('no conflict with single match', () => {
    const matches = [{ id: 'mem-1', bom_id: 'bom-1' }];
    expect(hasConflict(matches)).toBe(false);
  });

  test('no conflict when all matches point to same BOM', () => {
    const matches = [
      { id: 'mem-1', method: 'ASIN', bom_id: 'bom-1' },
      { id: 'mem-2', method: 'SKU', bom_id: 'bom-1' }
    ];
    expect(hasConflict(matches)).toBe(false);
  });

  test('detects conflict when matches point to different BOMs', () => {
    const matches = [
      { id: 'mem-1', method: 'ASIN', bom_id: 'bom-1' },
      { id: 'mem-2', method: 'SKU', bom_id: 'bom-2' }
    ];
    expect(hasConflict(matches)).toBe(true);
  });

  test('ignores matches without bom_id in conflict detection', () => {
    const matches = [
      { id: 'mem-1', method: 'ASIN', bom_id: 'bom-1' },
      { id: 'mem-2', method: 'SKU', bom_id: null }
    ];
    expect(hasConflict(matches)).toBe(false);
  });
});

describe('Listing Memory Active Status', () => {
  // Resolution should only consider active memory entries
  function filterActiveEntries(entries) {
    return (entries || []).filter(e => e.is_active !== false);
  }

  test('filters out inactive entries', () => {
    const entries = [
      { id: 'mem-1', is_active: true, bom_id: 'bom-1' },
      { id: 'mem-2', is_active: false, bom_id: 'bom-2' },
      { id: 'mem-3', is_active: true, bom_id: 'bom-3' }
    ];

    const active = filterActiveEntries(entries);
    expect(active).toHaveLength(2);
    expect(active.map(e => e.id)).toEqual(['mem-1', 'mem-3']);
  });

  test('includes entries where is_active is undefined (default active)', () => {
    const entries = [
      { id: 'mem-1', bom_id: 'bom-1' }, // is_active not set
      { id: 'mem-2', is_active: false, bom_id: 'bom-2' }
    ];

    const active = filterActiveEntries(entries);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('mem-1');
  });
});

describe('Supersession Logic', () => {
  // When a listing is superseded, old entry becomes inactive, new one is active
  function supersedeListing(oldEntry, newData) {
    return {
      oldEntry: { ...oldEntry, is_active: false },
      newEntry: {
        ...newData,
        is_active: true,
        supersedes_id: oldEntry.id
      }
    };
  }

  test('marks old entry as inactive', () => {
    const oldEntry = { id: 'mem-1', bom_id: 'bom-1', is_active: true };
    const newData = { bom_id: 'bom-2' };

    const result = supersedeListing(oldEntry, newData);
    expect(result.oldEntry.is_active).toBe(false);
  });

  test('creates new entry with supersedes reference', () => {
    const oldEntry = { id: 'mem-1', bom_id: 'bom-1' };
    const newData = { bom_id: 'bom-2', asin: 'B123456789' };

    const result = supersedeListing(oldEntry, newData);
    expect(result.newEntry.supersedes_id).toBe('mem-1');
    expect(result.newEntry.is_active).toBe(true);
    expect(result.newEntry.bom_id).toBe('bom-2');
    expect(result.newEntry.asin).toBe('B123456789');
  });
});
