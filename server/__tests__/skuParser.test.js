/**
 * Unit tests for SKU Parser utility
 */
import {
  parseCompoundSku,
  isCompoundSku,
  matchParsedSkuToComponents,
  parseAndMatchSku,
  generateBundleSku,
} from '../utils/skuParser.js';

describe('SKU Parser', () => {
  describe('parseCompoundSku', () => {
    it('should parse SKU with + delimiter', () => {
      const result = parseCompoundSku('DHR242Z+BL1850+DC18RC');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 1 },
        { sku: 'DC18RC', qty: 1 },
      ]);
    });

    it('should parse SKU with / delimiter', () => {
      const result = parseCompoundSku('DHR242Z/BL1850/DC18RC');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 1 },
        { sku: 'DC18RC', qty: 1 },
      ]);
    });

    it('should handle quantity prefix (2x)', () => {
      const result = parseCompoundSku('DHR242Z+2xBL1850+DC18RC');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 2 },
        { sku: 'DC18RC', qty: 1 },
      ]);
    });

    it('should handle quantity prefix with uppercase X (2X)', () => {
      const result = parseCompoundSku('DHR242Z+2XBL1850');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 2 },
      ]);
    });

    it('should handle quantity suffix (x2)', () => {
      const result = parseCompoundSku('DHR242Z+BL1850x2+DC18RC');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 2 },
        { sku: 'DC18RC', qty: 1 },
      ]);
    });

    it('should strip MAK manufacturer prefix', () => {
      const result = parseCompoundSku('MAKDHR242Z+MAKBL1850');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 1 },
      ]);
    });

    it('should strip DEW manufacturer prefix', () => {
      const result = parseCompoundSku('DEWDCD791+DEWDCB184');
      expect(result).toEqual([
        { sku: 'DCD791', qty: 1 },
        { sku: 'DCB184', qty: 1 },
      ]);
    });

    it('should normalize to uppercase', () => {
      const result = parseCompoundSku('dhr242z+bl1850');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 1 },
      ]);
    });

    it('should handle whitespace around parts', () => {
      const result = parseCompoundSku(' DHR242Z + BL1850 + DC18RC ');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 1 },
        { sku: 'DC18RC', qty: 1 },
      ]);
    });

    it('should return empty array for null input', () => {
      expect(parseCompoundSku(null)).toEqual([]);
    });

    it('should return empty array for non-string input', () => {
      expect(parseCompoundSku(123)).toEqual([]);
    });

    it('should return single part for simple SKU', () => {
      const result = parseCompoundSku('DHR242Z');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
      ]);
    });

    it('should handle complex example from spec', () => {
      const result = parseCompoundSku('MAKDHR242Z+2xBL1850+DC18RC');
      expect(result).toEqual([
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 2 },
        { sku: 'DC18RC', qty: 1 },
      ]);
    });
  });

  describe('isCompoundSku', () => {
    it('should return true for SKU with + delimiter', () => {
      expect(isCompoundSku('DHR242Z+BL1850')).toBe(true);
    });

    it('should return true for SKU with / delimiter', () => {
      expect(isCompoundSku('DHR242Z/BL1850')).toBe(true);
    });

    it('should return true for SKU with quantity prefix', () => {
      expect(isCompoundSku('2xBL1850')).toBe(true);
    });

    it('should return true for SKU with quantity suffix', () => {
      expect(isCompoundSku('BL1850x2')).toBe(true);
    });

    it('should return false for simple SKU', () => {
      expect(isCompoundSku('DHR242Z')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isCompoundSku(null)).toBe(false);
    });

    it('should return false for non-string', () => {
      expect(isCompoundSku(123)).toBe(false);
    });
  });

  describe('matchParsedSkuToComponents', () => {
    const mockComponents = [
      { id: 'comp1', internal_sku: 'DHR242Z' },
      { id: 'comp2', internal_sku: 'BL1850' },
      { id: 'comp3', internal_sku: 'DC18RC' },
      { id: 'comp4', internal_sku: 'DCD791' },
    ];

    it('should match exact SKUs', () => {
      const parsed = [
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'BL1850', qty: 2 },
      ];
      const result = matchParsedSkuToComponents(parsed, mockComponents);
      expect(result).toEqual([
        {
          component_id: 'comp1',
          internal_sku: 'DHR242Z',
          qty_required: 1,
          match_type: 'EXACT',
          parsed_sku: 'DHR242Z',
        },
        {
          component_id: 'comp2',
          internal_sku: 'BL1850',
          qty_required: 2,
          match_type: 'EXACT',
          parsed_sku: 'BL1850',
        },
      ]);
    });

    it('should match with trailing Z variation', () => {
      const componentsWithoutZ = [
        { id: 'comp1', internal_sku: 'DHR242' },
      ];
      const parsed = [{ sku: 'DHR242Z', qty: 1 }];
      const result = matchParsedSkuToComponents(parsed, componentsWithoutZ);
      expect(result[0]).toMatchObject({
        component_id: 'comp1',
        match_type: 'VARIATION',
      });
    });

    it('should return null for unmatched parts', () => {
      const parsed = [
        { sku: 'DHR242Z', qty: 1 },
        { sku: 'UNKNOWN123', qty: 1 },
      ];
      const result = matchParsedSkuToComponents(parsed, mockComponents);
      expect(result[0]).not.toBeNull();
      expect(result[1]).toBeNull();
    });

    it('should handle empty parsed array', () => {
      expect(matchParsedSkuToComponents([], mockComponents)).toEqual([]);
    });

    it('should handle empty components array', () => {
      const parsed = [{ sku: 'DHR242Z', qty: 1 }];
      expect(matchParsedSkuToComponents(parsed, [])).toEqual([]);
    });

    it('should match case-insensitively', () => {
      const lowerComponents = [
        { id: 'comp1', internal_sku: 'dhr242z' },
      ];
      const parsed = [{ sku: 'DHR242Z', qty: 1 }];
      const result = matchParsedSkuToComponents(parsed, lowerComponents);
      expect(result[0]).toMatchObject({
        component_id: 'comp1',
        match_type: 'EXACT',
      });
    });
  });

  describe('parseAndMatchSku', () => {
    const mockComponents = [
      { id: 'comp1', internal_sku: 'DHR242Z' },
      { id: 'comp2', internal_sku: 'BL1850' },
      { id: 'comp3', internal_sku: 'DC18RC' },
    ];

    it('should parse and match all components', () => {
      const result = parseAndMatchSku('DHR242Z+2xBL1850+DC18RC', mockComponents);
      expect(result.allMatched).toBe(true);
      expect(result.matchedCount).toBe(3);
      expect(result.totalParts).toBe(3);
    });

    it('should report partial matches correctly', () => {
      const result = parseAndMatchSku('DHR242Z+UNKNOWN123', mockComponents);
      expect(result.allMatched).toBe(false);
      expect(result.matchedCount).toBe(1);
      expect(result.totalParts).toBe(2);
    });

    it('should handle empty SKU', () => {
      const result = parseAndMatchSku('', mockComponents);
      expect(result.allMatched).toBe(false);
      expect(result.totalParts).toBe(0);
    });
  });

  describe('generateBundleSku', () => {
    it('should generate bundle SKU from matched components', () => {
      const matched = [
        { internal_sku: 'DHR242Z', qty_required: 1 },
        { internal_sku: 'BL1850', qty_required: 2 },
        { internal_sku: 'DC18RC', qty_required: 1 },
      ];
      const result = generateBundleSku(matched);
      expect(result).toBe('DHR242Z+2xBL1850+DC18RC');
    });

    it('should not add quantity prefix for qty=1', () => {
      const matched = [
        { internal_sku: 'DHR242Z', qty_required: 1 },
        { internal_sku: 'BL1850', qty_required: 1 },
      ];
      const result = generateBundleSku(matched);
      expect(result).toBe('DHR242Z+BL1850');
    });

    it('should return empty string for empty input', () => {
      expect(generateBundleSku([])).toBe('');
      expect(generateBundleSku(null)).toBe('');
    });
  });
});
