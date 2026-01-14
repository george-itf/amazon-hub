import React, { useEffect, useState, useMemo } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  TextField,
  FormLayout,
  Button,
  Banner,
  Text,
  BlockStack,
  Badge,
  InlineStack,
  Select,
  Modal,
  Divider,
} from '@shopify/polaris';
import { getBoms, createBom, getComponents } from '../utils/api.jsx';

/**
 * BundlesPage lists all bundles/BOMs with their component lines and
 * provides a form to create new ones. BOMs define what components
 * make up a sellable product.
 */
export default function BundlesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [boms, setBoms] = useState([]);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({ bundle_sku: '', description: '', componentQuantities: {} });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [componentSearch, setComponentSearch] = useState('');

  // Detail modal
  const [selectedBom, setSelectedBom] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [bomData, compData] = await Promise.all([getBoms(), getComponents()]);
      setBoms(bomData.boms || []);
      setComponents(compData.components || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load BOMs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Filter BOMs
  const filteredBoms = useMemo(() => {
    return boms.filter((bom) => {
      // Status filter
      if (statusFilter === 'active' && !bom.is_active) return false;
      if (statusFilter === 'inactive' && bom.is_active) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSku = bom.bundle_sku?.toLowerCase().includes(query);
        const matchesDesc = bom.description?.toLowerCase().includes(query);
        const matchesComponent = bom.bom_components?.some((bc) => {
          const comp = bc.components || components.find((c) => c.id === bc.component_id);
          return comp?.internal_sku?.toLowerCase().includes(query);
        });
        if (!matchesSku && !matchesDesc && !matchesComponent) return false;
      }

      return true;
    });
  }, [boms, statusFilter, searchQuery, components]);

  // Filter components for the create form
  const filteredComponents = useMemo(() => {
    if (!componentSearch) return components;
    const query = componentSearch.toLowerCase();
    return components.filter(
      (c) =>
        c.internal_sku?.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
    );
  }, [components, componentSearch]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  const hasFilters = searchQuery || statusFilter !== 'all';

  function handleFormChange(field) {
    return (value) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleQuantityChange(componentId) {
    return (value) =>
      setForm((prev) => ({
        ...prev,
        componentQuantities: { ...prev.componentQuantities, [componentId]: value },
      }));
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const componentsList = Object.entries(form.componentQuantities)
        .filter(([, qty]) => {
          const parsed = parseInt(qty);
          return !isNaN(parsed) && parsed > 0;
        })
        .map(([component_id, qty_required]) => ({
          component_id,
          qty_required: parseInt(qty_required),
        }));

      if (componentsList.length === 0) {
        setCreateError('Please add at least one component with quantity > 0');
        setCreating(false);
        return;
      }

      await createBom({
        bundle_sku: form.bundle_sku,
        description: form.description,
        components: componentsList,
      });
      setSuccessMessage(`BOM "${form.bundle_sku}" created successfully`);
      setForm({ bundle_sku: '', description: '', componentQuantities: {} });
      setComponentSearch('');
      await load();
    } catch (err) {
      setCreateError(err.message || 'Failed to create BOM');
    } finally {
      setCreating(false);
    }
  }

  // Count selected components
  const selectedCount = Object.values(form.componentQuantities).filter(
    (qty) => parseInt(qty) > 0
  ).length;

  // Prepare rows for the BOM table
  const rows = filteredBoms.map((bom) => {
    const compCount = bom.bom_components?.length || 0;
    const compList = bom.bom_components?.slice(0, 3).map((bc) => {
      const comp = bc.components || components.find((c) => c.id === bc.component_id);
      return `${comp?.internal_sku || '?'} ×${bc.qty_required}`;
    }) || [];

    return [
      <Text variant="bodyMd" fontWeight="semibold" key={bom.id}>
        {bom.bundle_sku}
      </Text>,
      bom.description || '-',
      <BlockStack gap="100" key={`comp-${bom.id}`}>
        <InlineStack gap="100" wrap>
          {compList.map((c, i) => (
            <Badge key={i} tone="info">
              {c}
            </Badge>
          ))}
          {compCount > 3 && (
            <Badge tone="default">+{compCount - 3} more</Badge>
          )}
        </InlineStack>
        {compCount === 0 && <Text tone="subdued">No components</Text>}
      </BlockStack>,
      bom.is_active ? (
        <Badge tone="success">Active</Badge>
      ) : (
        <Badge tone="default">Inactive</Badge>
      ),
    ];
  });

  return (
    <Page
      title="BOMs / Bundles"
      subtitle={`${boms.length} bundles defined`}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Create BOM</Text>

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

              <FormLayout>
                <TextField
                  label="Bundle SKU"
                  value={form.bundle_sku}
                  onChange={handleFormChange('bundle_sku')}
                  placeholder="e.g., BUNDLE-STARTER-KIT"
                  helpText="Unique identifier for this bundle"
                  autoComplete="off"
                />
                <TextField
                  label="Description"
                  value={form.description}
                  onChange={handleFormChange('description')}
                  placeholder="e.g., Starter Tool Kit"
                />

                <Divider />

                <InlineStack align="space-between">
                  <Text variant="headingSm">Components ({selectedCount} selected)</Text>
                </InlineStack>

                {components.length === 0 ? (
                  <Banner tone="warning">
                    <p>No components available. Create components first.</p>
                  </Banner>
                ) : (
                  <>
                    <TextField
                      label="Search components"
                      labelHidden
                      placeholder="Search components..."
                      value={componentSearch}
                      onChange={setComponentSearch}
                      clearButton
                      onClearButtonClick={() => setComponentSearch('')}
                      autoComplete="off"
                    />
                    <BlockStack gap="200">
                      {filteredComponents.length === 0 ? (
                        <Text tone="subdued">No components match "{componentSearch}"</Text>
                      ) : (
                        filteredComponents.slice(0, 10).map((c) => (
                          <InlineStack key={c.id} gap="200" blockAlign="center" wrap={false}>
                            <div style={{ flex: 1 }}>
                              <Text variant="bodySm" fontWeight="semibold">{c.internal_sku}</Text>
                              <Text variant="bodySm" tone="subdued">{c.description || 'No description'}</Text>
                              {c.total_available !== null && (
                                <Text variant="bodySm" tone={c.total_available <= 0 ? 'critical' : 'subdued'}>
                                  Stock: {c.total_available}
                                </Text>
                              )}
                            </div>
                            <div style={{ width: '80px' }}>
                              <TextField
                                label={`Qty for ${c.internal_sku}`}
                                labelHidden
                                type="number"
                                min="0"
                                value={form.componentQuantities[c.id] || ''}
                                onChange={handleQuantityChange(c.id)}
                                placeholder="0"
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>
                        ))
                      )}
                      {filteredComponents.length > 10 && (
                        <Text tone="subdued">
                          Showing 10 of {filteredComponents.length} components. Use search to find more.
                        </Text>
                      )}
                    </BlockStack>
                  </>
                )}

                <Button
                  variant="primary"
                  onClick={handleCreate}
                  loading={creating}
                  disabled={!form.bundle_sku || components.length === 0}
                >
                  Create BOM
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
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Search BOMs"
                    labelHidden
                    placeholder="Search by SKU, description, component..."
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
                    { label: 'All', value: 'all' },
                    { label: 'Active only', value: 'active' },
                    { label: 'Inactive only', value: 'inactive' },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
                {hasFilters && (
                  <Button onClick={handleClearFilters}>Clear</Button>
                )}
              </InlineStack>
            </Card>

            <Card>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner accessibilityLabel="Loading BOMs" size="large" />
                </div>
              ) : boms.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No BOMs yet</Text>
                    <Text tone="subdued">
                      Create your first Bill of Materials using the form. BOMs define what
                      components make up each product you sell.
                    </Text>
                  </BlockStack>
                </div>
              ) : filteredBoms.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No matching BOMs</Text>
                    <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                    <Button onClick={handleClearFilters}>Clear filters</Button>
                  </BlockStack>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text']}
                  headings={['Bundle SKU', 'Description', 'Components', 'Status']}
                  rows={rows}
                  hoverable
                  onRowClick={(row, index) => setSelectedBom(filteredBoms[index])}
                  footerContent={`${filteredBoms.length} of ${boms.length} BOM(s)`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* BOM Detail Modal */}
      {selectedBom && (
        <Modal
          open={!!selectedBom}
          onClose={() => setSelectedBom(null)}
          title={selectedBom.bundle_sku}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Bundle SKU</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{selectedBom.bundle_sku}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Status</Text>
                  {selectedBom.is_active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="default">Inactive</Badge>
                  )}
                </BlockStack>
              </InlineStack>

              {selectedBom.description && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Description</Text>
                  <Text variant="bodyMd">{selectedBom.description}</Text>
                </BlockStack>
              )}

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm">Components ({selectedBom.bom_components?.length || 0})</Text>
                {selectedBom.bom_components?.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                    headings={['SKU', 'Description', 'Qty Required', 'Stock']}
                    rows={selectedBom.bom_components.map((bc) => {
                      const comp = bc.components || components.find((c) => c.id === bc.component_id);
                      return [
                        <Text variant="bodyMd" fontWeight="semibold" key={bc.id}>
                          {comp?.internal_sku || 'Unknown'}
                        </Text>,
                        comp?.description || '-',
                        bc.qty_required,
                        comp?.total_available !== null ? (
                          <Badge tone={comp.total_available <= 0 ? 'critical' : comp.total_available < bc.qty_required ? 'warning' : 'success'}>
                            {comp.total_available}
                          </Badge>
                        ) : '-',
                      ];
                    })}
                  />
                ) : (
                  <Text tone="subdued">No components defined for this BOM.</Text>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
