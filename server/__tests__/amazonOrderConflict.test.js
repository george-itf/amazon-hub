/**
 * Tests for Amazon Order Conflict Resolution
 * Tests the logic for detecting and handling Shopify/Amazon order conflicts
 * where the same order appears in both systems
 */

describe('Amazon Order ID Extraction', () => {
  // Amazon order IDs follow pattern: XXX-XXXXXXX-XXXXXXX
  const amazonOrderPattern = /\d{3}-\d{7}-\d{7}/;

  function extractAmazonOrderId(shopifyOrder) {
    // Check order notes
    if (shopifyOrder.note) {
      const match = shopifyOrder.note.match(amazonOrderPattern);
      if (match) return match[0];
    }

    // Check tags
    if (shopifyOrder.tags) {
      const match = shopifyOrder.tags.match(amazonOrderPattern);
      if (match) return match[0];
    }

    // Check order name
    if (shopifyOrder.name) {
      const match = shopifyOrder.name.match(amazonOrderPattern);
      if (match) return match[0];
    }

    // Check line item properties
    for (const lineItem of shopifyOrder.line_items || []) {
      for (const prop of lineItem.properties || []) {
        if (prop.name?.toLowerCase().includes('amazon') && prop.name?.toLowerCase().includes('order')) {
          const match = prop.value?.match(amazonOrderPattern);
          if (match) return match[0];
        }
        if (prop.value) {
          const match = prop.value.match(amazonOrderPattern);
          if (match) return match[0];
        }
      }
    }

    // Check note_attributes
    for (const attr of shopifyOrder.note_attributes || []) {
      if (attr.name?.toLowerCase().includes('amazon')) {
        const match = attr.value?.match(amazonOrderPattern);
        if (match) return match[0];
      }
    }

    return null;
  }

  test('extracts Amazon order ID from order note', () => {
    const order = {
      note: 'Amazon Order: 206-1234567-8901234'
    };
    expect(extractAmazonOrderId(order)).toBe('206-1234567-8901234');
  });

  test('extracts Amazon order ID from tags', () => {
    const order = {
      tags: 'amazon, 206-1234567-8901234, fbm'
    };
    expect(extractAmazonOrderId(order)).toBe('206-1234567-8901234');
  });

  test('extracts Amazon order ID from order name', () => {
    const order = {
      name: '#206-1234567-8901234'
    };
    expect(extractAmazonOrderId(order)).toBe('206-1234567-8901234');
  });

  test('extracts Amazon order ID from line item properties', () => {
    const order = {
      line_items: [{
        properties: [{
          name: 'Amazon Order ID',
          value: '206-1234567-8901234'
        }]
      }]
    };
    expect(extractAmazonOrderId(order)).toBe('206-1234567-8901234');
  });

  test('extracts Amazon order ID from note_attributes', () => {
    const order = {
      note_attributes: [{
        name: 'amazon_order_id',
        value: '206-1234567-8901234'
      }]
    };
    expect(extractAmazonOrderId(order)).toBe('206-1234567-8901234');
  });

  test('returns null when no Amazon order ID found', () => {
    const order = {
      note: 'Regular Shopify order',
      tags: 'domestic, express',
      name: '#1234'
    };
    expect(extractAmazonOrderId(order)).toBe(null);
  });

  test('prioritizes note over other fields', () => {
    const order = {
      note: 'Amazon Order: 111-1111111-1111111',
      tags: '222-2222222-2222222'
    };
    expect(extractAmazonOrderId(order)).toBe('111-1111111-1111111');
  });
});

