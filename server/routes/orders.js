import express from 'express';
import supabase from '../services/supabase.js';
import { fetchOpenOrders } from '../services/shopify.js';
import { resolveListing } from '../utils/memoryResolution.js';

const router = express.Router();

// POST /orders/import
// Pulls open, unfulfilled orders from Shopify, stores them in the
// orders/order_lines tables, and enqueues unknown listings for review.
router.post('/import', async (req, res) => {
  try {
    const shopifyOrders = await fetchOpenOrders();
    for (const order of shopifyOrders) {
      // Skip if order already exists
      const { data: existing } = await supabase
        .from('orders')
        .select('*')
        .eq('external_order_id', order.id.toString())
        .maybeSingle();
      if (existing) continue;
      // Insert order
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          external_order_id: order.id.toString(),
          channel: 'shopify',
          order_date: order.created_at ? order.created_at.split('T')[0] : null
        })
        .select()
        .single();
      if (orderError) throw orderError;
      // Build order lines
      const lines = [];
      for (const line of order.line_items) {
        const asinProp = line.properties?.find((p) => p.name.toLowerCase() === 'asin');
        const asin = asinProp ? asinProp.value : null;
        const sku = line.sku;
        const title = line.title;
        const quantity = line.quantity;
        let listingId = null;
        // Attempt to resolve listing
        try {
          const mem = await resolveListing(asin, sku, title);
          if (mem) {
            listingId = mem.id;
          } else {
            // Unknown listing – enqueue for review
            await supabase.from('review_queue').insert({
              external_id: `${order.id}-${line.id}`,
              asin: asin || null,
              sku: sku || null,
              title,
              reason: 'Unknown listing'
            });
          }
        } catch (err) {
          console.error('Memory resolution error:', err);
        }
        lines.push({ order_id: newOrder.id, listing_id: listingId, quantity });
      }
      if (lines.length > 0) {
        const { error: linesError } = await supabase.from('order_lines').insert(lines);
        if (linesError) throw linesError;
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /orders
// Returns orders with their lines.  In a more complete system this
// would include pagination and more details.
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_lines(id, listing_id, quantity)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;