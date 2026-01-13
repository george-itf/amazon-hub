import express from 'express';
import supabase from '../services/supabase.js';
import { fingerprintTitle } from '../utils/identityNormalization.js';

const router = express.Router();

// GET /review
// Returns all items currently in the review queue.
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('review_queue')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /review/:id/resolve
// Resolves a single review item by creating a new listing memory
// entry and deleting the review record.  Body: { bom_id, asin?, sku?, title? }
router.post('/:id/resolve', async (req, res) => {
  const reviewId = req.params.id;
  const { bom_id: bomId, asin, sku, title } = req.body;
  if (!bomId) return res.status(400).json({ error: 'bom_id is required' });
  try {
    const { data: review, error: reviewError } = await supabase
      .from('review_queue')
      .select('*')
      .eq('id', reviewId)
      .maybeSingle();
    if (reviewError) throw reviewError;
    if (!review) return res.status(404).json({ error: 'Review item not found' });
    // Determine fingerprint
    const fingerprint = fingerprintTitle(title || review.title);
    // Insert into listing_memory
    const { data: mem, error: insertError } = await supabase
      .from('listing_memory')
      .insert({
        asin: asin || review.asin,
        sku: sku || review.sku,
        title_fingerprint: fingerprint,
        bom_id: bomId
      })
      .select()
      .single();
    if (insertError) throw insertError;
    // Delete from review_queue
    const { error: deleteError } = await supabase
      .from('review_queue')
      .delete()
      .eq('id', reviewId);
    if (deleteError) throw deleteError;
    res.json(mem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;