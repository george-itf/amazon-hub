-- ============================================================================
-- Amazon Hub Brain - Initial Schema Migration
-- Version: 001
-- Description: Complete schema setup for production-ready system
-- IMPORTANT: This migration is additive - no DROP statements
-- ============================================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS & AUTHENTICATION
-- ============================================================================

-- Users table for app-local authentication
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name text,
  role text NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_login_at timestamptz
);

-- Session storage for server-side sessions
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ============================================================================
-- COMPONENTS (Source of Truth for Stock)
-- ============================================================================

CREATE TABLE IF NOT EXISTS components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_sku text UNIQUE NOT NULL,
  description text,
  brand text,
  cost_ex_vat_pence integer DEFAULT 0,
  weight_grams integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_components_internal_sku ON components(internal_sku);

-- ============================================================================
-- COMPONENT STOCK (Live State Per Location)
-- ============================================================================

CREATE TABLE IF NOT EXISTS component_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  location text NOT NULL DEFAULT 'Warehouse',
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(component_id, location)
);

CREATE INDEX IF NOT EXISTS idx_component_stock_component ON component_stock(component_id);
CREATE INDEX IF NOT EXISTS idx_component_stock_location ON component_stock(location);

-- Available stock computed view
CREATE OR REPLACE VIEW component_stock_available AS
SELECT
  cs.*,
  (cs.on_hand - cs.reserved) AS available
FROM component_stock cs;

-- ============================================================================
-- STOCK MOVEMENTS (Append-Only Audit Log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  location text NOT NULL,
  on_hand_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN (
    'RECEIVE', 'ADJUST', 'DAMAGE', 'SHRINK', 'CORRECTION',
    'RESERVE', 'UNRESERVE', 'DISPATCH',
    'RETURN_RESTOCK', 'RETURN_REFURB', 'RETURN_SCRAP', 'SUPPLIER_RETURN',
    'INITIAL'
  )),
  reference_type text,
  reference_id text,
  note text,
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM')),
  actor_id text,
  actor_display text,
  created_at timestamptz DEFAULT now()
);

-- Prevent updates and deletes on stock_movements via RLS
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Policy: Allow insert only (append-only)
DROP POLICY IF EXISTS stock_movements_insert_only ON stock_movements;
CREATE POLICY stock_movements_insert_only ON stock_movements
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS stock_movements_select_all ON stock_movements;
CREATE POLICY stock_movements_select_all ON stock_movements
  FOR SELECT
  USING (true);

-- Note: No UPDATE or DELETE policies = those operations are blocked by RLS

CREATE INDEX IF NOT EXISTS idx_stock_movements_component ON stock_movements(component_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id);

