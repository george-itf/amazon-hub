/**
 * Schema validation tests
 *
 * These tests document the correct column names for key tables
 * and help prevent introducing invalid column references.
 *
 * If these tests fail after a schema change, update both the tests
 * AND all route files that reference these columns.
 */

/**
 * DOCUMENTED SCHEMA - Reference for correct column names
 *
 * When routes reference these tables, they MUST use these column names.
 * Using wrong names like 'name' instead of 'bundle_sku' will cause
 * "column does not exist" errors from Supabase.
 */

const SCHEMA = {
  // BOMs table - Bills of Materials
  boms: {
    columns: ['id', 'bundle_sku', 'description', 'is_active', 'created_at', 'updated_at'],
    // WRONG column names that have been used by mistake:
    invalidColumns: ['name', 'sku'],
  },

  // Components table - Inventory items
  components: {
    columns: ['id', 'internal_sku', 'description', 'brand', 'cost_ex_vat_pence', 'weight_grams', 'is_active', 'created_at', 'updated_at'],
    // WRONG column names that have been used by mistake:
    invalidColumns: ['name', 'sku', 'unit_cost_pence'],
  },

  // BOM Components junction table
  bom_components: {
    columns: ['id', 'bom_id', 'component_id', 'qty_required', 'created_at'],
    // WRONG column names that have been used by mistake:
    invalidColumns: ['quantity'],
  },

  // Listing Memory - ASIN/SKU to BOM mapping
  listing_memory: {
    columns: [
      'id', 'asin', 'sku', 'title_fingerprint', 'title_fingerprint_hash',
      'bom_id', 'resolution_source', 'is_active', 'superseded_by', 'superseded_at',
      'created_at', 'created_by_actor_type', 'created_by_actor_id', 'created_by_actor_display'
    ],
    // WRONG column names that have been used by mistake:
    invalidColumns: ['title', 'confidence', 'updated_at'],
  },

  // Component Stock - Live inventory state
  component_stock: {
    columns: ['id', 'component_id', 'location', 'on_hand', 'reserved', 'created_at', 'updated_at'],
    invalidColumns: [],
  },

  // Orders
  orders: {
    columns: [
      'id', 'external_order_id', 'channel', 'status', 'order_date',
      'customer_email', 'customer_name', 'shipping_address', 'raw_payload',
      'total_price_pence', 'currency', 'imported_at', 'updated_at', 'created_at',
      'amazon_order_id', 'shopify_order_id', 'linked_order_id', 'source_channel'
    ],
    invalidColumns: [],
  },
};

describe('Schema Documentation', () => {
  describe('boms table', () => {
    test('should use bundle_sku NOT name', () => {
      expect(SCHEMA.boms.columns).toContain('bundle_sku');
      expect(SCHEMA.boms.columns).not.toContain('name');
    });

    test('should use description NOT sku for description text', () => {
      expect(SCHEMA.boms.columns).toContain('description');
      // sku is NOT a valid column - bundle_sku is the identifier
      expect(SCHEMA.boms.invalidColumns).toContain('sku');
    });
  });

  describe('components table', () => {
    test('should use internal_sku NOT name or sku', () => {
      expect(SCHEMA.components.columns).toContain('internal_sku');
      expect(SCHEMA.components.columns).not.toContain('name');
      expect(SCHEMA.components.columns).not.toContain('sku');
    });

    test('should use cost_ex_vat_pence NOT unit_cost_pence', () => {
      expect(SCHEMA.components.columns).toContain('cost_ex_vat_pence');
      expect(SCHEMA.components.columns).not.toContain('unit_cost_pence');
    });
  });

  describe('bom_components table', () => {
    test('should use qty_required NOT quantity', () => {
      expect(SCHEMA.bom_components.columns).toContain('qty_required');
      expect(SCHEMA.bom_components.columns).not.toContain('quantity');
    });
  });

  describe('listing_memory table', () => {
    test('should NOT have title column (use title_fingerprint)', () => {
      expect(SCHEMA.listing_memory.columns).toContain('title_fingerprint');
      expect(SCHEMA.listing_memory.columns).not.toContain('title');
    });

    test('should NOT have confidence column', () => {
      expect(SCHEMA.listing_memory.columns).not.toContain('confidence');
    });

    test('should NOT have updated_at column', () => {
      expect(SCHEMA.listing_memory.columns).not.toContain('updated_at');
    });

    test('should have is_active for partial unique constraint', () => {
      expect(SCHEMA.listing_memory.columns).toContain('is_active');
    });
  });
});

