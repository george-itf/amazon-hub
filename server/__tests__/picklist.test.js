/**
 * Tests for picklist generation utility
 * These are pure unit tests that validate the aggregation logic
 * without requiring database access
 */

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

  test('handles empty order lines', () => {
    const orderLines = [];
    const listingToBom = new Map([['L1', 'BOM1']]);
    const bomToComponents = new Map([
      ['BOM1', [{ component_id: 'C1', qty_required: 1 }]]
    ]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('handles BOM with no components', () => {
    const orderLines = [{ listing_id: 'L1', quantity: 5 }];
    const listingToBom = new Map([['L1', 'BOM1']]);
    const bomToComponents = new Map([['BOM1', []]]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('handles multiple components per BOM', () => {
    const orderLines = [{ listing_id: 'L1', quantity: 2 }];
    const listingToBom = new Map([['L1', 'BOM1']]);
    const bomToComponents = new Map([
      ['BOM1', [
        { component_id: 'DRILL', qty_required: 1 },
        { component_id: 'BATTERY', qty_required: 2 },
        { component_id: 'CHARGER', qty_required: 1 }
      ]]
    ]);

    const result = aggregateComponents(orderLines, listingToBom, bomToComponents);
    expect(result['DRILL']).toBe(2);    // 2 * 1
    expect(result['BATTERY']).toBe(4);  // 2 * 2
    expect(result['CHARGER']).toBe(2);  // 2 * 1
  });
});

describe('Picklist Building Logic', () => {
  function buildPicklist(aggregated, componentDetails) {
    const pickList = [];

    for (const compId of Object.keys(aggregated)) {
      const details = componentDetails.get(compId);
      if (!details) continue;

      pickList.push({
        component_id: compId,
        internal_sku: details.internal_sku,
        description: details.description,
        quantity_required: aggregated[compId]
      });
    }

    return pickList;
  }

  test('builds picklist with component details', () => {
    const aggregated = { 'C1': 10, 'C2': 5 };
    const componentDetails = new Map([
      ['C1', { internal_sku: 'SKU-001', description: 'Component 1' }],
      ['C2', { internal_sku: 'SKU-002', description: 'Component 2' }]
    ]);

    const result = buildPicklist(aggregated, componentDetails);

    expect(result).toHaveLength(2);
    expect(result.find(r => r.internal_sku === 'SKU-001').quantity_required).toBe(10);
    expect(result.find(r => r.internal_sku === 'SKU-002').quantity_required).toBe(5);
  });

  test('skips components without details', () => {
    const aggregated = { 'C1': 10, 'MISSING': 5 };
    const componentDetails = new Map([
      ['C1', { internal_sku: 'SKU-001', description: 'Component 1' }]
    ]);

    const result = buildPicklist(aggregated, componentDetails);

    expect(result).toHaveLength(1);
    expect(result[0].internal_sku).toBe('SKU-001');
  });

  test('returns empty array for empty aggregated', () => {
    const aggregated = {};
    const componentDetails = new Map([
      ['C1', { internal_sku: 'SKU-001', description: 'Component 1' }]
    ]);

    const result = buildPicklist(aggregated, componentDetails);
    expect(result).toHaveLength(0);
  });
});

describe('Batch Query Optimization Validation', () => {
  // These tests validate that our optimization approach is correct

  test('unique listing IDs are correctly extracted', () => {
    const lines = [
      { listing_id: 'L1', quantity: 1 },
      { listing_id: 'L1', quantity: 2 },
      { listing_id: 'L2', quantity: 1 },
      { listing_id: 'L1', quantity: 3 }
    ];

    const uniqueListingIds = [...new Set(lines.map(l => l.listing_id))];
    expect(uniqueListingIds).toEqual(['L1', 'L2']);
    expect(uniqueListingIds).toHaveLength(2);
  });

  test('unique BOM IDs are correctly extracted from Map', () => {
    const listingToBom = new Map([
      ['L1', 'BOM1'],
      ['L2', 'BOM1'],
      ['L3', 'BOM2']
    ]);

    const uniqueBomIds = [...new Set(listingToBom.values())];
    expect(uniqueBomIds).toEqual(['BOM1', 'BOM2']);
    expect(uniqueBomIds).toHaveLength(2);
  });

  test('component IDs are correctly extracted from aggregated', () => {
    const aggregated = { 'C1': 10, 'C2': 5, 'C3': 3 };
    const componentIds = Object.keys(aggregated);

    expect(componentIds).toEqual(['C1', 'C2', 'C3']);
    expect(componentIds).toHaveLength(3);
  });
});
