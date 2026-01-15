-- ============================================================================
-- ANALYTICS ENHANCEMENTS
-- Adds last_sold_at tracking for dead stock analysis
-- ============================================================================

-- Add last_sold_at column to components for dead stock detection
ALTER TABLE components
ADD COLUMN IF NOT EXISTS last_sold_at timestamptz;

-- Create index for dead stock queries
CREATE INDEX IF NOT EXISTS idx_components_last_sold_at
  ON components(last_sold_at)
  WHERE last_sold_at IS NOT NULL;

-- Add amazon_fee_percent to listing_memory for fee tracking (optional override)
ALTER TABLE listing_memory
ADD COLUMN IF NOT EXISTS amazon_fee_percent numeric(5,2);

COMMENT ON COLUMN components.last_sold_at IS 'Timestamp of last sale involving this component';
COMMENT ON COLUMN listing_memory.amazon_fee_percent IS 'Override Amazon referral fee percentage';

-- Function to update component last_sold_at when order lines are created
-- This is triggered when orders are fulfilled/shipped
CREATE OR REPLACE FUNCTION update_component_last_sold_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Update last_sold_at for all components in the BOM
  -- Only if the order_line has a bom_id
  IF NEW.bom_id IS NOT NULL THEN
    UPDATE components c
    SET last_sold_at = NOW()
    FROM bom_components bc
    WHERE bc.bom_id = NEW.bom_id
      AND bc.component_id = c.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on order_lines insert/update with resolved bom_id
DROP TRIGGER IF EXISTS trg_update_component_last_sold ON order_lines;
CREATE TRIGGER trg_update_component_last_sold
  AFTER INSERT OR UPDATE OF bom_id ON order_lines
  FOR EACH ROW
  WHEN (NEW.bom_id IS NOT NULL)
  EXECUTE FUNCTION update_component_last_sold_at();
