-- ============================================================================
-- KEEPA DEMAND MODEL TABLES
-- Stores trained models for calibrated demand forecasting
-- ============================================================================

-- Model training runs (audit + rollback capability)
CREATE TABLE IF NOT EXISTS keepa_demand_model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id integer NOT NULL DEFAULT 3,
  model_name text NOT NULL DEFAULT 'rank_loglinear_ridge_v1',
  lookback_days integer NOT NULL,
  trained_from date NOT NULL,
  trained_to date NOT NULL,
  feature_names jsonb NOT NULL,                    -- e.g. ["ln_rank","ln_offer","ln_price"]
  feature_means jsonb NOT NULL,                    -- {ln_rank:..., ln_offer:..., ln_price:...}
  feature_stds jsonb NOT NULL,                     -- {ln_rank:..., ln_offer:..., ln_price:...}
  coefficients jsonb NOT NULL,                     -- {intercept:..., ln_rank:..., ln_offer:..., ln_price:...}
  ridge_lambda numeric NOT NULL DEFAULT 1,
  training_summary jsonb,                          -- {asins_total, rows_total, dropped_missing_keepa, dropped_missing_sales}
  metrics jsonb,                                   -- {holdout_mae, holdout_rmse, holdout_r2_log, holdout_mape_nonzero}
  is_active boolean NOT NULL DEFAULT false,
  trained_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_keepa_demand_model_runs_domain_trained_at
  ON keepa_demand_model_runs(domain_id, trained_at DESC);

CREATE INDEX IF NOT EXISTS idx_keepa_demand_model_runs_active
  ON keepa_demand_model_runs(domain_id) WHERE is_active = true;

-- ============================================================================
-- ASIN FEATURES CACHE (for debugging/auditing what the model saw)
-- ============================================================================

CREATE TABLE IF NOT EXISTS keepa_demand_model_asin_features_cache (
  asin text NOT NULL,
  date date NOT NULL,
  sales_rank integer,
  offer_count integer,
  buybox_price_pence integer,
  PRIMARY KEY (asin, date)
);

-- ============================================================================
-- DEFAULT SETTINGS FOR DEMAND MODEL
-- ============================================================================

INSERT INTO keepa_settings (setting_key, setting_value) VALUES
  ('demand_model_enabled', 'true'),
  ('demand_model_refresh_minutes', '1440'),
  ('demand_model_lookback_days', '60'),
  ('demand_model_min_asins', '50'),
  ('demand_model_ridge_lambda', '1')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- SAFETY INDEX FOR IDEMPOTENT ORDER IMPORTS
-- Enables importing historical order reports without duplicates
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_lines_order_external_line_unique
  ON order_lines(order_id, external_line_id) WHERE external_line_id IS NOT NULL;
