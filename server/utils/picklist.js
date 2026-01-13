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
 * @returns {Promise<Array<{component_id: string, internal_sku: string, description: string, quantity_required: number}>>}
 */
export async function generatePicklist() {
  // Fetch all order lines with a non‑null listing_id
  const { data: lines, error: errLines } = await supabase
    .from('order_lines')
    .select('listing_id, quantity');
  if (errLines) throw errLines;
  const aggregated = {};
  for (const line of lines) {
    if (!line.listing_id) continue;
    // Find the memory row to get the BOM id
    const { data: mem, error: errMem } = await supabase
      .from('listing_memory')
      .select('bom_id')
      .eq('id', line.listing_id)
      .maybeSingle();
    if (errMem) throw errMem;
    const bomId = mem?.bom_id;
    if (!bomId) continue;
    // Fetch the components required for this BOM
    const { data: components, error: errBom } = await supabase
      .from('bom_components')
      .select('component_id, qty_required')
      .eq('bom_id', bomId);
    if (errBom) throw errBom;
    for (const c of components) {
      const total = line.quantity * c.qty_required;
      aggregated[c.component_id] = (aggregated[c.component_id] || 0) + total;
    }
  }
  // Convert aggregated into an array with component details
  const pickList = [];
  for (const compId of Object.keys(aggregated)) {
    const { data: comp, error: errComp } = await supabase
      .from('components')
      .select('internal_sku, description')
      .eq('id', compId)
      .maybeSingle();
    if (errComp) throw errComp;
    if (!comp) continue;
    pickList.push({
      component_id: compId,
      internal_sku: comp.internal_sku,
      description: comp.description,
      quantity_required: aggregated[compId]
    });
  }
  return pickList;
}