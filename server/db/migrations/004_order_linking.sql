-- ============================================================================
-- Amazon Hub Brain - Order Linking Migration
-- Version: 004
-- Description: Add fields to link Amazon and Shopify orders together
-- ============================================================================

-- Add amazon_order_id column to orders (for Shopify orders that came from Amazon)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amazon_order_id text;

-- Add shopify_order_id column to orders (for Amazon orders that exist in Shopify)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_id text;

-- Add linked_order_id to reference another order in the same table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS linked_order_id uuid REFERENCES orders(id);

-- Add source_channel to track the original source when orders are linked
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_channel text;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_amazon_order_id ON orders(amazon_order_id) WHERE amazon_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_linked_order_id ON orders(linked_order_id) WHERE linked_order_id IS NOT NULL;

-- Add comment explaining the linking strategy
COMMENT ON COLUMN orders.amazon_order_id IS 'Amazon order ID (e.g., 206-1234567-8901234) - populated for both Amazon and linked Shopify orders';
COMMENT ON COLUMN orders.shopify_order_id IS 'Shopify order ID - populated for both Shopify and linked Amazon orders';
COMMENT ON COLUMN orders.linked_order_id IS 'Reference to the linked order from the other channel';
COMMENT ON COLUMN orders.source_channel IS 'Original channel where the order was placed (AMAZON or SHOPIFY)';
