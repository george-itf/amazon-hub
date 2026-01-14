import React, { useEffect, useState } from 'react';
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

  const rows = listings.map((l) => [
    <Text variant="bodyMd" fontWeight="semibold" key={`asin-${l.id}`}>
      {l.asin || '-'}
    </Text>,
    l.sku || '-',
    <Text variant="bodySm" key={`fp-${l.id}`}>
      {l.title_fingerprint
        ? l.title_fingerprint.length > 40
          ? l.title_fingerprint.substring(0, 40) + '...'
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

  return (
    <Page
      title="Listings Memory"
      subtitle="ASIN/SKU to BOM mappings for automatic order resolution"
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
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['ASIN', 'SKU', 'Title Fingerprint', 'BOM', 'Status']}
                  rows={rows}
                  footerContent={`${listings.length} listing rule(s)`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