describe('Column Name Validation Helpers', () => {
  /**
   * Helper to check if a column name is valid for a table
   */
  function isValidColumn(table, column) {
    const tableSchema = SCHEMA[table];
    if (!tableSchema) return null; // Unknown table
    return tableSchema.columns.includes(column);
  }

  /**
   * Helper to check if a column name is a known invalid column
   */
  function isKnownInvalidColumn(table, column) {
    const tableSchema = SCHEMA[table];
    if (!tableSchema) return false;
    return tableSchema.invalidColumns.includes(column);
  }

  test('isValidColumn returns true for valid columns', () => {
    expect(isValidColumn('boms', 'bundle_sku')).toBe(true);
    expect(isValidColumn('boms', 'description')).toBe(true);
    expect(isValidColumn('components', 'internal_sku')).toBe(true);
    expect(isValidColumn('components', 'cost_ex_vat_pence')).toBe(true);
    expect(isValidColumn('bom_components', 'qty_required')).toBe(true);
  });

  test('isValidColumn returns false for invalid columns', () => {
    expect(isValidColumn('boms', 'name')).toBe(false);
    expect(isValidColumn('boms', 'sku')).toBe(false);
    expect(isValidColumn('components', 'name')).toBe(false);
    expect(isValidColumn('components', 'unit_cost_pence')).toBe(false);
    expect(isValidColumn('bom_components', 'quantity')).toBe(false);
    expect(isValidColumn('listing_memory', 'title')).toBe(false);
    expect(isValidColumn('listing_memory', 'confidence')).toBe(false);
    expect(isValidColumn('listing_memory', 'updated_at')).toBe(false);
  });

  test('isKnownInvalidColumn identifies common mistakes', () => {
    expect(isKnownInvalidColumn('boms', 'name')).toBe(true);
    expect(isKnownInvalidColumn('boms', 'sku')).toBe(true);
    expect(isKnownInvalidColumn('components', 'name')).toBe(true);
    expect(isKnownInvalidColumn('components', 'sku')).toBe(true);
    expect(isKnownInvalidColumn('components', 'unit_cost_pence')).toBe(true);
    expect(isKnownInvalidColumn('bom_components', 'quantity')).toBe(true);
    expect(isKnownInvalidColumn('listing_memory', 'title')).toBe(true);
    expect(isKnownInvalidColumn('listing_memory', 'confidence')).toBe(true);
    expect(isKnownInvalidColumn('listing_memory', 'updated_at')).toBe(true);
  });
});

/**
 * COMMON MISTAKE REFERENCE
 *
 * When selecting from related tables with Supabase, use the correct column names:
 *
 * CORRECT:
 *   .select('asin, bom_id, boms(id, bundle_sku, description)')
 *   .select('component_id, qty_required, components(internal_sku, cost_ex_vat_pence)')
 *
 * WRONG:
 *   .select('asin, bom_id, boms(id, name)')           // name doesn't exist
 *   .select('component_id, quantity, components(...)')  // quantity doesn't exist
 *   .select('...components(id, name, sku, unit_cost_pence)')  // all wrong!
 *
 * For listing_memory upserts, remember:
 * - No 'title' column (use title_fingerprint)
 * - No 'confidence' column
 * - No 'updated_at' column
 * - Unique constraint is partial (is_active=true), so use check-then-insert pattern
 */
