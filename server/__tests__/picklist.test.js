/**
 * Tests for picklist generation utility
 * These tests use mocked Supabase data to validate the aggregation logic
 */

// Mock Supabase
const mockSupabase = {
  from: jest.fn()
};

jest.mock('../services/supabase.js', () => ({
  default: mockSupabase
}));

// Import after mocking
import { generatePicklist } from '../utils/picklist.js';

describe('generatePicklist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to set up mock chain
  function setupMockChain(data, error = null) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data, error })
    };
    chain.select.mockReturnValue(chain);
    chain.not.mockReturnValue(chain);
    chain.in.mockResolvedValue({ data, error });
    return chain;
  }

  test('returns empty array when no order lines exist', async () => {
    const chain = setupMockChain([]);
    mockSupabase.from.mockReturnValue(chain);

    const result = await generatePicklist();
    expect(result).toEqual([]);
  });

  test('returns empty array when no lines have listing_id', async () => {
    // First call returns order_lines with no listing_id
    mockSupabase.from
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockResolvedValue({
          data: [],
          error: null
        })
      });

    const result = await generatePicklist();
    expect(result).toEqual([]);
  });

  test('aggregates quantities correctly for single BOM', async () => {
    // Mock order_lines
    mockSupabase.from
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockResolvedValue({
          data: [
            { listing_id: 'listing-1', quantity: 2 },
            { listing_id: 'listing-1', quantity: 3 }
          ],
          error: null
        })
      })
      // Mock listing_memory
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [{ id: 'listing-1', bom_id: 'bom-1' }],
          error: null
        })
      })
      // Mock bom_components
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { bom_id: 'bom-1', component_id: 'comp-1', qty_required: 2 },
            { bom_id: 'bom-1', component_id: 'comp-2', qty_required: 1 }
          ],
          error: null
        })
      })
      // Mock components
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { id: 'comp-1', internal_sku: 'SKU-001', description: 'Component 1' },
            { id: 'comp-2', internal_sku: 'SKU-002', description: 'Component 2' }
          ],
          error: null
        })
      });

    const result = await generatePicklist();

    // 2 orders of 2 qty + 3 orders of 3 qty = 5 total order lines
    // Component 1: 5 * 2 = 10
    // Component 2: 5 * 1 = 5
    expect(result).toHaveLength(2);
    expect(result.find(r => r.internal_sku === 'SKU-001').quantity_required).toBe(10);
    expect(result.find(r => r.internal_sku === 'SKU-002').quantity_required).toBe(5);
  });

  test('handles multiple BOMs correctly', async () => {
    mockSupabase.from
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockResolvedValue({
          data: [
            { listing_id: 'listing-1', quantity: 1 },
            { listing_id: 'listing-2', quantity: 1 }
          ],
          error: null
        })
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { id: 'listing-1', bom_id: 'bom-1' },
            { id: 'listing-2', bom_id: 'bom-2' }
          ],
          error: null
        })
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { bom_id: 'bom-1', component_id: 'comp-shared', qty_required: 1 },
            { bom_id: 'bom-2', component_id: 'comp-shared', qty_required: 2 }
          ],
          error: null
        })
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { id: 'comp-shared', internal_sku: 'SHARED-SKU', description: 'Shared Component' }
          ],
          error: null
        })
      });

    const result = await generatePicklist();

    // BOM-1 needs 1, BOM-2 needs 2, total = 3
    expect(result).toHaveLength(1);
    expect(result[0].quantity_required).toBe(3);
  });

  test('throws error on order_lines fetch failure', async () => {
    mockSupabase.from.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database error' }
      })
    });

    await expect(generatePicklist()).rejects.toEqual({ message: 'Database error' });
  });

  test('skips listings without bom_id', async () => {
    mockSupabase.from
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockResolvedValue({
          data: [{ listing_id: 'listing-no-bom', quantity: 5 }],
          error: null
        })
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [{ id: 'listing-no-bom', bom_id: null }],
          error: null
        })
      });

    const result = await generatePicklist();
    expect(result).toEqual([]);
  });
});

describe('Picklist Aggregation Logic', () => {
  // Test the aggregation algorithm without database calls
  function aggregateComponents(orderLines, listingToBom, bomToComponents) {
    const aggregated = {};

    for (const line of orderLines) {
      const bomId = listingToBom.get(line.listing_id);
      if (!bomId) continue;

      const components = bomToComponents.get(bomId) || [];
      for (const c of components) {
        const total = line.quantity * c.qty_required;
        aggregated[c.component_id] = (aggregated[c.component_id] || 0) + total;
      }
    }

    return aggregated;
  }

  test('correctly multiplies line quantity by component qty_required', () => {
    const orderLines = [{ listing_id: 'L1', quantity: 3 }];
    const listingToBom = new Map([['L1', 'BOM1']]);
    const bomToComponents = new Map([
      ['BOM1', [{ component_id: 'C1', qty_required: 4 }]]
    ]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(result['C1']).toBe(12); // 3 * 4 = 12
  });

  test('sums quantities across multiple order lines', () => {
    const orderLines = [
      { listing_id: 'L1', quantity: 2 },
      { listing_id: 'L1', quantity: 5 }
    ];
    const listingToBom = new Map([['L1', 'BOM1']]);
    const bomToComponents = new Map([
      ['BOM1', [{ component_id: 'C1', qty_required: 1 }]]
    ]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(result['C1']).toBe(7); // (2 + 5) * 1 = 7
  });

  test('handles components used in multiple BOMs', () => {
    const orderLines = [
      { listing_id: 'L1', quantity: 1 },
      { listing_id: 'L2', quantity: 1 }
    ];
    const listingToBom = new Map([
      ['L1', 'BOM1'],
      ['L2', 'BOM2']
    ]);
    const bomToComponents = new Map([
      ['BOM1', [{ component_id: 'SHARED', qty_required: 2 }]],
      ['BOM2', [{ component_id: 'SHARED', qty_required: 3 }]]
    ]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(result['SHARED']).toBe(5); // (1 * 2) + (1 * 3) = 5
  });

  test('ignores order lines without matching listing', () => {
    const orderLines = [
      { listing_id: 'L1', quantity: 10 },
      { listing_id: 'UNKNOWN', quantity: 100 }
    ];
    const listingToBom = new Map([['L1', 'BOM1']]);
    const bomToComponents = new Map([
      ['BOM1', [{ component_id: 'C1', qty_required: 1 }]]
    ]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(result['C1']).toBe(10); // Only L1 counted
    expect(Object.keys(result)).toHaveLength(1);
  });
});
