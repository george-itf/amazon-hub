import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  TextField,
  Button,
  FormLayout,
  Spinner,
  Banner,
  Text,
  BlockStack,
  Badge,
  Modal,
  Select,
  InlineStack,
  Divider,
  Tabs,
  ProgressBar,
  Checkbox,
  Tag,
  Thumbnail,
  Icon,
  Box,
  Tooltip,
} from '@shopify/polaris';
import { PlusIcon, RefreshIcon, SettingsIcon, ImageIcon, EditIcon, ExternalIcon } from '@shopify/polaris-icons';
import {
  getListings,
  getBoms,
  createListing,
  updateListing,
  getListingSettings,
  updateListingSettings,
  getShippingOptions,
} from '../utils/api.jsx';
import { useUserPreferences } from '../hooks/useUserPreferences.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Generate Amazon product image URL from ASIN
 */
function getAmazonImageUrl(asin, size = 'small') {
  if (!asin) return null;
  // Amazon's standard image URL pattern
  const sizeMap = {
    small: 'SL75',    // 75px
    medium: 'SL160',  // 160px
    large: 'SL320',   // 320px
  };
  const sizeCode = sizeMap[size] || 'SL75';
  return `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._${sizeCode}_.jpg`;
}

/**
 * Truncate text with ellipsis
 */
