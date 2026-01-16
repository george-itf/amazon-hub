-- ============================================================================
-- Amazon Hub Brain - Order Line Source Migration
-- Version: 010
-- Description: Add line_source column to track origin of order line data
-- ============================================================================

-- Add line_source column to order_lines
-- This tracks whether line data came from Shopify or Amazon
-- When Amazon order links to Shopify order, lines are replaced with Amazon data
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS line_source text;

-- Set default for existing rows (they came from their order's channel)
-- This UPDATE is safe because it only affects rows where line_source is NULL
UPDATE order_lines ol
SET line_source = UPPER(o.channel)
FROM orders o
WHERE ol.order_id = o.id
  AND ol.line_source IS NULL;

-- Add check constraint for valid values
-- Note: Using DO block to make this idempotent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_lines_line_source_check'
  ) THEN
    ALTER TABLE order_lines
    ADD CONSTRAINT order_lines_line_source_check
    CHECK (line_source IS NULL OR line_source IN ('SHOPIFY', 'AMAZON'));
  END IF;
END $$;

-- Add index for filtering by source (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_order_lines_line_source ON order_lines(line_source)
  WHERE line_source IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN order_lines.line_source IS 'Origin of line item data: SHOPIFY (from Shopify import) or AMAZON (from SP-API sync/replacement)';
