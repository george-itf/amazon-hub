# Deprecated Pages - Quarantine Zone

These pages have been moved to this folder during the 2026-01-15 restructuring to the clean 7-page architecture.

## Quarantine Protocol

These files are NOT deleted immediately. Instead:
1. Pages are moved here first
2. Application is tested with new architecture
3. If no issues after 2 weeks, pages can be safely deleted

## New Architecture

The application now uses a clean 7-page structure:

1. **Dashboard** - Orders overview, pipeline, quick actions
2. **Inventory** - Component stock with custom tabs by brand/type
3. **Amazon Listings** - All listings with tabs, filters, BOM assignment, shipping rules
4. **ASIN Analyzer** - Multi-ASIN analysis with red-yellow-green scoring
5. **Shipping** - Royal Mail integration, batch labels, tracking
6. **Analytics** - Profitability, dead stock, movers, stock risk
7. **Settings** - System health, defaults, shipping rules configuration

## Quarantined Pages

### AmazonPage.jsx
**Reason**: Functionality merged into AmazonListingsPage.jsx and Dashboard
**Safe to delete after**: 2026-01-29

### ListingsPage.jsx (Mapping Rules)
**Reason**: Functionality merged into AmazonListingsPage.jsx
**Safe to delete after**: 2026-01-29

### ComponentsPage.jsx
**Reason**: Functionality merged into InventoryPage.jsx
**Safe to delete after**: 2026-01-29

### OrdersPage.jsx
**Reason**: Order management now in Dashboard pipeline view
**Safe to delete after**: 2026-01-29

### ProfitPage.jsx
**Reason**: Functionality merged into AnalyticsPage.jsx (Profitability tab)
**Safe to delete after**: 2026-01-29

### BundlesPage.jsx
**Reason**: Bundle/BOM management accessible via listing modals
**Safe to delete after**: 2026-01-29

### PicklistsPage.jsx
**Reason**: Picklists now integrated into shipping workflow
**Safe to delete after**: 2026-01-29

### ReplenishmentPage.jsx
**Reason**: Stock risk visible in AnalyticsPage.jsx
**Safe to delete after**: 2026-01-29

### ReturnsPage.jsx
**Reason**: Returns handling simplified in order management
**Safe to delete after**: 2026-01-29

### ReviewPage.jsx
**Reason**: Review workflows consolidated
**Safe to delete after**: 2026-01-29

### BomReviewPage.jsx
**Reason**: BOM review accessible via listing modals
**Safe to delete after**: 2026-01-29

### AuditPage.jsx
**Reason**: Audit logs accessible via system health in Settings
**Safe to delete after**: 2026-01-29

## How to Restore

If any of these pages are needed:
```bash
mv client/src/pages/_deprecated/PageName.jsx client/src/pages/
```

Then add the route back to App.jsx and Nav.jsx.
