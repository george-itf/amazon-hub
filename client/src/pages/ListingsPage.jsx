import React, { useEffect, useState, useMemo } from 'react';
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
} from '@shopify/polaris';
import { getListings, createListing, getBoms } from '../utils/api.jsx';

/**
 * ListingsPage lists all entries in the listing memory and allows
 * creation of new mappings from ASIN/SKU/title fingerprints to BOMs.
 * These mappings are used to automatically resolve orders.
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

  // Detail modal
  const [selectedListing, setSelectedListing] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [listingData, bomData] = await Promise.all([getListings(), getBoms()]);
      setListings(listingData.listings || []);
      setBoms(bomData.boms || []);
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

  // Filter listings
  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      // Status filter
      if (statusFilter === 'active' && !listing.is_active) return false;
      if (statusFilter === 'inactive' && listing.is_active) return false;

      // BOM filter
      if (bomFilter === 'with_bom' && !listing.bom_id) return false;
      if (bomFilter === 'without_bom' && listing.bom_id) return false;

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
  }, [listings, statusFilter, bomFilter, searchQuery, boms]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setBomFilter('all');
  };

  const hasFilters = searchQuery || statusFilter !== 'all' || bomFilter !== 'all';

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

  const rows = filteredListings.map((l) => [
    <Text variant="bodyMd" fontWeight="semibold" key={`asin-${l.id}`}>
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
    l.is_active ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge tone="default">Inactive</Badge>
    ),
  ]);

  const bomOptions = [
    { label: '— Select BOM —', value: '' },
    ...boms.map((b) => ({ label: `${b.bundle_sku} - ${b.description || 'No description'}`, value: b.id })),
  ];

  // Count stats
  const activeCount = listings.filter((l) => l.is_active).length;
  const withBomCount = listings.filter((l) => l.bom_id).length;

  return (
    <Page
      title="Listings Memory"
      subtitle={`${listings.length} rules · ${activeCount} active · ${withBomCount} with BOM`}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Create Listing Rule</Text>

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
                  Create a mapping from an ASIN, SKU, or title to a BOM. When orders come in with
                  matching identifiers, they'll be automatically resolved.
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
                  Create Listing Rule
                </Button>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

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
                    <Text variant="headingMd">No listing rules yet</Text>
                    <Text tone="subdued">
                      Create listing rules to automatically map incoming orders to BOMs. Rules are
                      also created when you resolve items in the Review Queue.
                    </Text>
                  </BlockStack>
                </div>
              ) : filteredListings.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No matching listings</Text>
                    <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                    <Button onClick={handleClearFilters}>Clear filters</Button>
                  </BlockStack>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['ASIN', 'SKU', 'Title Fingerprint', 'BOM', 'Status']}
                  rows={rows}
                  hoverable
                  onRowClick={(row, index) => setSelectedListing(filteredListings[index])}
                  footerContent={`${filteredListings.length} of ${listings.length} rule(s)`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Listing Detail Modal */}
      {selectedListing && (
        <Modal
          open={!!selectedListing}
          onClose={() => setSelectedListing(null)}
          title="Listing Rule Details"
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
                  <Badge>{selectedListing.resolution_source || 'Unknown'}</Badge>
                </BlockStack>
              </InlineStack>

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm">Identifiers</Text>
                <InlineStack gap="400">
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
                {selectedListing.title_fingerprint && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Title Fingerprint</Text>
                    <Text variant="bodyMd">{selectedListing.title_fingerprint}</Text>
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
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">{bom.bundle_sku}</Text>
                        <Text variant="bodySm" tone="subdued">{bom.description || 'No description'}</Text>
                      </BlockStack>
                    ) : (
                      <Text tone="subdued">BOM not found: {selectedListing.bom_id}</Text>
                    );
                  })()
                ) : (
                  <Banner tone="warning">
                    <p>No BOM assigned. Orders matching this listing will go to review.</p>
                  </Banner>
                )}
              </BlockStack>

              <Divider />

              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Created</Text>
                <Text variant="bodyMd">
                  {selectedListing.created_at
                    ? new Date(selectedListing.created_at).toLocaleString('en-GB')
                    : '-'}
                </Text>
                {selectedListing.created_by_actor_display && (
                  <Text variant="bodySm" tone="subdued">
                    by {selectedListing.created_by_actor_display}
                  </Text>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
