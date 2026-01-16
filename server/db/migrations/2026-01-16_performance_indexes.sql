-- Performance Indexes Migration
-- Adds indexes to optimize common query patterns identified in analytics and dashboard routes

-- ============================================
-- Orders table indexes
-- ============================================

-- order_date is used extensively for date range filtering in analytics
-- Combined with channel for common filtering pattern
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel_date ON orders(channel, order_date DESC);

-- Status filtering for order management
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================
-- Order Lines table indexes
-- ============================================

-- Frequently joined with orders and filtered by ASIN
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_asin ON order_lines(asin);

-- ============================================
-- Component Stock table indexes
-- ============================================

-- Location-based queries are very common in inventory management
CREATE INDEX IF NOT EXISTS idx_component_stock_location ON component_stock(location);
CREATE INDEX IF NOT EXISTS idx_component_stock_component_location ON component_stock(component_id, location);

-- Low stock alerts use on_hand comparisons
CREATE INDEX IF NOT EXISTS idx_component_stock_on_hand ON component_stock(on_hand);

-- ============================================
-- Components table indexes
-- ============================================

-- Active components filtering
CREATE INDEX IF NOT EXISTS idx_components_is_active ON components(is_active);

-- SKU lookups
CREATE INDEX IF NOT EXISTS idx_components_sku ON components(sku);

-- ============================================
-- BOMs table indexes
-- ============================================

-- Review status filtering
CREATE INDEX IF NOT EXISTS idx_boms_review_status ON boms(review_status);

-- Active BOMs
CREATE INDEX IF NOT EXISTS idx_boms_is_active ON boms(is_active);

-- ============================================
-- BOM Components table indexes
-- ============================================

-- BOM lookups (already has foreign key, but explicit index helps)
CREATE INDEX IF NOT EXISTS idx_bom_components_bom_id ON bom_components(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_components_component_id ON bom_components(component_id);

-- ============================================
-- Listing Memory table indexes
-- ============================================

-- BOM assignment lookups
CREATE INDEX IF NOT EXISTS idx_listing_memory_bom_id ON listing_memory(bom_id);

-- ASIN lookups
CREATE INDEX IF NOT EXISTS idx_listing_memory_asin ON listing_memory(asin);

-- ============================================
-- Keepa Metrics Daily table indexes
-- ============================================

-- Date range queries for analytics
CREATE INDEX IF NOT EXISTS idx_keepa_metrics_date ON keepa_metrics_daily(date DESC);

-- ASIN + date for product-specific analytics
CREATE INDEX IF NOT EXISTS idx_keepa_metrics_asin_date ON keepa_metrics_daily(asin, date DESC);

-- ============================================
-- Audit Log table indexes
-- ============================================

-- Time-based queries
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- Entity lookups
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- ============================================
-- Stock Movements table indexes
-- ============================================

-- Component history lookups
CREATE INDEX IF NOT EXISTS idx_stock_movements_component_id ON stock_movements(component_id);

-- Time-based movement history
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);

-- ============================================
-- System Events table indexes
-- ============================================

-- Time-based event lookups
CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at DESC);

-- Event type filtering
CREATE INDEX IF NOT EXISTS idx_system_events_event_type ON system_events(event_type);

-- ============================================
-- Demand Model tables indexes
-- ============================================

-- Active model lookup
CREATE INDEX IF NOT EXISTS idx_demand_models_is_active ON demand_models(is_active);

-- Forecast lookups by model and component
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_model_id ON demand_forecasts(model_id);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_component_id ON demand_forecasts(component_id);

-- ============================================
-- Partial indexes for common filter patterns
-- ============================================

-- Partial index for pending review BOMs (commonly queried)
CREATE INDEX IF NOT EXISTS idx_boms_pending_review
  ON boms(created_at DESC)
  WHERE review_status = 'PENDING_REVIEW';

-- Partial index for active components with stock issues
CREATE INDEX IF NOT EXISTS idx_components_active
  ON components(id)
  WHERE is_active = true;

-- Partial index for Amazon orders (most common channel)
CREATE INDEX IF NOT EXISTS idx_orders_amazon
  ON orders(order_date DESC)
  WHERE channel = 'AMAZON';

-- ============================================
-- Composite indexes for common query patterns
-- ============================================

-- Orders analytics common pattern: channel + date range + status
CREATE INDEX IF NOT EXISTS idx_orders_analytics
  ON orders(channel, order_date DESC, status);

-- Stock lookup pattern: component + location + on_hand for availability checks
CREATE INDEX IF NOT EXISTS idx_component_stock_availability
  ON component_stock(component_id, location, on_hand);