describe('Conflict Detection Logic', () => {
  // Simulate the conflict detection from processAmazonOrder

  function findMatchingShopifyOrder(shopifyOrders, amazonOrderId) {
    // First check explicit amazon_order_id field
    const explicitMatch = shopifyOrders.find(o => o.amazon_order_id === amazonOrderId);
    if (explicitMatch) return { match: explicitMatch, method: 'EXPLICIT' };

    // Then check raw_payload for pattern matches
    for (const order of shopifyOrders) {
      const payload = order.raw_payload;
      if (!payload) continue;

      const noteMatch = payload.note?.includes(amazonOrderId);
      const tagMatch = payload.tags?.includes(amazonOrderId);
      const nameMatch = payload.name?.includes(amazonOrderId);

      const lineItemMatch = payload.line_items?.some(li =>
        li.properties?.some(p =>
          p.value === amazonOrderId ||
          (p.name?.toLowerCase().includes('amazon') && p.value?.includes(amazonOrderId))
        )
      );

      if (noteMatch || tagMatch || nameMatch || lineItemMatch) {
        return { match: order, method: 'PATTERN' };
      }
    }

    return null;
  }

  test('finds match via explicit amazon_order_id field', () => {
    const shopifyOrders = [
      { id: 'order-1', amazon_order_id: '206-1234567-8901234', raw_payload: {} },
      { id: 'order-2', amazon_order_id: null, raw_payload: {} }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result.match.id).toBe('order-1');
    expect(result.method).toBe('EXPLICIT');
  });

  test('finds match via raw_payload note', () => {
    const shopifyOrders = [
      { id: 'order-1', amazon_order_id: null, raw_payload: { note: 'Amazon: 206-1234567-8901234' } }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result.match.id).toBe('order-1');
    expect(result.method).toBe('PATTERN');
  });

  test('finds match via raw_payload tags', () => {
    const shopifyOrders = [
      { id: 'order-1', amazon_order_id: null, raw_payload: { tags: '206-1234567-8901234' } }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result.match.id).toBe('order-1');
    expect(result.method).toBe('PATTERN');
  });

  test('finds match via raw_payload name', () => {
    const shopifyOrders = [
      { id: 'order-1', amazon_order_id: null, raw_payload: { name: '#206-1234567-8901234' } }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result.match.id).toBe('order-1');
    expect(result.method).toBe('PATTERN');
  });

  test('finds match via line item properties', () => {
    const shopifyOrders = [
      {
        id: 'order-1',
        amazon_order_id: null,
        raw_payload: {
          line_items: [{
            properties: [{ name: 'amazon_order', value: '206-1234567-8901234' }]
          }]
        }
      }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result.match.id).toBe('order-1');
    expect(result.method).toBe('PATTERN');
  });

  test('returns null when no match found', () => {
    const shopifyOrders = [
      { id: 'order-1', amazon_order_id: null, raw_payload: { note: 'Different order' } }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result).toBe(null);
  });

  test('prioritizes explicit match over pattern match', () => {
    const shopifyOrders = [
      { id: 'order-1', amazon_order_id: null, raw_payload: { note: '206-1234567-8901234' } },
      { id: 'order-2', amazon_order_id: '206-1234567-8901234', raw_payload: {} }
    ];

    const result = findMatchingShopifyOrder(shopifyOrders, '206-1234567-8901234');
    expect(result.match.id).toBe('order-2');
    expect(result.method).toBe('EXPLICIT');
  });
});

describe('Order Line Replacement Logic', () => {
  // Test the line replacement result structure

  function processLineReplacement(amazonItems, resolutionResults) {
    let resolved = 0;
    let unresolved = 0;

    for (const item of amazonItems) {
      const isResolved = resolutionResults[item.ASIN]?.resolved || false;
      if (isResolved) {
        resolved++;
      } else {
        unresolved++;
      }
    }

    return {
      replaced: amazonItems.length,
      resolved,
      unresolved,
      allResolved: unresolved === 0
    };
  }

  test('calculates correct counts for fully resolved order', () => {
    const items = [
      { ASIN: 'B001', SellerSKU: 'SKU1' },
      { ASIN: 'B002', SellerSKU: 'SKU2' }
    ];
    const resolutions = {
      'B001': { resolved: true, bom_id: 'bom-1' },
      'B002': { resolved: true, bom_id: 'bom-2' }
    };

    const result = processLineReplacement(items, resolutions);
    expect(result.replaced).toBe(2);
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(0);
    expect(result.allResolved).toBe(true);
  });

  test('calculates correct counts for partially resolved order', () => {
    const items = [
      { ASIN: 'B001', SellerSKU: 'SKU1' },
      { ASIN: 'B002', SellerSKU: 'SKU2' },
      { ASIN: 'B003', SellerSKU: 'SKU3' }
    ];
    const resolutions = {
      'B001': { resolved: true, bom_id: 'bom-1' },
      'B002': { resolved: false },
      'B003': { resolved: true, bom_id: 'bom-3' }
    };

    const result = processLineReplacement(items, resolutions);
    expect(result.replaced).toBe(3);
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(1);
    expect(result.allResolved).toBe(false);
  });

  test('handles empty items list', () => {
    const result = processLineReplacement([], {});
    expect(result.replaced).toBe(0);
    expect(result.allResolved).toBe(true);
  });
});

