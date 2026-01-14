import supabase from '../services/supabase.js';

/**
 * Generates a picklist from the local orders table.  It aggregates the
 * quantities of each component required across all order lines that
 * have been resolved to a listing memory row.  It returns an array
 * where each element contains the component details and the total
 * quantity required.  This function assumes that each listing
 * memory row has a `bom_id` and that each BOM has associated
 * component requirements in the `bom_components` table.
 *
 * OPTIMIZED: Uses batched queries instead of sequential N+M+K queries.
 * Reduced from ~170 queries to 4 queries for typical datasets.
 *
 * @returns {Promise<Array<{component_id: string, internal_sku: string, description: string, quantity_required: number}>>}
 */
export async function generatePicklist() {
  // 1. Fetch all order lines with a non-null listing_id
  const { data: lines, error: errLines } = await supabase
    .from('order_lines')
    .select('listing_id, quantity')
    .not('listing_id', 'is', null);

  if (errLines) throw errLines;
  if (!lines || lines.length === 0) return [];

  // 2. Batch fetch all listing_memory records for these listing_ids
  const listingIds = [...new Set(lines.map(l => l.listing_id))];
  const { data: memoryRows, error: errMem } = await supabase
    .from('listing_memory')
    .select('id, bom_id')
    .in('id', listingIds);

  if (errMem) throw errMem;

  // Create a map of listing_id -> bom_id
  const listingToBom = new Map();
  for (const mem of memoryRows || []) {
    if (mem.bom_id) {
      listingToBom.set(mem.id, mem.bom_id);
    }
  }

  // Get unique BOM IDs
  const bomIds = [...new Set(listingToBom.values())];
  if (bomIds.length === 0) return [];

  // 3. Batch fetch all bom_components for these BOMs
  const { data: bomComponents, error: errBom } = await supabase
    .from('bom_components')
    .select('bom_id, component_id, qty_required')
    .in('bom_id', bomIds);

  if (errBom) throw errBom;

  // Create a map of bom_id -> array of {component_id, qty_required}
  const bomToComponents = new Map();
  for (const bc of bomComponents || []) {
    if (!bomToComponents.has(bc.bom_id)) {
      bomToComponents.set(bc.bom_id, []);
    }
    bomToComponents.get(bc.bom_id).push({
      component_id: bc.component_id,
      qty_required: bc.qty_required
    });
  }

  // Aggregate component quantities from order lines
  const aggregated = {};
  for (const line of lines) {
    const bomId = listingToBom.get(line.listing_id);
    if (!bomId) continue;

    const components = bomToComponents.get(bomId) || [];
    for (const c of components) {
      const total = line.quantity * c.qty_required;
      aggregated[c.component_id] = (aggregated[c.component_id] || 0) + total;
    }
  }

  // Get unique component IDs
  const componentIds = Object.keys(aggregated);
  if (componentIds.length === 0) return [];

  // 4. Batch fetch all component details
  const { data: components, error: errComp } = await supabase
    .from('components')
    .select('id, internal_sku, description')
    .in('id', componentIds);

  if (errComp) throw errComp;

  // Create a map of component_id -> details
  const componentDetails = new Map();
  for (const comp of components || []) {
    componentDetails.set(comp.id, {
      internal_sku: comp.internal_sku,
      description: comp.description
    });
  }

  // Build the final picklist
  const pickList = [];
  for (const compId of componentIds) {
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
