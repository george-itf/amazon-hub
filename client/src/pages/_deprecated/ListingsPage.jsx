import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  TextField,
  Select,
  Button,
  FormLayout,
  Banner,
  Text,
  BlockStack,
  Badge,
  InlineStack,
  Modal,
  Divider,
  ProgressBar,
  Tabs,
} from '@shopify/polaris';
import { SettingsIcon } from '@shopify/polaris-icons';
import { getListings, createListing, getBoms, getListingInventory, getSharedComponents, getListingSettings } from '../utils/api.jsx';
import SavedViewsBar from '../components/SavedViewsBar.jsx';
import ListingSettingsModal from '../components/ListingSettingsModal.jsx';

/**
 * MappingRulesPage (formerly ListingsPage) lists all entries in the listing memory
 * and allows creation of new mappings from ASIN/SKU/title fingerprints to BOMs.
 * These mappings are used to automatically resolve orders.
 *
 * Note: This page shows ASIN/SKU-to-BOM mapping rules, NOT Amazon product listings.
 * The name "Mapping Rules" was chosen to reduce confusion with Amazon's actual listings.
 */
export default function ListingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [listings, setListings] = useState([]);
  const [boms, setBoms] = useState([]);
  const [form, setForm] = useState({ asin: '', sku: '', title: '', bom_id: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [bomFilter, setBomFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created');

  // Detail modal
  const [selectedListing, setSelectedListing] = useState(null);

  // Tabs
  const [selectedTab, setSelectedTab] = useState(0);

  // Inventory state
  const [inventoryData, setInventoryData] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [sharedComponents, setSharedComponents] = useState(null);
  const [inventoryFilter, setInventoryFilter] = useState('all');
  const [selectedInventoryListing, setSelectedInventoryListing] = useState(null);

  // Listing settings state
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsListing, setSettingsListing] = useState(null);
  const [listingSettingsMap, setListingSettingsMap] = useState({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [listingData, bomData] = await Promise.all([getListings(), getBoms()]);
      setListings(listingData.listings || []);
      setBoms(bomData.boms || []);

      // Load settings for all listings
      if (listingData.listings?.length > 0) {
        try {
          const settingsData = await getListingSettings(listingData.listings.map(l => l.id));
          const settingsMap = {};
          for (const s of settingsData.settings || []) {
            settingsMap[s.listing_memory_id] = s;
          }
          setListingSettingsMap(settingsMap);
        } catch (settingsErr) {
          console.warn('Failed to load listing settings:', settingsErr);
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

  // Load inventory data when tab switches to inventory
  async function loadInventory() {
    setInventoryLoading(true);
    try {
      const [invData, sharedData] = await Promise.all([
        getListingInventory(),
        getSharedComponents()
      ]);
      setInventoryData(invData);
      setSharedComponents(sharedData);
    } catch (err) {
      console.error('Failed to load inventory:', err);
      setError(err.message || 'Failed to load inventory data');
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => {
    if (selectedTab === 2 && !inventoryData && !inventoryLoading) {
      loadInventory();
    }
  }, [selectedTab, inventoryData, inventoryLoading]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = listings.length;
    const active = listings.filter((l) => l.is_active).length;
    const withBom = listings.filter((l) => l.bom_id).length;
    const withoutBom = listings.filter((l) => !l.bom_id).length;

    const bySource = {};
    listings.forEach((l) => {
      const source = l.resolution_source || 'Unknown';
      bySource[source] = (bySource[source] || 0) + 1;
    });

    const byBom = {};
    listings.forEach((l) => {
      if (l.bom_id) {
        const bom = boms.find((b) => b.id === l.bom_id);
        const bomName = bom?.bundle_sku || 'Unknown';
        byBom[bomName] = (byBom[bomName] || 0) + 1;
      }
    });

    return { total, active, withBom, withoutBom, bySource, byBom };
  }, [listings, boms]);

  // Filter listings
  const filteredListings = useMemo(() => {
    let result = listings.filter((listing) => {
      // Status filter
      if (statusFilter === 'active' && !listing.is_active) return false;
      if (statusFilter === 'inactive' && listing.is_active) return false;

      // BOM filter
      if (bomFilter === 'with_bom' && !listing.bom_id) return false;
      if (bomFilter === 'without_bom' && listing.bom_id) return false;

      // Source filter
      if (sourceFilter !== 'all' && listing.resolution_source !== sourceFilter) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesAsin = listing.asin?.toLowerCase().includes(query);
        const matchesSku = listing.sku?.toLowerCase().includes(query);
        const matchesTitle = listing.title_fingerprint?.toLowerCase().includes(query);
        const bom = boms.find((b) => b.id === listing.bom_id);
        const matchesBom = bom?.bundle_sku?.toLowerCase().includes(query);
        if (!matchesAsin && !matchesSku && !matchesTitle && !matchesBom) return false;
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'created') {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      if (sortBy === 'asin') {
        return (a.asin || '').localeCompare(b.asin || '');
      }
      if (sortBy === 'sku') {
        return (a.sku || '').localeCompare(b.sku || '');
      }
      return 0;
    });

    return result;
  }, [listings, statusFilter, bomFilter, sourceFilter, searchQuery, boms, sortBy]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setBomFilter('all');
    setSourceFilter('all');
    setSortBy('created');
  };

  // Handler for SavedViewsBar - applies view config to filter state
  const handleApplyView = useCallback((config) => {
    setSearchQuery(config.searchQuery || '');
    setStatusFilter(config.statusFilter || 'all');
    setBomFilter(config.bomFilter || 'all');
    setSourceFilter(config.sourceFilter || 'all');
    setSortBy(config.sortBy || 'created');
  }, []);

  // Current filters for SavedViewsBar
  const currentFilters = useMemo(() => ({
    searchQuery,
    statusFilter,
    bomFilter,
    sourceFilter,
    sortBy,
  }), [searchQuery, statusFilter, bomFilter, sourceFilter, sortBy]);

  const hasFilters = searchQuery || statusFilter !== 'all' || bomFilter !== 'all' || sourceFilter !== 'all' || sortBy !== 'created';

  function handleChange(field) {
    return (value) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      // Validate at least one identifier is provided
      if (!form.asin && !form.sku && !form.title) {
        setCreateError('Please provide at least one identifier (ASIN, SKU, or Title)');
        setCreating(false);
        return;
      }

      const payload = {
        asin: form.asin || null,
        sku: form.sku || null,
        title: form.title || null,
        bom_id: form.bom_id || null,
      };
      await createListing(payload);
      setSuccessMessage(`Listing rule created for ${form.asin || form.sku || 'title'}`);
      setForm({ asin: '', sku: '', title: '', bom_id: '' });
      await load();
    } catch (err) {
      setCreateError(err.message || 'Failed to create listing');
    } finally {
      setCreating(false);
    }
  }

  // Get BOM display name
  function getBomName(bomId) {
    if (!bomId) return <Badge tone="warning">No BOM</Badge>;
    const bom = boms.find((b) => b.id === bomId);
    if (!bom) return <Badge tone="default">{bomId.substring(0, 8)}...</Badge>;
    return <Badge tone="success">{bom.bundle_sku}</Badge>;
  }

  // Get BOM object
  function getBom(bomId) {
    return boms.find((b) => b.id === bomId);
  }

  // Get source badge
  function getSourceBadge(source) {
    const sourceMap = {
      MANUAL: { tone: 'info', label: 'Manual' },
      REVIEW: { tone: 'success', label: 'Review' },
      IMPORT: { tone: 'default', label: 'Import' },
      API: { tone: 'attention', label: 'API' },
    };
    const config = sourceMap[source] || { tone: 'default', label: source || 'Unknown' };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  // Get unique sources for filter
  const uniqueSources = useMemo(() => {
    const sources = new Set(listings.map((l) => l.resolution_source).filter(Boolean));
    return Array.from(sources);
  }, [listings]);

  // Open settings modal for a listing
  const openSettingsModal = (listing) => {
    setSettingsListing(listing);
    setSettingsModalOpen(true);
  };

  // Handle settings saved
  const handleSettingsSaved = (data) => {
    setListingSettingsMap(prev => ({
      ...prev,
      [data.listing_memory_id]: data,
    }));
  };

  // Check if listing has any settings configured
  const hasSettings = (listingId) => {
    const s = listingSettingsMap[listingId];
    if (!s) return false;
    return (
      s.price_override_pence != null ||
      s.quantity_cap != null ||
      s.quantity_override != null ||
      s.min_margin_override != null ||
      s.target_margin_override != null ||
      (s.tags && s.tags.length > 0) ||
      s.group_key != null
    );
  };

  const rows = filteredListings.map((l) => [
    <Text
      variant="bodyMd"
      fontWeight="semibold"
      key={`asin-${l.id}`}
      as="button"
      onClick={() => setSelectedListing(l)}
      style={{ cursor: 'pointer', textDecoration: 'underline' }}
    >
      {l.asin || '-'}
    </Text>,
    l.sku || '-',
    <Text variant="bodySm" key={`fp-${l.id}`}>
      {l.title_fingerprint
        ? l.title_fingerprint.length > 30
          ? l.title_fingerprint.substring(0, 30) + '...'
          : l.title_fingerprint
        : '-'}
    </Text>,
    getBomName(l.bom_id),
    getSourceBadge(l.resolution_source),
    l.is_active ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge tone="default">Inactive</Badge>
    ),
    <Button
      key={`settings-${l.id}`}
      icon={SettingsIcon}
      variant={hasSettings(l.id) ? 'primary' : 'tertiary'}
      size="slim"
      onClick={() => openSettingsModal(l)}
      accessibilityLabel={`Settings for ${l.asin || l.sku}`}
    />,
  ]);

  const bomOptions = [
    { label: '— Select BOM —', value: '' },
    ...boms.map((b) => ({ label: `${b.bundle_sku} - ${b.description || 'No description'}`, value: b.id })),
  ];

  const tabs = [
    { id: 'listings', content: `Rules (${filteredListings.length})`, accessibilityLabel: 'Mapping Rules' },
    { id: 'stats', content: 'Statistics', accessibilityLabel: 'Statistics' },
    { id: 'inventory', content: 'Inventory', accessibilityLabel: 'Inventory Availability' },
  ];

  const statsContent = (
    <BlockStack gap="400">
      {/* Overview Cards */}
      <Layout>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Total Rules</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.total}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Active</Text>
              <Text variant="headingLg" fontWeight="bold" tone="success">{stats.active}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">With BOM</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.withBom}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Missing BOM</Text>
              <Text variant="headingLg" fontWeight="bold" tone={stats.withoutBom > 0 ? 'warning' : undefined}>
                {stats.withoutBom}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Coverage */}
      {stats.total > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd">BOM Coverage</Text>
            <ProgressBar
              progress={Math.round((stats.withBom / stats.total) * 100)}
              tone={stats.withoutBom > 0 ? 'warning' : 'success'}
            />
            <Text variant="bodySm" tone="subdued">
              {Math.round((stats.withBom / stats.total) * 100)}% of listings have BOMs assigned
            </Text>
          </BlockStack>
        </Card>
      )}

      {/* By Source */}
      {Object.keys(stats.bySource).length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd">By Source</Text>
            <InlineStack gap="400" wrap>
              {Object.entries(stats.bySource)
                .sort((a, b) => b[1] - a[1])
                .map(([source, count]) => (
                  <Card key={source}>
                    <BlockStack gap="100">
                      {getSourceBadge(source)}
                      <Text variant="headingMd">{count}</Text>
                    </BlockStack>
                  </Card>
                ))}
            </InlineStack>
          </BlockStack>
        </Card>
      )}

      {/* Top BOMs */}
      {Object.keys(stats.byBom).length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd">Top BOMs by Listings</Text>
            <DataTable
              columnContentTypes={['text', 'numeric']}
              headings={['BOM', 'Listings']}
              rows={Object.entries(stats.byBom)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([bom, count]) => [
                  <Text variant="bodyMd" fontWeight="semibold" key={bom}>{bom}</Text>,
                  count,
                ])}
            />
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );

  return (
    <Page
      title="Mapping Rules"
      subtitle={`${stats.total} rules · ${stats.active} active · ${stats.withBom} with BOM`}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Quick Stats */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Quick Stats</Text>
                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Active</Text>
                    <Text variant="headingMd" tone="success">{stats.active}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">With BOM</Text>
                    <Text variant="headingMd">{stats.withBom}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">No BOM</Text>
                    <Text variant="headingMd" tone={stats.withoutBom > 0 ? 'warning' : undefined}>
                      {stats.withoutBom}
                    </Text>
                  </BlockStack>
                </InlineStack>
                {stats.total > 0 && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Coverage</Text>
                    <ProgressBar
                      progress={Math.round((stats.withBom / stats.total) * 100)}
                      size="small"
                      tone={stats.withoutBom > 0 ? 'warning' : 'success'}
                    />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Create Form */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Create Mapping Rule</Text>

                {createError && (
                  <Banner tone="critical" onDismiss={() => setCreateError(null)}>
                    <p>{createError}</p>
                  </Banner>
                )}

                {successMessage && (
                  <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
                    <p>{successMessage}</p>
                  </Banner>
                )}

                <Banner tone="info">
                  <p>
                    Create a mapping rule from an ASIN, SKU, or title to a BOM. When orders come in with
                    matching identifiers, they'll be automatically resolved to the correct product.
                  </p>
                </Banner>

                <FormLayout>
                  <TextField
                    label="ASIN"
                    value={form.asin}
                    onChange={handleChange('asin')}
                    placeholder="e.g., B08N5WRWNW"
                    helpText="Amazon Standard Identification Number"
                    autoComplete="off"
                  />
                  <TextField
                    label="SKU"
                    value={form.sku}
                    onChange={handleChange('sku')}
                    placeholder="e.g., INV-TOOL-001"
                    helpText="Stock Keeping Unit"
                    autoComplete="off"
                  />
                  <TextField
                    label="Title"
                    value={form.title}
                    onChange={handleChange('title')}
                    placeholder="Product title for fingerprinting"
                    helpText="Used to create a fingerprint for fuzzy matching"
                    multiline={2}
                  />
                  <Select
                    label="BOM"
                    options={bomOptions}
                    value={form.bom_id}
                    onChange={handleChange('bom_id')}
                    helpText="The product/bundle this listing maps to"
                  />
                  <Button
                    variant="primary"
                    onClick={handleCreate}
                    loading={creating}
                    disabled={!form.bom_id}
                  >
                    Create Mapping Rule
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              {selectedTab === 0 ? (
                <BlockStack gap="400">
                  {/* Saved Views Bar */}
                  <Card>
                    <SavedViewsBar
                      context="listings"
                      currentFilters={currentFilters}
                      onApplyView={handleApplyView}
                    />
                  </Card>

                  {/* Search and Filter */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="400" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Search"
                            labelHidden
                            placeholder="Search by ASIN, SKU, title, BOM..."
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
                          label="BOM"
                          labelHidden
                          options={[
                            { label: 'All', value: 'all' },
                            { label: 'With BOM', value: 'with_bom' },
                            { label: 'Without BOM', value: 'without_bom' },
                          ]}
                          value={bomFilter}
                          onChange={setBomFilter}
                        />
                        <Select
                          label="Source"
                          labelHidden
                          options={[
                            { label: 'All sources', value: 'all' },
                            ...uniqueSources.map((s) => ({ label: s, value: s })),
                          ]}
                          value={sourceFilter}
                          onChange={setSourceFilter}
                        />
                        <Select
                          label="Sort"
                          labelHidden
                          options={[
                            { label: 'Newest first', value: 'created' },
                            { label: 'ASIN A-Z', value: 'asin' },
                            { label: 'SKU A-Z', value: 'sku' },
                          ]}
                          value={sortBy}
                          onChange={setSortBy}
                        />
                        {hasFilters && (
                          <Button onClick={handleClearFilters}>Clear</Button>
                        )}
                      </InlineStack>
                      {hasFilters && (
                        <Text variant="bodySm" tone="subdued">
                          Showing {filteredListings.length} of {listings.length} rules
                        </Text>
                      )}
                    </BlockStack>
                  </Card>

                  <Card>
                    {loading ? (
                      <div style={{ padding: '40px', textAlign: 'center' }}>
                        <Spinner accessibilityLabel="Loading listings" size="large" />
                      </div>
                    ) : listings.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center' }}>
                        <BlockStack gap="200" inlineAlign="center">
                          <Text variant="headingMd">No mapping rules yet</Text>
                          <Text tone="subdued">
                            Create mapping rules to automatically map incoming orders to BOMs. Rules are
                            also created when you resolve items in the Review Queue.
                          </Text>
                        </BlockStack>
                      </div>
                    ) : filteredListings.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center' }}>
                        <BlockStack gap="200" inlineAlign="center">
                          <Text variant="headingMd">No matching rules</Text>
                          <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                          <Button onClick={handleClearFilters}>Clear filters</Button>
                        </BlockStack>
                      </div>
                    ) : (
                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text']}
                        headings={['ASIN', 'SKU', 'Title Fingerprint', 'BOM', 'Source', 'Status', 'Settings']}
                        rows={rows}
                        footerContent={`${filteredListings.length} of ${listings.length} rule(s)`}
                      />
                    )}
                  </Card>
                </BlockStack>
              ) : selectedTab === 1 ? (
                statsContent
              ) : (
                <InventoryContent
                  inventoryData={inventoryData}
                  inventoryLoading={inventoryLoading}
                  sharedComponents={sharedComponents}
                  inventoryFilter={inventoryFilter}
                  setInventoryFilter={setInventoryFilter}
                  onRefresh={loadInventory}
                  onSelectListing={setSelectedInventoryListing}
                />
              )}
            </Tabs>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Inventory Listing Detail Modal */}
      {selectedInventoryListing && (
        <Modal
          open={!!selectedInventoryListing}
          onClose={() => setSelectedInventoryListing(null)}
          title="Listing Inventory Details"
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">ASIN</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {selectedInventoryListing.asin || '-'}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">SKU</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {selectedInventoryListing.sku || '-'}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">BOM</Text>
                  <Badge tone="info">{selectedInventoryListing.bundle_sku}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Max Sellable</Text>
                  <Text
                    variant="headingMd"
                    fontWeight="bold"
                    tone={selectedInventoryListing.max_sellable === 0 ? 'critical' : selectedInventoryListing.max_sellable <= 3 ? 'caution' : undefined}
                  >
                    {selectedInventoryListing.max_sellable}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm">Component Availability</Text>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'numeric', 'text']}
                  headings={['Component', 'Required', 'On Hand', 'Reserved', 'Available', 'Status']}
                  rows={(selectedInventoryListing.components || []).map((c) => [
                    <BlockStack gap="100" key={c.component_id}>
                      <Text variant="bodyMd" fontWeight="semibold">{c.internal_sku}</Text>
                      <Text variant="bodySm" tone="subdued">{c.description || ''}</Text>
                    </BlockStack>,
                    c.qty_required,
                    c.on_hand,
                    c.reserved,
                    c.available,
                    c.is_constraint ? (
                      <Badge tone="critical">Constraint</Badge>
                    ) : (
                      <Badge tone="success">OK</Badge>
                    ),
                  ])}
                />
              </BlockStack>

              {selectedInventoryListing.constraint_internal_sku && (
                <Banner tone="warning">
                  <p>
                    <strong>{selectedInventoryListing.constraint_internal_sku}</strong> is the constraining component
                    limiting sales of this listing to {selectedInventoryListing.max_sellable} units.
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Mapping Rule Detail Modal */}
      {selectedListing && (
        <Modal
          open={!!selectedListing}
          onClose={() => setSelectedListing(null)}
          title="Mapping Rule Details"
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Status</Text>
                  {selectedListing.is_active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="default">Inactive</Badge>
                  )}
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Source</Text>
                  {getSourceBadge(selectedListing.resolution_source)}
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Created</Text>
                  <Text variant="bodyMd">
                    {selectedListing.created_at
                      ? new Date(selectedListing.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '-'}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm">Identifiers</Text>
                <Card>
                  <InlineStack gap="800">
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">ASIN</Text>
                      <Text variant="bodyMd" fontWeight="semibold">
                        {selectedListing.asin || '-'}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">SKU</Text>
                      <Text variant="bodyMd" fontWeight="semibold">
                        {selectedListing.sku || '-'}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Card>
                {selectedListing.title_fingerprint && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Title Fingerprint</Text>
                    <Card>
                      <Text variant="bodyMd">{selectedListing.title_fingerprint}</Text>
                    </Card>
                  </BlockStack>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm">Mapped BOM</Text>
                {selectedListing.bom_id ? (
                  (() => {
                    const bom = getBom(selectedListing.bom_id);
                    return bom ? (
                      <Card>
                        <BlockStack gap="200">
                          <InlineStack gap="400">
                            <BlockStack gap="100">
                              <Text variant="bodySm" tone="subdued">Bundle SKU</Text>
                              <Text variant="bodyMd" fontWeight="semibold">{bom.bundle_sku}</Text>
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text variant="bodySm" tone="subdued">Status</Text>
                              {bom.is_active ? (
                                <Badge tone="success">Active</Badge>
                              ) : (
                                <Badge tone="default">Inactive</Badge>
                              )}
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text variant="bodySm" tone="subdued">Components</Text>
                              <Text variant="bodyMd">{bom.bom_components?.length || 0}</Text>
                            </BlockStack>
                          </InlineStack>
                          {bom.description && (
                            <BlockStack gap="100">
                              <Text variant="bodySm" tone="subdued">Description</Text>
                              <Text variant="bodyMd">{bom.description}</Text>
                            </BlockStack>
                          )}
                        </BlockStack>
                      </Card>
                    ) : (
                      <Banner tone="warning">
                        <p>BOM not found: {selectedListing.bom_id}</p>
                      </Banner>
                    );
                  })()
                ) : (
                  <Banner tone="warning">
                    <p>No BOM assigned. Orders matching this listing will go to review.</p>
                  </Banner>
                )}
              </BlockStack>

              {selectedListing.created_by_actor_display && (
                <>
                  <Divider />
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Created By</Text>
                    <Text variant="bodyMd">{selectedListing.created_by_actor_display}</Text>
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Listing Settings Modal */}
      <ListingSettingsModal
        open={settingsModalOpen}
        listing={settingsListing}
        onClose={() => {
          setSettingsModalOpen(false);
          setSettingsListing(null);
        }}
        onSave={handleSettingsSaved}
      />
    </Page>
  );
}

/**
 * InventoryContent - Sub-component displaying inventory availability data
 */
function InventoryContent({
  inventoryData,
  inventoryLoading,
  sharedComponents,
  inventoryFilter,
  setInventoryFilter,
  onRefresh,
  onSelectListing,
}) {
  // Get stock status badge
  function getStockStatusBadge(status) {
    const statusMap = {
      OUT_OF_STOCK: { tone: 'critical', label: 'Out of Stock' },
      LOW_STOCK: { tone: 'warning', label: 'Low Stock' },
      MODERATE_STOCK: { tone: 'attention', label: 'Moderate' },
      IN_STOCK: { tone: 'success', label: 'In Stock' },
    };
    const config = statusMap[status] || { tone: 'default', label: status };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  // Get risk level badge
  function getRiskBadge(level) {
    const riskMap = {
      CRITICAL: { tone: 'critical', label: 'Critical' },
      HIGH: { tone: 'warning', label: 'High Risk' },
      MEDIUM: { tone: 'attention', label: 'Medium' },
      LOW: { tone: 'success', label: 'Low' },
    };
    const config = riskMap[level] || { tone: 'default', label: level };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  // Filter listings
  const filteredInventory = useMemo(() => {
    if (!inventoryData?.listings) return [];
    if (inventoryFilter === 'all') return inventoryData.listings;
    return inventoryData.listings.filter((l) => l.stock_status === inventoryFilter);
  }, [inventoryData, inventoryFilter]);

  if (inventoryLoading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center' }}>
        <Spinner accessibilityLabel="Loading inventory" size="large" />
        <Text variant="bodySm" tone="subdued">Loading inventory availability...</Text>
      </div>
    );
  }

  if (!inventoryData) {
    return (
      <Card>
        <BlockStack gap="200" inlineAlign="center">
          <Text variant="headingMd">No inventory data</Text>
          <Text tone="subdued">Click refresh to load inventory availability data.</Text>
          <Button onClick={onRefresh}>Load Inventory</Button>
        </BlockStack>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      {/* Summary Cards */}
      <Layout>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Total Listings</Text>
              <Text variant="headingLg" fontWeight="bold">{inventoryData.total || 0}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Out of Stock</Text>
              <Text
                variant="headingLg"
                fontWeight="bold"
                tone={inventoryData.out_of_stock_count > 0 ? 'critical' : undefined}
              >
                {inventoryData.out_of_stock_count || 0}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Low Stock</Text>
              <Text
                variant="headingLg"
                fontWeight="bold"
                tone={inventoryData.low_stock_count > 0 ? 'caution' : undefined}
              >
                {inventoryData.low_stock_count || 0}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneQuarter">
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Location</Text>
              <Text variant="headingLg" fontWeight="bold">{inventoryData.location || 'Warehouse'}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Shared Components Warning */}
      {sharedComponents?.shared_components?.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text variant="headingMd">Shared Components ({sharedComponents.total})</Text>
              {(sharedComponents.critical_count > 0 || sharedComponents.high_risk_count > 0) && (
                <Badge tone="warning">
                  {sharedComponents.critical_count + sharedComponents.high_risk_count} at risk
                </Badge>
              )}
            </InlineStack>
            <Banner tone="info">
              <p>
                These components are used in multiple BOMs. Low stock can affect multiple listings simultaneously.
              </p>
            </Banner>
            <DataTable
              columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'text']}
              headings={['Component', 'BOMs', 'Listings', 'Available', 'Risk']}
              rows={sharedComponents.shared_components.slice(0, 10).map((c) => [
                <BlockStack gap="100" key={c.component_id}>
                  <Text variant="bodyMd" fontWeight="semibold">{c.internal_sku}</Text>
                  <Text variant="bodySm" tone="subdued">{c.description || ''}</Text>
                </BlockStack>,
                c.bom_count,
                c.listing_count,
                c.available,
                getRiskBadge(c.risk_level),
              ])}
            />
            {sharedComponents.shared_components.length > 10 && (
              <Text variant="bodySm" tone="subdued">
                Showing 10 of {sharedComponents.shared_components.length} shared components
              </Text>
            )}
          </BlockStack>
        </Card>
      )}

      {/* Filter and Listing Table */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <InlineStack gap="400">
              <Select
                label="Filter by stock status"
                labelHidden
                options={[
                  { label: 'All listings', value: 'all' },
                  { label: 'Out of Stock', value: 'OUT_OF_STOCK' },
                  { label: 'Low Stock', value: 'LOW_STOCK' },
                  { label: 'Moderate Stock', value: 'MODERATE_STOCK' },
                  { label: 'In Stock', value: 'IN_STOCK' },
                ]}
                value={inventoryFilter}
                onChange={setInventoryFilter}
              />
              <Text variant="bodySm" tone="subdued">
                {filteredInventory.length} listing{filteredInventory.length !== 1 ? 's' : ''}
              </Text>
            </InlineStack>
            <Button onClick={onRefresh}>Refresh</Button>
          </InlineStack>

          {filteredInventory.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Text tone="subdued">No listings match the selected filter.</Text>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'numeric', 'text', 'text']}
              headings={['ASIN', 'SKU', 'BOM', 'Max Sellable', 'Constraint', 'Status']}
              rows={filteredInventory.map((l) => [
                <Text
                  variant="bodyMd"
                  fontWeight="semibold"
                  key={`asin-${l.listing_id}`}
                  as="button"
                  onClick={() => onSelectListing(l)}
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {l.asin || '-'}
                </Text>,
                l.sku || '-',
                <Badge tone="info" key={`bom-${l.listing_id}`}>{l.bundle_sku}</Badge>,
                <Text
                  variant="bodyMd"
                  fontWeight="bold"
                  key={`qty-${l.listing_id}`}
                  tone={l.max_sellable === 0 ? 'critical' : l.max_sellable <= 3 ? 'caution' : undefined}
                >
                  {l.max_sellable}
                </Text>,
                l.constraint_internal_sku ? (
                  <Text variant="bodySm" tone="subdued" key={`constraint-${l.listing_id}`}>
                    {l.constraint_internal_sku}
                  </Text>
                ) : (
                  '-'
                ),
                getStockStatusBadge(l.stock_status),
              ])}
              footerContent={`${filteredInventory.length} listing(s)`}
            />
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