describe('Order Status Determination', () => {
  // Test status determination after line replacement

  const STATUS_MAP = {
    'Pending': 'IMPORTED',
    'Unshipped': 'READY_TO_PICK',
    'PartiallyShipped': 'PICKED',
    'Shipped': 'DISPATCHED',
    'Canceled': 'CANCELLED',
    'Unfulfillable': 'CANCELLED'
  };

  function determineNewStatus(amazonOrderStatus, existingStatus, lineResult) {
    const amazonStatus = STATUS_MAP[amazonOrderStatus] || 'NEEDS_REVIEW';

    // Terminal statuses from Amazon take precedence
    if (amazonStatus === 'DISPATCHED' || amazonStatus === 'CANCELLED') {
      return amazonStatus;
    }

    // Otherwise, base on resolution
    if (lineResult.allResolved) {
      return 'READY_TO_PICK';
    } else {
      return 'NEEDS_REVIEW';
    }
  }

  test('uses DISPATCHED when Amazon says shipped', () => {
    const lineResult = { allResolved: false };
    expect(determineNewStatus('Shipped', 'NEEDS_REVIEW', lineResult)).toBe('DISPATCHED');
  });

  test('uses CANCELLED when Amazon says cancelled', () => {
    const lineResult = { allResolved: true };
    expect(determineNewStatus('Canceled', 'READY_TO_PICK', lineResult)).toBe('CANCELLED');
  });

  test('uses READY_TO_PICK when all lines resolved', () => {
    const lineResult = { allResolved: true };
    expect(determineNewStatus('Unshipped', 'NEEDS_REVIEW', lineResult)).toBe('READY_TO_PICK');
  });

  test('uses NEEDS_REVIEW when some lines unresolved', () => {
    const lineResult = { allResolved: false };
    expect(determineNewStatus('Unshipped', 'READY_TO_PICK', lineResult)).toBe('NEEDS_REVIEW');
  });

  test('handles Pending status with resolution', () => {
    const lineResult = { allResolved: true };
    expect(determineNewStatus('Pending', 'IMPORTED', lineResult)).toBe('READY_TO_PICK');
  });
});

describe('Line Source Tracking', () => {
  // Test line source attribution

  function createOrderLine(source, data) {
    return {
      ...data,
      line_source: source
    };
  }

  test('Shopify lines have SHOPIFY source', () => {
    const line = createOrderLine('SHOPIFY', { asin: null, sku: 'SKU1' });
    expect(line.line_source).toBe('SHOPIFY');
  });

  test('Amazon lines have AMAZON source', () => {
    const line = createOrderLine('AMAZON', { asin: 'B001', sku: 'SKU1' });
    expect(line.line_source).toBe('AMAZON');
  });

  test('replaced lines should have AMAZON source', () => {
    // When Shopify order is linked to Amazon, lines should be replaced
    const originalLines = [
      createOrderLine('SHOPIFY', { id: 'line-1', asin: null, sku: 'SKU1' })
    ];

    const replacedLines = [
      createOrderLine('AMAZON', { id: 'line-2', asin: 'B001', sku: 'SKU1' })
    ];

    expect(originalLines[0].line_source).toBe('SHOPIFY');
    expect(replacedLines[0].line_source).toBe('AMAZON');
    expect(replacedLines[0].asin).toBe('B001'); // Amazon provides ASIN
  });
});

