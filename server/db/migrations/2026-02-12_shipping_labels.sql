-- ============================================================================
-- SHIPPING LABELS TABLE
-- Stores Royal Mail label metadata and tracking info per order
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipping_labels (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  label_id text UNIQUE,
  tracking_number text,
  service_code text NOT NULL,
  price_pence integer,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'PENDING', 'CREATED', 'FAILED', 'CANCELLED', 'DISPATCHED'
  )),
  carrier text DEFAULT 'Royal Mail',
  payload jsonb,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_shipping_labels_order_id ON shipping_labels(order_id);
CREATE INDEX idx_shipping_labels_tracking ON shipping_labels(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX idx_shipping_labels_status ON shipping_labels(status);
CREATE INDEX idx_shipping_labels_created_at ON shipping_labels(created_at DESC);

-- Prevent duplicate labels for the same order (unless previous was cancelled/failed)
CREATE UNIQUE INDEX idx_shipping_labels_order_active
  ON shipping_labels(order_id)
  WHERE status NOT IN ('CANCELLED', 'FAILED');

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_shipping_labels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shipping_labels_updated_at
  BEFORE UPDATE ON shipping_labels
  FOR EACH ROW
  EXECUTE FUNCTION update_shipping_labels_updated_at();

COMMENT ON TABLE shipping_labels IS 'Royal Mail labels and tracking metadata per order';
COMMENT ON COLUMN shipping_labels.label_id IS 'Royal Mail Click & Drop order/label ID';
COMMENT ON COLUMN shipping_labels.price_pence IS 'Label cost in pence';
COMMENT ON COLUMN shipping_labels.payload IS 'Full Royal Mail API response payload';
