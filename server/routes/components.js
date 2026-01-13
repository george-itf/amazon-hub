import express from 'express';
import supabase from '../services/supabase.js';

const router = express.Router();

// GET /components
// Returns a list of all components sorted by creation date descending.
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('components')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /components
// Creates a new component.  Expects body: { internal_sku, description, brand, cost_ex_vat }
router.post('/', async (req, res) => {
  const { internal_sku, description, brand, cost_ex_vat } = req.body;
  if (!internal_sku) return res.status(400).json({ error: 'internal_sku is required' });
  const { data, error } = await supabase
    .from('components')
    .insert({ internal_sku, description, brand, cost_ex_vat })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;