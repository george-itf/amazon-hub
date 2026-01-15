-- Migration: Add BOM review status columns
-- Purpose: Allow auto-created BOMs to be reviewed before they become active

-- Add review_status column with default 'APPROVED' for existing BOMs
ALTER TABLE boms
ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'APPROVED';

-- Add reviewed_at timestamp
ALTER TABLE boms
ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;

-- Add rejection_reason for tracking why a BOM was rejected
ALTER TABLE boms
ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Create index on review_status for efficient filtering
CREATE INDEX IF NOT EXISTS idx_boms_review_status ON boms(review_status);

-- Set existing BOMs to APPROVED (they were manually created)
UPDATE boms
SET review_status = 'APPROVED', reviewed_at = created_at
WHERE review_status IS NULL;

-- Add NOT NULL constraint after backfilling
ALTER TABLE boms
ALTER COLUMN review_status SET NOT NULL;

COMMENT ON COLUMN boms.review_status IS 'Review status: PENDING_REVIEW, APPROVED, or REJECTED';
COMMENT ON COLUMN boms.reviewed_at IS 'Timestamp when the BOM was approved or rejected';
COMMENT ON COLUMN boms.rejection_reason IS 'Reason given when rejecting a BOM';