-- ============================================================================
-- BILLS OF MATERIALS (BOMs / Bundles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_sku text UNIQUE NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boms_bundle_sku ON boms(bundle_sku);

-- BOM Component Requirements
CREATE TABLE IF NOT EXISTS bom_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  qty_required integer NOT NULL CHECK (qty_required > 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE(bom_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_bom_components_bom ON bom_components(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_components_component ON bom_components(component_id);

-- ============================================================================
-- LISTING MEMORY (Identity to BOM Mapping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS listing_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin text,
  sku text,
  title_fingerprint text,
  title_fingerprint_hash text,
  bom_id uuid REFERENCES boms(id) ON DELETE SET NULL,
  resolution_source text DEFAULT 'MANUAL',
  is_active boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES listing_memory(id),
  superseded_at timestamptz,
  created_at timestamptz DEFAULT now(),
  created_by_actor_type text,
  created_by_actor_id text,
  created_by_actor_display text
);

-- Unique constraints on active records only
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_memory_asin_active
  ON listing_memory(asin)
  WHERE asin IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_memory_sku_active
  ON listing_memory(sku)
  WHERE sku IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_memory_fingerprint_active
  ON listing_memory(title_fingerprint_hash)
  WHERE title_fingerprint_hash IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_listing_memory_bom ON listing_memory(bom_id);

-- ============================================================================
-- INTENT TO BOM RULES (Deterministic Parsing Rules)
-- ============================================================================

CREATE TABLE IF NOT EXISTS intent_to_bom_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  battery_qty integer,
  charger_included boolean,
  case_included boolean,
  bare_tool boolean,
  kit boolean,
  tool_core text,
  bom_id uuid NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intent_rules_bom ON intent_to_bom_rules(bom_id);

-- ============================================================================
-- REVIEW QUEUE
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  order_line_id uuid,
  external_id text,
  asin text,
  sku text,
  title text,
  title_fingerprint text,
  parse_intent jsonb,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'SKIPPED')),
  resolved_at timestamptz,
  resolved_by_actor_type text,
  resolved_by_actor_id text,
  resolved_by_actor_display text,
  resolution_bom_id uuid REFERENCES boms(id),
  resolution_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_created_at ON review_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_queue_order ON review_queue(order_id);

-- ============================================================================
-- ORDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id text NOT NULL,
  channel text NOT NULL DEFAULT 'shopify',
  status text NOT NULL DEFAULT 'IMPORTED' CHECK (status IN (
    'IMPORTED', 'NEEDS_REVIEW', 'READY_TO_PICK', 'PICKED', 'DISPATCHED', 'CANCELLED'
  )),
  order_date date,
  customer_email text,
  customer_name text,
  shipping_address jsonb,
  raw_payload jsonb,
  total_price_pence integer,
  currency text DEFAULT 'GBP',
  imported_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(external_order_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date DESC);

-- ============================================================================
-- ORDER LINES
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_line_id text,
  asin text,
  sku text,
  title text,
  title_fingerprint text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_pence integer,
  listing_memory_id uuid REFERENCES listing_memory(id),
  bom_id uuid REFERENCES boms(id),
  resolution_source text,
  is_resolved boolean NOT NULL DEFAULT false,
  parse_intent jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_resolved ON order_lines(is_resolved);
CREATE INDEX IF NOT EXISTS idx_order_lines_listing ON order_lines(listing_memory_id);

-- ============================================================================
-- PICK BATCHES
-- ============================================================================

CREATE TABLE IF NOT EXISTS pick_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number serial,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RESERVED', 'CONFIRMED', 'CANCELLED')),
  created_at timestamptz DEFAULT now(),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text,
  created_by_actor_display text,
  reserved_at timestamptz,
  reserved_by_actor_type text,
  reserved_by_actor_id text,
  reserved_by_actor_display text,
  confirmed_at timestamptz,
  confirmed_by_actor_type text,
  confirmed_by_actor_id text,
  confirmed_by_actor_display text,
  cancelled_at timestamptz,
  cancelled_by_actor_type text,
  cancelled_by_actor_id text,
  cancelled_by_actor_display text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_pick_batches_status ON pick_batches(status);
CREATE INDEX IF NOT EXISTS idx_pick_batches_created_at ON pick_batches(created_at DESC);

-- ============================================================================
-- PICK BATCH ORDERS (Junction Table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pick_batch_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_batch_id uuid NOT NULL REFERENCES pick_batches(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  created_at timestamptz DEFAULT now(),
  UNIQUE(pick_batch_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_pick_batch_orders_batch ON pick_batch_orders(pick_batch_id);
CREATE INDEX IF NOT EXISTS idx_pick_batch_orders_order ON pick_batch_orders(order_id);

-- ============================================================================
-- PICK BATCH LINES (IMMUTABLE - Component Requirements)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pick_batch_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_batch_id uuid NOT NULL REFERENCES pick_batches(id) ON DELETE RESTRICT,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  location text NOT NULL DEFAULT 'Warehouse',
  qty_required integer NOT NULL CHECK (qty_required > 0),
  created_at timestamptz DEFAULT now()
);

-- Prevent updates and deletes on pick_batch_lines
ALTER TABLE pick_batch_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pick_batch_lines_insert_only ON pick_batch_lines;
CREATE POLICY pick_batch_lines_insert_only ON pick_batch_lines
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS pick_batch_lines_select_all ON pick_batch_lines;
CREATE POLICY pick_batch_lines_select_all ON pick_batch_lines
  FOR SELECT
  USING (true);

CREATE INDEX IF NOT EXISTS idx_pick_batch_lines_batch ON pick_batch_lines(pick_batch_id);
CREATE INDEX IF NOT EXISTS idx_pick_batch_lines_component ON pick_batch_lines(component_id);

-- ============================================================================
-- RETURNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number serial,
  order_id uuid REFERENCES orders(id),
  order_line_id uuid REFERENCES order_lines(id),
  channel text DEFAULT 'amazon',
  reason_code text,
  customer_note text,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
    'RECEIVED', 'INSPECTED', 'CLOSED', 'CANCELLED'
  )),
  created_at timestamptz DEFAULT now(),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text,
  created_by_actor_display text,
  received_at timestamptz DEFAULT now(),
  inspected_at timestamptz,
  inspected_by_actor_type text,
  inspected_by_actor_id text,
  inspected_by_actor_display text,
  closed_at timestamptz,
  closed_by_actor_type text,
  closed_by_actor_id text,
  closed_by_actor_display text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns(created_at DESC);

-- ============================================================================
-- RETURN LINES
-- ============================================================================

CREATE TABLE IF NOT EXISTS return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
  qty integer NOT NULL CHECK (qty > 0),
  condition text NOT NULL CHECK (condition IN ('NEW', 'OPENED', 'DAMAGED', 'FAULTY')),
  disposition text NOT NULL DEFAULT 'UNDECIDED' CHECK (disposition IN (
    'UNDECIDED', 'RESTOCK', 'REFURB', 'SCRAP', 'SUPPLIER_RETURN'
  )),
  inspection_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_lines_return ON return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_component ON return_lines(component_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_disposition ON return_lines(disposition);

-- ============================================================================
-- KEEPA INTEGRATION
-- ============================================================================

-- Keepa Products Cache
CREATE TABLE IF NOT EXISTS keepa_products_cache (
  asin text PRIMARY KEY,
  domain_id integer NOT NULL DEFAULT 2,  -- UK (amazon.co.uk)
  payload_json jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keepa_cache_expires ON keepa_products_cache(expires_at);

-- Keepa Metrics Daily
CREATE TABLE IF NOT EXISTS keepa_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin text NOT NULL,
  date date NOT NULL,
  buybox_price_pence integer,
  amazon_price_pence integer,
  new_price_pence integer,
  used_price_pence integer,
  sales_rank integer,
  offer_count integer,
  rating numeric(3,2),
  review_count integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(asin, date)
);

CREATE INDEX IF NOT EXISTS idx_keepa_metrics_asin ON keepa_metrics_daily(asin);
CREATE INDEX IF NOT EXISTS idx_keepa_metrics_date ON keepa_metrics_daily(date DESC);

-- Keepa Request Log
CREATE TABLE IF NOT EXISTS keepa_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  endpoint text NOT NULL,
  asins_count integer NOT NULL DEFAULT 0,
  tokens_estimated integer NOT NULL DEFAULT 0,
  tokens_spent integer,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'BUDGET_EXCEEDED')),
  latency_ms integer,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keepa_log_requested_at ON keepa_request_log(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_keepa_log_status ON keepa_request_log(status);

-- Keepa Budget Settings
CREATE TABLE IF NOT EXISTS keepa_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Insert default settings
INSERT INTO keepa_settings (setting_key, setting_value) VALUES
  ('max_tokens_per_hour', '800'),
  ('max_tokens_per_day', '6000'),
  ('min_reserve', '200'),
  ('min_refresh_minutes', '720'),
  ('domain_id', '2')  -- UK (amazon.co.uk)
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- AUDIT LOG (Configuration Changes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUPERSEDE', 'RESOLVE', 'CANCEL', 'CONFIRM'
  )),
  before_json jsonb,
  after_json jsonb,
  changes_summary text,
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM')),
  actor_id text,
  actor_display text,
  ip_address text,
  correlation_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log(correlation_id);

-- ============================================================================
-- IDEMPOTENCY KEYS
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE NOT NULL,
  endpoint text NOT NULL,
  request_hash text,
  response_status integer,
  response_body jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_keys(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- ============================================================================
-- JOBS QUEUE (For Scheduled Tasks)
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  priority integer NOT NULL DEFAULT 0,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);

-- ============================================================================
-- SYSTEM EVENTS (For Audit Timeline)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  description text,
  metadata jsonb,
  severity text DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(event_type);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events(entity_type, entity_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_components_updated_at ON components;
CREATE TRIGGER update_components_updated_at
    BEFORE UPDATE ON components
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_component_stock_updated_at ON component_stock;
CREATE TRIGGER update_component_stock_updated_at
    BEFORE UPDATE ON component_stock
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_boms_updated_at ON boms;
CREATE TRIGGER update_boms_updated_at
    BEFORE UPDATE ON boms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
