import express from 'express';
import supabase from '../services/supabase.js';

const router = express.Router();

// GET /boms
// Returns a list of all BOMs with their component requirements.
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('boms')
    .select('*, bom_components(component_id, qty_required)');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /boms
// Creates a new BOM along with its component lines.  Body: { bundle_sku, description, components: [{component_id, qty_required}] }
router.post('/', async (req, res) => {
  const { bundle_sku, description, components } = req.body;
  if (!bundle_sku) return res.status(400).json({ error: 'bundle_sku is required' });
  // Insert the BOM
  const { data: bom, error: bomError } = await supabase
    .from('boms')
    .insert({ bundle_sku, description })
    .select()
    .single();
  if (bomError) return res.status(400).json({ error: bomError.message });
  // Insert the component lines
  if (components && components.length > 0) {
    const rows = components.map((c) => ({
      bom_id: bom.id,
      component_id: c.component_id,
      qty_required: c.qty_required
    }));
    const { error: linesError } = await supabase
      .from('bom_components')
      .insert(rows);
    if (linesError) return res.status(400).json({ error: linesError.message });
  }
  // Return the BOM with its components
  const { data: fullBom, error: fetchError } = await supabase
    .from('boms')
    .select('*, bom_components(component_id, qty_required)')
    .eq('id', bom.id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  res.json(fullBom);
});

export default router;