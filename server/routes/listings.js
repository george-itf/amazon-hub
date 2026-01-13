import express from 'express';
import supabase from '../services/supabase.js';
import { fingerprintTitle } from '../utils/identityNormalization.js';

const router = express.Router();

// GET /listings
// Returns all listing memory entries.  In a full implementation this
// would likely include pagination.
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('listing_memory')
    .select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /listings
// Creates a new listing memory entry.  Body: { asin?, sku?, title?, bom_id }
router.post('/', async (req, res) => {
  const { asin, sku, title, bom_id } = req.body;
  if (!asin && !sku && !title) {
    return res.status(400).json({ error: 'At least one of asin, sku or title must be provided' });
  }
  const title_fingerprint = fingerprintTitle(title);
  const payload = { asin, sku, title_fingerprint, bom_id };
  const { data, error } = await supabase
    .from('listing_memory')
    .insert(payload)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;