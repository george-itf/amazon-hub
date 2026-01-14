#!/usr/bin/env python3
"""
Amazon Hub Brain - Data Import Script
Imports components, creates BOMs, and sets up listing memory from supplier files.
"""

import pandas as pd
import json
import re
import hashlib
import os
from datetime import datetime

# Configuration
BASE_DIR = '/home/user/amazon-hub'
COST_FILES = {
    'MAK': f'{BASE_DIR}/MAK-STOCK-COST.xlsx',
    'DEW': f'{BASE_DIR}/DEW-STOCK-COST.xlsx',
    'TIMCO': f'{BASE_DIR}/TIMCO-STOCK-COST.xlsx'
}
AMAZON_LISTINGS_FILE = f'{BASE_DIR}/All+Listings+Report_01-14-2026.txt'
OUTPUT_DIR = f'{BASE_DIR}/server/scripts/output'

# Brand mapping
BRAND_MAP = {
    'MAK': 'Makita',
    'DEW': 'DeWalt',
    'TIMCO': 'TIMCO'
}

def ensure_output_dir():
    """Create output directory if it doesn't exist."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def normalize_sku(sku):
    """Normalize SKU for consistent matching."""
    if not sku:
        return None
    return str(sku).strip().upper()

def fingerprint_title(title):
    """Create normalized fingerprint from title."""
    if not title:
        return None
    # Lowercase, remove special chars, collapse whitespace
    fp = str(title).lower()
    fp = re.sub(r'[^a-z0-9\s]', ' ', fp)
    fp = re.sub(r'\s+', ' ', fp).strip()
    return fp

def hash_fingerprint(fp):
    """Create SHA256 hash of fingerprint."""
    if not fp:
        return None
    return hashlib.sha256(fp.encode()).hexdigest()

def parse_compound_sku(sku):
    """
    Parse compound SKUs like 'MAKDJR186+2xBL1850+DC18RC' into components.
    Returns list of (component_pattern, quantity) tuples.
    """
    if not sku:
        return []

    components = []
    # Split by + or /
    parts = re.split(r'[+/]', sku)

    for part in parts:
        part = part.strip()
        if not part:
            continue

        # Check for quantity prefix like "2x" or "(x2)"
        qty_match = re.match(r'^(\d+)x(.+)$', part, re.IGNORECASE)
        if qty_match:
            qty = int(qty_match.group(1))
            component = qty_match.group(2).strip()
        else:
            qty_match = re.match(r'^(.+)\(x(\d+)\)$', part, re.IGNORECASE)
            if qty_match:
                component = qty_match.group(1).strip()
                qty = int(qty_match.group(2))
            else:
                qty = 1
                component = part

        components.append((component, qty))

    return components

def load_cost_files():
    """Load all cost files into a unified component list."""
    all_components = []

    for prefix, filepath in COST_FILES.items():
        print(f"Loading {filepath}...")
        df = pd.read_excel(filepath)

        for _, row in df.iterrows():
            stock_code = str(row.get('Stock-Code', '')).strip()
            description = str(row.get('Description', '')).strip()
            cost = row.get('Cost', 0)
            per = row.get('Per', 1)

            if not stock_code or stock_code == 'nan':
                continue

            # Convert cost to pence (assuming cost is in £)
            try:
                cost_pence = int(float(cost) * 100)
            except:
                cost_pence = 0

            all_components.append({
                'internal_sku': stock_code,
                'description': description if description != 'nan' else '',
                'brand': BRAND_MAP.get(prefix, 'Unknown'),
                'cost_ex_vat_pence': cost_pence,
                'is_active': True,
                'source_file': prefix
            })

    print(f"Total components loaded: {len(all_components)}")
    return all_components

def load_amazon_listings():
    """Load Amazon listings file."""
    print(f"Loading {AMAZON_LISTINGS_FILE}...")
    # Try different encodings for Amazon report
    for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
        try:
            df = pd.read_csv(AMAZON_LISTINGS_FILE, sep='\t', dtype=str, encoding=encoding)
            print(f"  (using {encoding} encoding)")
            break
        except UnicodeDecodeError:
            continue

    listings = []
    for _, row in df.iterrows():
        item_name = str(row.get('item-name', '')).strip()
        seller_sku = str(row.get('seller-sku', '')).strip()
        asin = str(row.get('asin1', '')).strip()
        price = row.get('price', '0')
        status = str(row.get('status', '')).strip()

        if not item_name or item_name == 'nan':
            continue
        if not seller_sku or seller_sku == 'nan':
            continue

        # Skip inactive listings
        if status.lower() == 'inactive':
            continue

        try:
            price_pence = int(float(price) * 100)
        except:
            price_pence = 0

        listings.append({
            'item_name': item_name,
            'seller_sku': seller_sku,
            'asin': asin if asin != 'nan' else None,
            'price_pence': price_pence,
            'fingerprint': fingerprint_title(item_name),
            'fingerprint_hash': hash_fingerprint(fingerprint_title(item_name))
        })

    print(f"Total Amazon listings loaded: {len(listings)}")
    return listings

def create_component_sql(components):
    """Generate SQL for inserting components."""
    sql_lines = [
        "-- Components Import",
        "-- Generated: " + datetime.now().isoformat(),
        "",
        "INSERT INTO components (internal_sku, description, brand, cost_ex_vat_pence, is_active)",
        "VALUES"
    ]

    # Deduplicate components by internal_sku (keep first occurrence)
    seen_skus = set()
    unique_components = []
    for comp in components:
        sku_upper = comp['internal_sku'].upper()
        if sku_upper not in seen_skus:
            seen_skus.add(sku_upper)
            unique_components.append(comp)

    values = []
    for comp in unique_components:
        sku = comp['internal_sku'].replace("'", "''")
        desc = comp['description'].replace("'", "''")[:500]  # Limit description length
        brand = comp['brand'].replace("'", "''")
        cost = comp['cost_ex_vat_pence']

        values.append(f"  ('{sku}', '{desc}', '{brand}', {cost}, true)")

    sql_lines.append(',\n'.join(values))
    sql_lines.append("ON CONFLICT (internal_sku) DO UPDATE SET")
    sql_lines.append("  description = EXCLUDED.description,")
    sql_lines.append("  brand = EXCLUDED.brand,")
    sql_lines.append("  cost_ex_vat_pence = EXCLUDED.cost_ex_vat_pence,")
    sql_lines.append("  updated_at = now();")

    # Return SQL and unique count for logging
    return '\n'.join(sql_lines), len(unique_components)

def match_component_to_import(component_pattern, all_components):
    """Try to match a component pattern to an imported component."""
    pattern_upper = component_pattern.upper()

    # Direct match
    for comp in all_components:
        if comp['internal_sku'].upper() == pattern_upper:
            return comp['internal_sku']

    # Partial match (pattern contains or is contained by SKU)
    for comp in all_components:
        sku_upper = comp['internal_sku'].upper()
        if pattern_upper in sku_upper or sku_upper in pattern_upper:
            return comp['internal_sku']

    # Try with common prefixes removed/added
    prefixes = ['MAK', 'DEW', 'MAKITA', 'DEWALT']
    for prefix in prefixes:
        # Try adding prefix
        if not pattern_upper.startswith(prefix):
            test_pattern = prefix + pattern_upper
            for comp in all_components:
                if comp['internal_sku'].upper() == test_pattern:
                    return comp['internal_sku']
        # Try removing prefix
        if pattern_upper.startswith(prefix):
            test_pattern = pattern_upper[len(prefix):]
            for comp in all_components:
                if comp['internal_sku'].upper() == test_pattern:
                    return comp['internal_sku']

    return None

def create_boms_and_listings(listings, all_components):
    """Create BOMs and listing memory entries from Amazon listings."""
    boms = []
    bom_components_list = []
    listing_memory = []
    unmatched = []

    # Create a lookup for quick component matching
    component_lookup = {comp['internal_sku'].upper(): comp for comp in all_components}

    for listing in listings:
        seller_sku = listing['seller_sku']
        item_name = listing['item_name']
        asin = listing['asin']

        # Parse the SKU to find components
        parsed = parse_compound_sku(seller_sku)

        matched_components = []
        for pattern, qty in parsed:
            matched_sku = match_component_to_import(pattern, all_components)
            if matched_sku:
                matched_components.append((matched_sku, qty))

        # If we couldn't match any components from SKU, try to create single-component BOM
        if not matched_components:
            # Try to find a component that matches the item name
            for comp in all_components:
                if comp['description'] and item_name:
                    comp_desc_upper = comp['description'].upper()
                    item_upper = item_name.upper()
                    # Check for significant overlap
                    if len(comp_desc_upper) > 10 and (comp_desc_upper in item_upper or item_upper in comp_desc_upper):
                        matched_components.append((comp['internal_sku'], 1))
                        break

        # Create BOM
        bom_sku = seller_sku.replace("'", "''")
        bom_desc = item_name[:500].replace("'", "''") if item_name else ''

        boms.append({
            'bundle_sku': seller_sku,
            'description': item_name[:500] if item_name else '',
            'is_active': True
        })

        # Add BOM components if we found matches
        for comp_sku, qty in matched_components:
            bom_components_list.append({
                'bom_sku': seller_sku,
                'component_sku': comp_sku,
                'qty_required': qty
            })

        if not matched_components:
            unmatched.append({
                'seller_sku': seller_sku,
                'item_name': item_name,
                'asin': asin
            })

        # Create listing memory entry
        listing_memory.append({
            'asin': asin,
            'sku': seller_sku,
            'title_fingerprint': listing['fingerprint'],
            'title_fingerprint_hash': listing['fingerprint_hash'],
            'bom_sku': seller_sku,  # Will be linked to BOM by bundle_sku
            'resolution_source': 'IMPORT'
        })

    return boms, bom_components_list, listing_memory, unmatched

def create_bom_sql(boms):
    """Generate SQL for inserting BOMs."""
    sql_lines = [
        "-- BOMs Import",
        "-- Generated: " + datetime.now().isoformat(),
        "",
        "INSERT INTO boms (bundle_sku, description, is_active)",
        "VALUES"
    ]

    values = []
    for bom in boms:
        sku = bom['bundle_sku'].replace("'", "''")
        desc = bom['description'].replace("'", "''")
        values.append(f"  ('{sku}', '{desc}', true)")

    sql_lines.append(',\n'.join(values))
    sql_lines.append("ON CONFLICT (bundle_sku) DO UPDATE SET")
    sql_lines.append("  description = EXCLUDED.description,")
    sql_lines.append("  updated_at = now();")

    return '\n'.join(sql_lines)

def create_bom_components_sql(bom_components):
    """Generate SQL for linking BOM components."""
    sql_lines = [
        "-- BOM Components Import",
        "-- Generated: " + datetime.now().isoformat(),
        "",
        "-- This requires BOMs and components to exist first",
        "INSERT INTO bom_components (bom_id, component_id, qty_required)",
        "SELECT b.id, c.id, v.qty_required",
        "FROM (VALUES"
    ]

    values = []
    for bc in bom_components:
        bom_sku = bc['bom_sku'].replace("'", "''")
        comp_sku = bc['component_sku'].replace("'", "''")
        qty = bc['qty_required']
        values.append(f"  ('{bom_sku}', '{comp_sku}', {qty})")

    sql_lines.append(',\n'.join(values))
    sql_lines.append(") AS v(bom_sku, component_sku, qty_required)")
    sql_lines.append("JOIN boms b ON b.bundle_sku = v.bom_sku")
    sql_lines.append("JOIN components c ON c.internal_sku = v.component_sku")
    sql_lines.append("ON CONFLICT (bom_id, component_id) DO UPDATE SET")
    sql_lines.append("  qty_required = EXCLUDED.qty_required;")

    return '\n'.join(sql_lines)

def create_listing_memory_sql(listings):
    """Generate SQL for creating listing memory entries."""
    sql_lines = [
        "-- Listing Memory Import",
        "-- Generated: " + datetime.now().isoformat(),
        "",
        "-- Link listings to BOMs by bundle_sku",
        "INSERT INTO listing_memory (asin, sku, title_fingerprint, title_fingerprint_hash, bom_id, resolution_source, is_active)",
        "SELECT",
        "  v.asin,",
        "  v.sku,",
        "  v.title_fingerprint,",
        "  v.title_fingerprint_hash,",
        "  b.id,",
        "  'IMPORT',",
        "  true",
        "FROM (VALUES"
    ]

    values = []
    for lm in listings:
        asin = f"'{lm['asin']}'" if lm['asin'] else 'NULL'
        sku = lm['sku'].replace("'", "''") if lm['sku'] else ''
        fp = lm['title_fingerprint'].replace("'", "''") if lm['title_fingerprint'] else ''
        fp_hash = lm['title_fingerprint_hash'] if lm['title_fingerprint_hash'] else ''
        bom_sku = lm['bom_sku'].replace("'", "''")

        values.append(f"  ({asin}, '{sku}', '{fp}', '{fp_hash}', '{bom_sku}')")

    sql_lines.append(',\n'.join(values))
    sql_lines.append(") AS v(asin, sku, title_fingerprint, title_fingerprint_hash, bom_sku)")
    sql_lines.append("JOIN boms b ON b.bundle_sku = v.bom_sku")
    sql_lines.append("ON CONFLICT DO NOTHING;")

    return '\n'.join(sql_lines)

def main():
    """Main import process."""
    print("=" * 60)
    print("Amazon Hub Brain - Data Import")
    print("=" * 60)

    ensure_output_dir()

    # Step 1: Load all data
    print("\n[Step 1] Loading cost files...")
    all_components = load_cost_files()

    print("\n[Step 2] Loading Amazon listings...")
    amazon_listings = load_amazon_listings()

    # Step 2: Create BOMs and listing memory
    print("\n[Step 3] Creating BOMs and listing memory...")
    boms, bom_components, listing_memory, unmatched = create_boms_and_listings(
        amazon_listings, all_components
    )

    # Step 3: Generate SQL files
    print("\n[Step 4] Generating SQL files...")

    # Components SQL
    components_sql, unique_count = create_component_sql(all_components)
    with open(f'{OUTPUT_DIR}/01_components.sql', 'w') as f:
        f.write(components_sql)
    print(f"  - 01_components.sql ({unique_count} unique components, {len(all_components) - unique_count} duplicates removed)")

    # BOMs SQL
    boms_sql = create_bom_sql(boms)
    with open(f'{OUTPUT_DIR}/02_boms.sql', 'w') as f:
        f.write(boms_sql)
    print(f"  - 02_boms.sql ({len(boms)} BOMs)")

    # BOM Components SQL (only if we have matched components)
    if bom_components:
        bom_comp_sql = create_bom_components_sql(bom_components)
        with open(f'{OUTPUT_DIR}/03_bom_components.sql', 'w') as f:
            f.write(bom_comp_sql)
        print(f"  - 03_bom_components.sql ({len(bom_components)} links)")

    # Listing Memory SQL
    listing_sql = create_listing_memory_sql(listing_memory)
    with open(f'{OUTPUT_DIR}/04_listing_memory.sql', 'w') as f:
        f.write(listing_sql)
    print(f"  - 04_listing_memory.sql ({len(listing_memory)} rules)")

    # Unmatched report
    if unmatched:
        with open(f'{OUTPUT_DIR}/unmatched_listings.json', 'w') as f:
            json.dump(unmatched, f, indent=2)
        print(f"  - unmatched_listings.json ({len(unmatched)} items need manual review)")

    # Summary
    print("\n" + "=" * 60)
    print("IMPORT SUMMARY")
    print("=" * 60)
    print(f"Components:        {unique_count} (unique)")
    print(f"BOMs:              {len(boms)}")
    print(f"BOM Components:    {len(bom_components)}")
    print(f"Listing Memory:    {len(listing_memory)}")
    print(f"Unmatched:         {len(unmatched)}")
    print("\nSQL files generated in:", OUTPUT_DIR)
    print("\nNext steps:")
    print("1. Review the SQL files")
    print("2. Run them in Supabase SQL editor in order (01, 02, 03, 04)")
    print("3. Call POST /orders/re-evaluate to resolve pending orders")

if __name__ == '__main__':
    main()
