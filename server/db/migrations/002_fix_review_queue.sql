-- Fix review_queue table to match expected schema
-- Run this if the review queue page shows "Failed to fetch review queue"

-- Add missing columns if they don't exist
DO $$
BEGIN
  -- Add status column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'status') THEN
    ALTER TABLE review_queue ADD COLUMN status text NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING', 'RESOLVED', 'SKIPPED'));
  END IF;

  -- Add order_id column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'order_id') THEN
    ALTER TABLE review_queue ADD COLUMN order_id uuid;
  END IF;

  -- Add order_line_id column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'order_line_id') THEN
    ALTER TABLE review_queue ADD COLUMN order_line_id uuid;
  END IF;

  -- Add title_fingerprint column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'title_fingerprint') THEN
    ALTER TABLE review_queue ADD COLUMN title_fingerprint text;
  END IF;

  -- Add parse_intent column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'parse_intent') THEN
    ALTER TABLE review_queue ADD COLUMN parse_intent jsonb;
  END IF;

  -- Add resolved_at column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'resolved_at') THEN
    ALTER TABLE review_queue ADD COLUMN resolved_at timestamptz;
  END IF;

  -- Add resolved_by columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'resolved_by_actor_type') THEN
    ALTER TABLE review_queue ADD COLUMN resolved_by_actor_type text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'resolved_by_actor_id') THEN
    ALTER TABLE review_queue ADD COLUMN resolved_by_actor_id text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'resolved_by_actor_display') THEN
    ALTER TABLE review_queue ADD COLUMN resolved_by_actor_display text;
  END IF;

  -- Add resolution_bom_id column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'resolution_bom_id') THEN
    ALTER TABLE review_queue ADD COLUMN resolution_bom_id uuid REFERENCES boms(id);
  END IF;

  -- Add resolution_note column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'review_queue' AND column_name = 'resolution_note') THEN
    ALTER TABLE review_queue ADD COLUMN resolution_note text;
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_created_at ON review_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_queue_order ON review_queue(order_id);
