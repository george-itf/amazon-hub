-- Amazon Hub Brain database schema

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table for authentication and role management
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  name text,
  picture text,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamp with time zone DEFAULT now()
);

-- Components (source of truth)
CREATE TABLE IF NOT EXISTS components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_sku text UNIQUE NOT NULL,
  description text,
  brand text,
  cost_ex_vat numeric,
  created_at timestamp with time zone DEFAULT now()
);

-- Bills of materials / bundles
CREATE TABLE IF NOT EXISTS boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_sku text UNIQUE NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now()
);

-- Components required per BOM
CREATE TABLE IF NOT EXISTS bom_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  qty_required integer NOT NULL CHECK (qty_required > 0)
);

-- Memory: mapping listing identities to a BOM
CREATE TABLE IF NOT EXISTS listing_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin text,
  sku text,
  title_fingerprint text,
  bom_id uuid REFERENCES boms(id),
  created_at timestamp with time zone DEFAULT now()
);

-- Enforce unique identity across asin, sku and title_fingerprint.  The
-- "nulls not distinct" clause ensures that multiple rows with null
-- values are treated as distinct while preventing duplicates when a
-- value is present.
ALTER TABLE listing_memory
  ADD CONSTRAINT IF NOT EXISTS listing_memory_unique_identity
  UNIQUE NULLS NOT DISTINCT (asin, sku, title_fingerprint);

-- Review queue for ambiguous listings
CREATE TABLE IF NOT EXISTS review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  asin text,
  sku text,
  title text,
  reason text,
  created_at timestamp with time zone DEFAULT now()
);

-- Orders table (stores Shopify/Amazon orders)
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_order_id text NOT NULL,
  channel text NOT NULL,
  order_date date,
  created_at timestamp with time zone DEFAULT now()
);

-- Order lines referencing listing_memory
CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listing_memory(id),
  quantity integer NOT NULL CHECK (quantity > 0)
);