function truncate(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * AmazonListingsPage - Manage all Amazon listings
 *
 * Features:
 * - View all Amazon listings with images and titles
 * - Click any listing to view/edit details
 * - Assign BOMs to listings directly
 * - Set sell-out price overrides
 * - Override quantities
 * - Assign shipping rules
 * - Filter by brand, product type, status with custom tabs
 */
export default function AmazonListingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [listings, setListings] = useState([]);
  const [boms, setBoms] = useState([]);
  const [listingSettingsMap, setListingSettingsMap] = useState({});
  const [shippingOptions, setShippingOptions] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [bomFilter, setBomFilter] = useState('all');
  const [sortBy, setSortBy] = useState('title');

  // User preferences for cross-device sync
  const { getPreference, setPreference, loading: prefsLoading } = useUserPreferences();

  // Custom tabs state - synced via user preferences
  const [customTabs, setCustomTabs] = useState(() => {
    try {
      const saved = localStorage.getItem('listings_custom_tabs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // Sync custom tabs from user preferences when loaded
  useEffect(() => {
    if (!prefsLoading) {
      const savedTabs = getPreference('listings_custom_tabs', []);
      if (Array.isArray(savedTabs)) {
        setCustomTabs(savedTabs);
      }
    }
  }, [prefsLoading, getPreference]);

  // Tab management modal
  const [tabModalOpen, setTabModalOpen] = useState(false);
  const [tabForm, setTabForm] = useState({ name: '', filterType: 'brand', filterValue: '' });

  // Listing detail modal (main new feature)
  const [detailModal, setDetailModal] = useState({ open: false, listing: null });
  const [detailForm, setDetailForm] = useState({
    bom_id: '',
    price_override_pence: '',
    quantity_override: '',
    quantity_cap: '',
    min_margin_override: '',
    target_margin_override: '',
    shipping_rule: '',
    tags: [],
  });
  const [savingDetail, setSavingDetail] = useState(false);

  // Create mapping rule modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ asin: '', sku: '', title: '', bom_id: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Bulk selection
  const [selectedListings, setSelectedListings] = useState(new Set());

  // Save custom tabs to user preferences
  useEffect(() => {
    if (!prefsLoading) {
      setPreference('listings_custom_tabs', customTabs);
    }
  }, [customTabs, setPreference, prefsLoading]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [listingData, bomData, shippingData] = await Promise.all([
        getListings(),
        getBoms(),
        getShippingOptions().catch(() => ({ options: [] })),
      ]);
      setListings(listingData.listings || []);
      setBoms(bomData.boms || []);
      setShippingOptions(shippingData.options || []);

      // Load settings for all listings
      if (listingData.listings?.length > 0) {
        try {
          const settingsData = await getListingSettings(listingData.listings.map(l => l.id));
          const settingsMap = {};
          for (const s of settingsData.settings || []) {
            settingsMap[s.listing_memory_id] = s;
          }
          setListingSettingsMap(settingsMap);
        } catch (err) {
          console.warn('Failed to load listing settings:', err);
        }
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Get unique values for tab creation
  const uniqueBrands = useMemo(() => {
    const brands = new Set();
    listings.forEach(l => {
      const bom = boms.find(b => b.id === l.bom_id);
      if (bom?.brand) brands.add(bom.brand);
    });
    return Array.from(brands).sort();
  }, [listings, boms]);

  const uniqueTags = useMemo(() => {
    const tags = new Set();
    Object.values(listingSettingsMap).forEach(s => {
      if (s.tags) s.tags.forEach(t => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [listingSettingsMap]);

  // Build tabs array
  const tabs = useMemo(() => {
    const allCount = listings.length;
    const withBomCount = listings.filter(l => l.bom_id).length;
    const noBomCount = listings.filter(l => !l.bom_id).length;
    const activeCount = listings.filter(l => l.is_active).length;

    const baseTabs = [
      { id: 'all', content: `All (${allCount})` },
      { id: 'with-bom', content: `With BOM (${withBomCount})`, filter: l => l.bom_id },
      { id: 'no-bom', content: `Needs BOM (${noBomCount})`, filter: l => !l.bom_id },
      { id: 'active', content: `Active (${activeCount})`, filter: l => l.is_active },
    ];

    const customTabItems = customTabs.map((tab, index) => {
      const count = listings.filter(l => {
        const bom = boms.find(b => b.id === l.bom_id);
        const settings = listingSettingsMap[l.id];
        if (tab.filterType === 'brand') return bom?.brand === tab.filterValue;
        if (tab.filterType === 'tag') return settings?.tags?.includes(tab.filterValue);
        return false;
      }).length;
      return {
        id: `custom-${index}`,
        content: `${tab.name} (${count})`,
        filterType: tab.filterType,
        filterValue: tab.filterValue,
      };
    });

    return [...baseTabs, ...customTabItems];
  }, [listings, boms, customTabs, listingSettingsMap]);

  // Filter listings based on selected tab + search + filters
  const filteredListings = useMemo(() => {
    let result = listings;

    // Apply tab filter
    const currentTab = tabs[selectedTabIndex];
    if (currentTab?.filter) {
      result = result.filter(currentTab.filter);
    } else if (selectedTabIndex >= 4) {
      // Custom tab (after 4 base tabs)
      const customTab = customTabs[selectedTabIndex - 4];
      if (customTab) {
        result = result.filter(l => {
          const bom = boms.find(b => b.id === l.bom_id);
          const settings = listingSettingsMap[l.id];
          if (customTab.filterType === 'brand') return bom?.brand === customTab.filterValue;
          if (customTab.filterType === 'tag') return settings?.tags?.includes(customTab.filterValue);
          return true;
        });
      }
    }

    // Apply status filter
    if (statusFilter === 'active') {
      result = result.filter(l => l.is_active);
    } else if (statusFilter === 'inactive') {
      result = result.filter(l => !l.is_active);
    }

    // Apply BOM filter
    if (bomFilter === 'with_bom') {
      result = result.filter(l => l.bom_id);
    } else if (bomFilter === 'without_bom') {
      result = result.filter(l => !l.bom_id);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(l => {
        const bom = boms.find(b => b.id === l.bom_id);
        return (
          l.asin?.toLowerCase().includes(query) ||
          l.sku?.toLowerCase().includes(query) ||
          l.title_fingerprint?.toLowerCase().includes(query) ||
          bom?.bundle_sku?.toLowerCase().includes(query)
        );
      });
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'title') return (a.title_fingerprint || a.asin || '').localeCompare(b.title_fingerprint || b.asin || '');
      if (sortBy === 'asin') return (a.asin || '').localeCompare(b.asin || '');
      if (sortBy === 'sku') return (a.sku || '').localeCompare(b.sku || '');
      if (sortBy === 'created') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      return 0;
    });

    return result;
  }, [listings, boms, listingSettingsMap, tabs, selectedTabIndex, customTabs, searchQuery, statusFilter, bomFilter, sortBy]);

  // Stats
  const stats = useMemo(() => {
    const total = listings.length;
    const withBom = listings.filter(l => l.bom_id).length;
    const active = listings.filter(l => l.is_active).length;
    const withOverrides = Object.values(listingSettingsMap).filter(s =>
      s.price_override_pence || s.quantity_override || s.quantity_cap
    ).length;
    return { total, withBom, active, withOverrides };
  }, [listings, listingSettingsMap]);

  // Tab management
  const handleAddTab = () => {
    if (!tabForm.name || !tabForm.filterValue) return;
    setCustomTabs(prev => [...prev, { ...tabForm }]);
    setTabForm({ name: '', filterType: 'brand', filterValue: '' });
    setTabModalOpen(false);
  };

  const handleRemoveTab = (index) => {
    setCustomTabs(prev => prev.filter((_, i) => i !== index));
    if (selectedTabIndex > index + 4) {
      setSelectedTabIndex(selectedTabIndex - 1);
    } else if (selectedTabIndex === index + 4) {
      setSelectedTabIndex(0);
    }
  };

  // Get BOM display
  function getBomDisplay(bomId) {
    if (!bomId) return <Badge tone="warning">No BOM</Badge>;
    const bom = boms.find(b => b.id === bomId);
    if (!bom) return <Badge tone="default">Unknown</Badge>;
    return <Badge tone="success">{bom.bundle_sku}</Badge>;
  }

  // Open listing detail modal
  function openDetailModal(listing) {
    const settings = listingSettingsMap[listing.id] || {};
    setDetailForm({
      bom_id: listing.bom_id || '',
      price_override_pence: settings.price_override_pence ? (settings.price_override_pence / 100).toFixed(2) : '',
      quantity_override: settings.quantity_override?.toString() || '',
      quantity_cap: settings.quantity_cap?.toString() || '',
      min_margin_override: settings.min_margin_override?.toString() || '',
      target_margin_override: settings.target_margin_override?.toString() || '',
      shipping_rule: settings.shipping_rule || '',
      tags: settings.tags || [],
    });
    setDetailModal({ open: true, listing });
  }

  // Save listing detail (BOM + settings)
  async function handleSaveDetail() {
    if (!detailModal.listing) return;
    setSavingDetail(true);
    try {
      const listing = detailModal.listing;

      // Update BOM if changed
      if (detailForm.bom_id !== (listing.bom_id || '')) {
        await updateListing(listing.id, {
          bom_id: detailForm.bom_id || null,
        });
        // Update local state
        setListings(prev => prev.map(l =>
          l.id === listing.id ? { ...l, bom_id: detailForm.bom_id || null } : l
        ));
      }

      // Update settings
      const settingsPayload = {
        listing_memory_id: listing.id,
        price_override_pence: detailForm.price_override_pence
          ? Math.round(parseFloat(detailForm.price_override_pence) * 100)
          : null,
        quantity_override: detailForm.quantity_override
          ? parseInt(detailForm.quantity_override)
          : null,
        quantity_cap: detailForm.quantity_cap
          ? parseInt(detailForm.quantity_cap)
          : null,
        min_margin_override: detailForm.min_margin_override
          ? parseFloat(detailForm.min_margin_override)
          : null,
        target_margin_override: detailForm.target_margin_override
          ? parseFloat(detailForm.target_margin_override)
          : null,
        shipping_rule: detailForm.shipping_rule || null,
        tags: detailForm.tags.length > 0 ? detailForm.tags : null,
      };

      const result = await updateListingSettings(settingsPayload);

      // Update local state
      setListingSettingsMap(prev => ({
        ...prev,
        [listing.id]: result,
      }));

      setSuccessMessage(`Updated ${listing.title_fingerprint || listing.asin || listing.sku}`);
      setDetailModal({ open: false, listing: null });
    } catch (err) {
      setError(err?.message || 'Failed to save listing');
    } finally {
      setSavingDetail(false);
    }
  }

  // Create mapping rule
  async function handleCreateMapping() {
    setCreating(true);
    setCreateError(null);
    try {
      if (!createForm.asin && !createForm.sku && !createForm.title) {
        setCreateError('Please provide at least one identifier (ASIN, SKU, or Title)');
        setCreating(false);
        return;
      }
      await createListing({
        asin: createForm.asin || null,
        sku: createForm.sku || null,
        title: createForm.title || null,
        bom_id: createForm.bom_id || null,
      });
      setSuccessMessage(`Mapping rule created for ${createForm.asin || createForm.sku || 'title'}`);
      setCreateForm({ asin: '', sku: '', title: '', bom_id: '' });
      setCreateModal(false);
      await load();
    } catch (err) {
      setCreateError(err?.message || 'Failed to create mapping');
    } finally {
      setCreating(false);
    }
  }

  // Toggle listing selection
  function toggleSelection(listingId) {
    setSelectedListings(prev => {
      const next = new Set(prev);
      if (next.has(listingId)) {
        next.delete(listingId);
      } else {
        next.add(listingId);
      }
      return next;
    });
  }

  // Check if listing has settings
  function hasSettings(listingId) {
    const s = listingSettingsMap[listingId];
    if (!s) return false;
    return (
      s.price_override_pence != null ||
      s.quantity_cap != null ||
      s.quantity_override != null ||
      s.shipping_rule != null ||
      (s.tags && s.tags.length > 0)
    );
  }

  // Get display title for listing
  function getDisplayTitle(listing) {
    return listing.title_fingerprint || listing.sku || listing.asin || 'Unknown';
  }

  // Table rows - with images and clickable titles
  const rows = useMemo(() => {
    return filteredListings.map(l => {
      const settings = listingSettingsMap[l.id] || {};
      const bom = boms.find(b => b.id === l.bom_id);
      const imageUrl = getAmazonImageUrl(l.asin);

      return [
        // Checkbox
        <Checkbox
          key={`check-${l.id}`}
          label=""
          labelHidden
          checked={selectedListings.has(l.id)}
          onChange={() => toggleSelection(l.id)}
        />,
        // Image
        <div key={`img-${l.id}`} style={{ width: 50, height: 50 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={l.asin || 'Product'}
              style={{
                width: 50,
                height: 50,
                objectFit: 'contain',
                borderRadius: 4,
                border: '1px solid #e1e3e5',
                background: '#fff',
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            style={{
              width: 50,
              height: 50,
              background: '#f6f6f7',
              borderRadius: 4,
              display: imageUrl ? 'none' : 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8c9196',
            }}
          >
            <Icon source={ImageIcon} />
          </div>
        </div>,
        // Title (clickable)
        <div
          key={`title-${l.id}`}
          onClick={() => openDetailModal(l)}
          style={{ cursor: 'pointer' }}
        >
          <BlockStack gap="050">
            <Text variant="bodyMd" fontWeight="semibold" truncate>
              {truncate(getDisplayTitle(l), 60)}
            </Text>
            <InlineStack gap="100">
              <Text variant="bodySm" tone="subdued">{l.asin || '-'}</Text>
              {l.sku && l.sku !== l.asin && (
                <Text variant="bodySm" tone="subdued">• {l.sku}</Text>
              )}
            </InlineStack>
          </BlockStack>
        </div>,
        // BOM
        <div key={`bom-${l.id}`} onClick={() => openDetailModal(l)} style={{ cursor: 'pointer' }}>
          {getBomDisplay(l.bom_id)}
        </div>,
        // Price Override
        <Text variant="bodyMd" key={`price-${l.id}`}>
          {settings.price_override_pence
            ? formatPrice(settings.price_override_pence)
            : <span style={{ color: '#9CA3AF' }}>Auto</span>}
        </Text>,
        // Qty
        <Text variant="bodyMd" key={`qty-${l.id}`}>
          {settings.quantity_override != null
            ? settings.quantity_override
            : settings.quantity_cap != null
              ? `Cap: ${settings.quantity_cap}`
              : <span style={{ color: '#9CA3AF' }}>Auto</span>}
        </Text>,
        // Status
        l.is_active
          ? <Badge tone="success" key={`status-${l.id}`}>Active</Badge>
          : <Badge tone="default" key={`status-${l.id}`}>Inactive</Badge>,
        // Edit button
        <Button
          key={`edit-${l.id}`}
          icon={EditIcon}
          variant={hasSettings(l.id) || l.bom_id ? 'primary' : 'tertiary'}
          size="slim"
          onClick={() => openDetailModal(l)}
          accessibilityLabel="Edit listing"
        />,
      ];
    });
  }, [filteredListings, listingSettingsMap, selectedListings, boms]);

  // BOM recipe options for assignment dropdown
  const bomOptions = [
    { label: '— No Recipe Assigned —', value: '' },
    ...boms.map(b => ({ label: `${b.bundle_sku} - ${truncate(b.description || '', 40)}`, value: b.id })),
  ];

  // Get BOM details for display in modal
  const selectedBom = useMemo(() => {
    if (!detailModal.listing || !detailForm.bom_id) return null;
    return boms.find(b => b.id === detailForm.bom_id);
  }, [detailModal.listing, detailForm.bom_id, boms]);

  return (
    <Page
      title="Amazon Listings"
      subtitle={`${stats.total} listings • ${stats.withBom} with BOM • ${stats.withOverrides} with overrides`}
      primaryAction={{
        content: 'Add Mapping Rule',
        onAction: () => setCreateModal(true),
        icon: PlusIcon,
      }}
      secondaryActions={[
        { content: 'Add Tab', onAction: () => setTabModalOpen(true) },
        { content: 'Refresh', onAction: load, icon: RefreshIcon },
      ]}
    >
      <BlockStack gap="400">
        {/* Success/Error Banners */}
        {successMessage && (
          <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
            <p>{successMessage}</p>
          </Banner>
        )}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Total Listings</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.total}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">With BOM</Text>
              <Text variant="headingLg" fontWeight="bold" tone="success">{stats.withBom}</Text>
              <ProgressBar progress={stats.total ? (stats.withBom / stats.total) * 100 : 0} tone="success" size="small" />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Active</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.active}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">With Overrides</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.withOverrides}</Text>
            </BlockStack>
          </Card>
        </div>

        {/* Custom Tabs */}
        <Card>
          <BlockStack gap="400">
            <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={setSelectedTabIndex} />

            {customTabs.length > 0 && (
              <InlineStack gap="200">
                <Text variant="bodySm" tone="subdued">Custom tabs:</Text>
                {customTabs.map((tab, index) => (
                  <Badge key={index} tone="info">
                    {tab.name}
                    <button
                      onClick={() => handleRemoveTab(index)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        marginLeft: '4px',
                        color: '#666',
                      }}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {/* Search and Filters */}
        <Card>
          <InlineStack gap="400" wrap={false}>
            <div style={{ flex: 1 }}>
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by title, ASIN, SKU, BOM..."
                value={searchQuery}
                onChange={setSearchQuery}
                clearButton
                onClearButtonClick={() => setSearchQuery('')}
                autoComplete="off"
              />
            </div>
            <Select
              label="Status"
              labelHidden
              options={[
                { label: 'All statuses', value: 'all' },
                { label: 'Active only', value: 'active' },
                { label: 'Inactive only', value: 'inactive' },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <Select
              label="Recipe"
              labelHidden
              options={[
                { label: 'All Recipes', value: 'all' },
                { label: 'Recipe Assigned', value: 'with_bom' },
                { label: 'No Recipe', value: 'without_bom' },
              ]}
              value={bomFilter}
              onChange={setBomFilter}
            />
            <Select
              label="Sort"
              labelHidden
              options={[
                { label: 'Sort by Title', value: 'title' },
                { label: 'Sort by ASIN', value: 'asin' },
                { label: 'Sort by SKU', value: 'sku' },
                { label: 'Newest first', value: 'created' },
              ]}
              value={sortBy}
              onChange={setSortBy}
            />
          </InlineStack>
        </Card>

        {/* Bulk Actions */}
        {selectedListings.size > 0 && (
          <Card>
            <InlineStack gap="400" blockAlign="center">
              <Text variant="bodyMd" fontWeight="semibold">
                {selectedListings.size} listing(s) selected
              </Text>
              <Button size="slim" onClick={() => setSelectedListings(new Set())}>
                Clear Selection
              </Button>
            </InlineStack>
          </Card>
        )}

        {/* Data Table */}
        <Card>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Spinner accessibilityLabel="Loading listings" size="large" />
            </div>
          ) : filteredListings.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No listings found</Text>
                <Text tone="subdued">
                  {searchQuery || statusFilter !== 'all' || bomFilter !== 'all'
                    ? 'Try adjusting your search or filters.'
                    : 'Add your first mapping rule to get started.'}
                </Text>
                {(searchQuery || statusFilter !== 'all' || bomFilter !== 'all') && (
                  <Button onClick={() => { setSearchQuery(''); setStatusFilter('all'); setBomFilter('all'); }}>
                    Clear filters
                  </Button>
                )}
              </BlockStack>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'numeric', 'text', 'text']}
              headings={['', 'Image', 'Title / ASIN', 'BOM', 'Price', 'Qty', 'Status', '']}
              rows={rows}
              footerContent={`${filteredListings.length} listing(s)`}
            />
          )}
        </Card>
      </BlockStack>

      {/* Add Tab Modal */}
      <Modal
        open={tabModalOpen}
        onClose={() => setTabModalOpen(false)}
        title="Create Custom Tab"
        primaryAction={{
          content: 'Create Tab',
          onAction: handleAddTab,
          disabled: !tabForm.name || !tabForm.filterValue,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setTabModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <p>Create a tab to quickly filter your listings by brand or tag.</p>
            </Banner>
            <FormLayout>
              <TextField
                label="Tab Name"
                value={tabForm.name}
                onChange={(v) => setTabForm(f => ({ ...f, name: v }))}
                placeholder="e.g., Makita, Power Tools"
                autoComplete="off"
              />
              <Select
                label="Filter By"
                options={[
                  { label: 'Brand', value: 'brand' },
                  { label: 'Tag', value: 'tag' },
                ]}
                value={tabForm.filterType}
                onChange={(v) => setTabForm(f => ({ ...f, filterType: v, filterValue: '' }))}
              />
              <Select
                label="Filter Value"
                options={[
                  { label: '— Select —', value: '' },
                  ...(tabForm.filterType === 'brand'
                    ? uniqueBrands.map(b => ({ label: b, value: b }))
                    : uniqueTags.map(t => ({ label: t, value: t }))
                  ),
                ]}
                value={tabForm.filterValue}
                onChange={(v) => setTabForm(f => ({ ...f, filterValue: v }))}
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Create Mapping Rule Modal */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Add Mapping Rule"
        primaryAction={{
          content: 'Create',
          onAction: handleCreateMapping,
          loading: creating,
          disabled: !createForm.bom_id || (!createForm.asin && !createForm.sku && !createForm.title),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setCreateModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {createError && (
              <Banner tone="critical" onDismiss={() => setCreateError(null)}>
                <p>{createError}</p>
              </Banner>
            )}
            <Banner tone="info">
              <p>Create a mapping rule to link an Amazon ASIN/SKU to a BOM. Orders matching these identifiers will be automatically resolved.</p>
            </Banner>
            <FormLayout>
              <TextField
                label="ASIN"
                value={createForm.asin}
                onChange={(v) => setCreateForm(f => ({ ...f, asin: v }))}
                placeholder="e.g., B08N5WRWNW"
                autoComplete="off"
              />
              <TextField
                label="SKU"
                value={createForm.sku}
                onChange={(v) => setCreateForm(f => ({ ...f, sku: v }))}
                placeholder="e.g., INV-TOOL-001"
                autoComplete="off"
              />
              <TextField
                label="Title"
                value={createForm.title}
                onChange={(v) => setCreateForm(f => ({ ...f, title: v }))}
                placeholder="Product title for fuzzy matching"
                multiline={2}
              />
              <Select
                label="Product Recipe (BOM)"
                options={bomOptions}
                value={createForm.bom_id}
                onChange={(v) => setCreateForm(f => ({ ...f, bom_id: v }))}
                helpText="Assign the recipe that defines what's in this product"
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Listing Detail Modal */}
      {detailModal.open && detailModal.listing && (
        <Modal
          open={detailModal.open}
          onClose={() => setDetailModal({ open: false, listing: null })}
          title="Listing Details"
          primaryAction={{
            content: 'Save Changes',
            onAction: handleSaveDetail,
            loading: savingDetail,
          }}
          secondaryActions={[
            { content: 'Cancel', onAction: () => setDetailModal({ open: false, listing: null }) },
            detailModal.listing.asin && {
              content: 'View on Amazon',
              icon: ExternalIcon,
              url: `https://www.amazon.co.uk/dp/${detailModal.listing.asin}`,
              external: true,
            },
          ].filter(Boolean)}
          large
        >
          <Modal.Section>
            <BlockStack gap="600">
              {/* Product Header with Image */}
              <InlineStack gap="400" blockAlign="start">
                <div style={{
                  width: 120,
                  height: 120,
                  background: '#f6f6f7',
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid #e1e3e5',
                }}>
                  {detailModal.listing.asin ? (
                    <img
                      src={getAmazonImageUrl(detailModal.listing.asin, 'medium')}
                      alt={detailModal.listing.asin}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#8c9196',
                    }}>
                      <Icon source={ImageIcon} />
                    </div>
                  )}
                </div>
                <BlockStack gap="200">
                  <Text variant="headingMd" fontWeight="bold">
                    {detailModal.listing.title_fingerprint || 'Untitled Product'}
                  </Text>
                  <InlineStack gap="200">
                    {detailModal.listing.asin && (
                      <Badge tone="info">ASIN: {detailModal.listing.asin}</Badge>
                    )}
                    {detailModal.listing.sku && (
                      <Badge>SKU: {detailModal.listing.sku}</Badge>
                    )}
                    {detailModal.listing.is_active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="default">Inactive</Badge>
                    )}
                  </InlineStack>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Product Recipe (BOM) Assignment */}
              <BlockStack gap="400">
                <Text variant="headingSm">Product Recipe (BOM)</Text>
                <Select
                  label="Assigned Recipe"
                  options={bomOptions}
                  value={detailForm.bom_id}
                  onChange={(v) => setDetailForm(f => ({ ...f, bom_id: v }))}
                  helpText="Assign the BOM recipe that defines what components are included in this listing"
                />
                {selectedBom && (
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">{selectedBom.bundle_sku}</Text>
                        {selectedBom.review_status === 'APPROVED' && <Badge tone="success">Approved</Badge>}
                        {selectedBom.review_status === 'PENDING_REVIEW' && <Badge tone="warning">Pending</Badge>}
                      </InlineStack>
                      {selectedBom.description && (
                        <Text variant="bodySm" tone="subdued">{selectedBom.description}</Text>
                      )}
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>

              <Divider />

              {/* Price & Quantity Overrides */}
              <BlockStack gap="400">
                <Text variant="headingSm">Price & Quantity</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Sell Price Override (£)"
                      value={detailForm.price_override_pence}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, price_override_pence: v }))}
                      prefix="£"
                      step="0.01"
                      placeholder="Auto"
                      helpText="Override the automatic price calculation"
                    />
                    <TextField
                      label="Quantity Override"
                      value={detailForm.quantity_override}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, quantity_override: v }))}
                      placeholder="Auto"
                      helpText="Override calculated stock quantity"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Quantity Cap"
                    value={detailForm.quantity_cap}
                    type="number"
                    onChange={(v) => setDetailForm(f => ({ ...f, quantity_cap: v }))}
                    placeholder="No limit"
                    helpText="Maximum quantity to show on Amazon"
                  />
                </FormLayout>
              </BlockStack>

              <Divider />

              {/* Margin Settings */}
              <BlockStack gap="400">
                <Text variant="headingSm">Margin Settings</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Minimum Margin (%)"
                      value={detailForm.min_margin_override}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, min_margin_override: v }))}
                      placeholder="10 (default)"
                      suffix="%"
                      helpText="Minimum acceptable margin (default: 10%)"
                    />
                    <TextField
                      label="Target Margin (%)"
                      value={detailForm.target_margin_override}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, target_margin_override: v }))}
                      placeholder="15 (default)"
                      suffix="%"
                      helpText="Target margin for pricing"
                    />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>

              <Divider />

              {/* Shipping Rule */}
              <BlockStack gap="400">
                <Text variant="headingSm">Shipping</Text>
                <Select
                  label="Shipping Rule"
                  options={[
                    { label: 'Default (Standard)', value: '' },
                    { label: 'Small Packet', value: 'small_packet' },
                    { label: 'Medium Parcel', value: 'medium_parcel' },
                    { label: 'Large Parcel', value: 'large_parcel' },
                    { label: 'Heavy Item', value: 'heavy_item' },
                    ...shippingOptions.map(o => ({ label: o.name, value: o.id })),
                  ]}
                  value={detailForm.shipping_rule}
                  onChange={(v) => setDetailForm(f => ({ ...f, shipping_rule: v }))}
                  helpText="Shipping method for this listing"
                />
              </BlockStack>

              <Divider />

              {/* Tags */}
              <BlockStack gap="400">
                <Text variant="headingSm">Tags</Text>
                <TextField
                  label="Tags"
                  value={detailForm.tags.join(', ')}
                  onChange={(v) => setDetailForm(f => ({
                    ...f,
                    tags: v.split(',').map(t => t.trim()).filter(Boolean)
                  }))}
                  placeholder="tag1, tag2, tag3"
                  helpText="Comma-separated tags for organization and filtering"
                />
                {detailForm.tags.length > 0 && (
                  <InlineStack gap="200">
                    {detailForm.tags.map((tag, i) => (
                      <Tag key={i}>{tag}</Tag>
                    ))}
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
