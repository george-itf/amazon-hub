-- ============================================================================
-- Amazon Hub Brain - Amazon SP-API Features Migration (FBM)
-- Version: 005
-- Description: Add tables for Amazon fees, catalog data, and shipping (FBM)
-- ============================================================================

-- ============================================================================
-- AMAZON FEES (Referral fees per order/product)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amazon_order_id text NOT NULL,
  order_item_id text,
  asin text,
  seller_sku text,
  posted_date timestamptz,

  -- Fee breakdown (all in pence) - FBM fees
  referral_fee_pence integer DEFAULT 0,
  variable_closing_fee_pence integer DEFAULT 0,
  promotion_discount_pence integer DEFAULT 0,
  shipping_charge_pence integer DEFAULT 0,
  shipping_charge_back_pence integer DEFAULT 0,
  gift_wrap_charge_pence integer DEFAULT 0,
  total_fees_pence integer DEFAULT 0,

  -- Revenue
  item_price_pence integer DEFAULT 0,
  net_proceeds_pence integer DEFAULT 0,

  -- Link to our order
  order_id uuid REFERENCES orders(id),

  raw_data jsonb,
  created_at timestamptz DEFAULT now(),

  UNIQUE(amazon_order_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_fees_order_id ON amazon_fees(amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_amazon_fees_asin ON amazon_fees(asin);
CREATE INDEX IF NOT EXISTS idx_amazon_fees_posted ON amazon_fees(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_fees_our_order ON amazon_fees(order_id);

-- ============================================================================
-- AMAZON CATALOG CACHE (Product data from Amazon)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin text UNIQUE NOT NULL,

  -- Basic product info
  title text,
  brand text,
  manufacturer text,
  model_number text,
  part_number text,
  color text,
  size text,

  -- Categorization
  product_type text,
  product_group text,
  browse_node_ids jsonb,

  -- Images
  main_image_url text,
  images jsonb,

  -- Dimensions & weight
  item_dimensions jsonb,
  package_dimensions jsonb,
  item_weight_grams integer,
  package_weight_grams integer,

  -- Sales rank
  sales_rank integer,
  sales_rank_category text,

  -- Pricing
  list_price_pence integer,
  your_price_pence integer,

  -- Full raw data
  raw_data jsonb,

  last_synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amazon_catalog_asin ON amazon_catalog(asin);
CREATE INDEX IF NOT EXISTS idx_amazon_catalog_brand ON amazon_catalog(brand);
CREATE INDEX IF NOT EXISTS idx_amazon_catalog_sales_rank ON amazon_catalog(sales_rank);

-- ============================================================================
-- AMAZON SHIPMENTS (Tracking info for FBM orders)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  amazon_order_id text NOT NULL,

  -- Carrier info
  carrier_code text,
  carrier_name text,
  tracking_number text,
  ship_method text,

  -- Status
  ship_date timestamptz,
  estimated_arrival_date date,
  confirmed_at timestamptz,

  -- Items in shipment
  items jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amazon_shipments_order ON amazon_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_amazon_shipments_amazon_id ON amazon_shipments(amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_amazon_shipments_tracking ON amazon_shipments(tracking_number);

-- ============================================================================
-- AMAZON SYNC LOG (Track sync history)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type text NOT NULL CHECK (sync_type IN ('ORDERS', 'FEES', 'CATALOG', 'SHIPMENTS')),
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,

  -- Results
  items_processed integer DEFAULT 0,
  items_created integer DEFAULT 0,
  items_updated integer DEFAULT 0,
  items_failed integer DEFAULT 0,

  error_message text,
  metadata jsonb,

  triggered_by_user_id uuid REFERENCES users(id),
  triggered_by_display text
);

CREATE INDEX IF NOT EXISTS idx_amazon_sync_log_type ON amazon_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_log_status ON amazon_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_log_started ON amazon_sync_log(started_at DESC);

-- ============================================================================
-- AMAZON SETTINGS (Per-account configuration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb,
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id)
);

-- Insert default settings
INSERT INTO amazon_settings (setting_key, setting_value, description)
VALUES
  ('auto_sync_enabled', 'false', 'Enable automatic order sync'),
  ('auto_sync_interval_minutes', '30', 'Minutes between auto-syncs'),
  ('sync_orders_days_back', '7', 'Default days to look back when syncing orders'),
  ('link_shopify_orders', 'true', 'Automatically link matching Shopify orders'),
  ('default_carrier', '"Royal Mail"', 'Default shipping carrier for confirmations'),
  ('auto_confirm_shipped', 'false', 'Automatically confirm shipping when order dispatched')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Order profitability view with Amazon fees
CREATE OR REPLACE VIEW order_profitability AS
SELECT
  o.id as order_id,
  o.external_order_id,
  o.amazon_order_id,
  o.channel,
  o.order_date,
  o.total_price_pence as revenue_pence,
  COALESCE(SUM(af.total_fees_pence), 0) as amazon_fees_pence,
  COALESCE(SUM(
    ol.quantity * COALESCE(
      (SELECT SUM(bc.qty_required * comp.cost_ex_vat_pence)
       FROM bom_components bc
       JOIN components comp ON comp.id = bc.component_id
       WHERE bc.bom_id = ol.bom_id), 0
    )
  ), 0) as cogs_pence,
  o.total_price_pence
    - COALESCE(SUM(af.total_fees_pence), 0)
    - COALESCE(SUM(
        ol.quantity * COALESCE(
          (SELECT SUM(bc.qty_required * comp.cost_ex_vat_pence)
           FROM bom_components bc
           JOIN components comp ON comp.id = bc.component_id
           WHERE bc.bom_id = ol.bom_id), 0
        )
      ), 0) as profit_pence
FROM orders o
LEFT JOIN order_lines ol ON ol.order_id = o.id
LEFT JOIN amazon_fees af ON af.order_id = o.id
WHERE o.status NOT IN ('CANCELLED')
GROUP BY o.id, o.external_order_id, o.amazon_order_id, o.channel, o.order_date, o.total_price_pence;

-- Amazon orders pending shipment confirmation
CREATE OR REPLACE VIEW amazon_orders_pending_shipment AS
SELECT
  o.id,
  o.external_order_id as amazon_order_id,
  o.order_number,
  o.order_date,
  o.customer_name,
  o.shipping_address,
  o.status,
  o.total_price_pence,
  pb.confirmed_at as picked_at,
  s.tracking_number,
  s.carrier_code
FROM orders o
LEFT JOIN pick_batch_orders pbo ON pbo.order_id = o.id
LEFT JOIN pick_batches pb ON pb.id = pbo.pick_batch_id AND pb.status = 'CONFIRMED'
LEFT JOIN amazon_shipments s ON s.order_id = o.id
WHERE o.channel = 'AMAZON'
  AND o.status IN ('PICKED', 'DISPATCHED')
  AND s.id IS NULL;