describe('Amazon Order Data Enrichment', () => {
  // Test that linked orders are enriched with Amazon data

  function mergeAmazonData(shopifyOrder, amazonOrder) {
    const amazonShipping = amazonOrder.ShippingAddress || {};

    return {
      ...shopifyOrder,
      amazon_order_id: amazonOrder.AmazonOrderId,
      source_channel: 'AMAZON',
      shipping_address: amazonShipping.AddressLine1 ? {
        name: amazonShipping.Name,
        address1: amazonShipping.AddressLine1,
        address2: amazonShipping.AddressLine2 || null,
        city: amazonShipping.City,
        zip: amazonShipping.PostalCode,
        country: amazonShipping.CountryCode
      } : shopifyOrder.shipping_address,
      customer_name: amazonShipping.Name || shopifyOrder.customer_name,
      total_price_pence: amazonOrder.OrderTotal
        ? Math.round(parseFloat(amazonOrder.OrderTotal.Amount) * 100)
        : shopifyOrder.total_price_pence,
      raw_payload: {
        ...shopifyOrder.raw_payload,
        _amazon_data: amazonOrder,
        _lines_replaced_at: new Date().toISOString()
      }
    };
  }

  test('sets amazon_order_id on linked order', () => {
    const shopifyOrder = { id: 'order-1', raw_payload: {} };
    const amazonOrder = { AmazonOrderId: '206-1234567-8901234' };

    const result = mergeAmazonData(shopifyOrder, amazonOrder);
    expect(result.amazon_order_id).toBe('206-1234567-8901234');
  });

  test('sets source_channel to AMAZON', () => {
    const shopifyOrder = { id: 'order-1', raw_payload: {} };
    const amazonOrder = { AmazonOrderId: '206-1234567-8901234' };

    const result = mergeAmazonData(shopifyOrder, amazonOrder);
    expect(result.source_channel).toBe('AMAZON');
  });

  test('uses Amazon shipping address when available', () => {
    const shopifyOrder = {
      id: 'order-1',
      shipping_address: { name: 'Shopify Name' },
      raw_payload: {}
    };
    const amazonOrder = {
      AmazonOrderId: '206-1234567-8901234',
      ShippingAddress: {
        Name: 'Amazon Customer',
        AddressLine1: '123 Amazon St',
        City: 'London',
        PostalCode: 'SW1A 1AA',
        CountryCode: 'GB'
      }
    };

    const result = mergeAmazonData(shopifyOrder, amazonOrder);
    expect(result.shipping_address.name).toBe('Amazon Customer');
    expect(result.shipping_address.address1).toBe('123 Amazon St');
  });

  test('preserves Shopify shipping when Amazon has none', () => {
    const shopifyOrder = {
      id: 'order-1',
      shipping_address: { name: 'Shopify Customer', address1: '456 Shopify Ave' },
      raw_payload: {}
    };
    const amazonOrder = {
      AmazonOrderId: '206-1234567-8901234',
      ShippingAddress: {}
    };

    const result = mergeAmazonData(shopifyOrder, amazonOrder);
    expect(result.shipping_address.name).toBe('Shopify Customer');
    expect(result.shipping_address.address1).toBe('456 Shopify Ave');
  });

  test('updates total_price_pence from Amazon', () => {
    const shopifyOrder = {
      id: 'order-1',
      total_price_pence: 9999,
      raw_payload: {}
    };
    const amazonOrder = {
      AmazonOrderId: '206-1234567-8901234',
      OrderTotal: { Amount: '149.99', CurrencyCode: 'GBP' }
    };

    const result = mergeAmazonData(shopifyOrder, amazonOrder);
    expect(result.total_price_pence).toBe(14999);
  });

  test('preserves Amazon data in raw_payload', () => {
    const shopifyOrder = {
      id: 'order-1',
      raw_payload: { shopify_field: 'value' }
    };
    const amazonOrder = {
      AmazonOrderId: '206-1234567-8901234',
      BuyerInfo: { BuyerEmail: 'buyer@example.com' }
    };

    const result = mergeAmazonData(shopifyOrder, amazonOrder);
    expect(result.raw_payload.shopify_field).toBe('value');
    expect(result.raw_payload._amazon_data.AmazonOrderId).toBe('206-1234567-8901234');
    expect(result.raw_payload._lines_replaced_at).toBeDefined();
  });
});
