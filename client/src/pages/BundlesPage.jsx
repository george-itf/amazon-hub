import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
  ProgressBar,
} from '@shopify/polaris';
import { getBoms, createBom, updateBom, getComponents } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

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
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [componentSearch, setComponentSearch] = useState('');
  const [sortBy, setSortBy] = useState('sku');

  // Detail modal
  const [selectedBom, setSelectedBom] = useState(null);

  // Edit modal state
  const [editingBom, setEditingBom] = useState(null);
  const [editForm, setEditForm] = useState({ description: '', componentQuantities: {} });
  const [editComponentSearch, setEditComponentSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [bomData, compData] = await Promise.all([getBoms({ limit: 99999 }), getComponents({ limit: 99999 })]);
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

  // Pre-calculate availability and cost for all BOMs once (memoized)
  const bomCalculations = useMemo(() => {
    const calculations = new Map();

    for (const bom of boms) {
      // Calculate availability
      let minAvailable = Infinity;
      let limitingComponent = null;

      if (bom.bom_components?.length) {
        for (const bc of bom.bom_components) {
          const comp = bc.components || components.find((c) => c.id === bc.component_id);
          if (!comp) continue;

          const available = comp.total_available || 0;
          const canMake = Math.floor(available / bc.qty_required);

          if (canMake < minAvailable) {
            minAvailable = canMake;
            limitingComponent = comp;
          }
        }
      }

      const availability = {
        available: minAvailable === Infinity ? 0 : minAvailable,
        limited: minAvailable < 10,
        limitingComponent,
      };

      // Calculate cost
      let totalCost = 0;
      if (bom.bom_components?.length) {
        for (const bc of bom.bom_components) {
          const comp = bc.components || components.find((c) => c.id === bc.component_id);
          if (comp?.cost_ex_vat_pence) {
            totalCost += comp.cost_ex_vat_pence * bc.qty_required;
          }
        }
      }

      calculations.set(bom.id, {
        availability,
        cost: totalCost || null,
      });
    }

    return calculations;
  }, [boms, components]);

  // Helper to get pre-calculated availability (fast lookup)
  const getAvailability = useCallback((bom) => {
    return bomCalculations.get(bom.id)?.availability || { available: 0, limited: false, limitingComponent: null };
  }, [bomCalculations]);

  // Helper to get pre-calculated cost (fast lookup)
  const getCost = useCallback((bom) => {
    return bomCalculations.get(bom.id)?.cost;
  }, [bomCalculations]);

  // Filter BOMs (uses pre-calculated values for fast filtering/sorting)
  const filteredBoms = useMemo(() => {
    let result = boms.filter((bom) => {
      // Status filter
      if (statusFilter === 'active' && !bom.is_active) return false;
      if (statusFilter === 'inactive' && bom.is_active) return false;

      // Availability filter (uses pre-calculated values)
      if (availabilityFilter !== 'all') {
        const { available } = getAvailability(bom);
        if (availabilityFilter === 'in_stock' && available <= 0) return false;
        if (availabilityFilter === 'low' && (available <= 0 || available >= 10)) return false;
        if (availabilityFilter === 'out' && available > 0) return false;
      }

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

    // Sort (uses pre-calculated values for fast sorting)
    result.sort((a, b) => {
      if (sortBy === 'sku') return (a.bundle_sku || '').localeCompare(b.bundle_sku || '');
      if (sortBy === 'availability') {
        const availA = getAvailability(a).available;
        const availB = getAvailability(b).available;
        return availA - availB;
      }
      if (sortBy === 'cost') {
        const costA = getCost(a) || 0;
        const costB = getCost(b) || 0;
        return costB - costA;
      }
      if (sortBy === 'components') {
        return (b.bom_components?.length || 0) - (a.bom_components?.length || 0);
      }
      return 0;
    });

    return result;
  }, [boms, statusFilter, availabilityFilter, searchQuery, components, sortBy, getAvailability, getCost]);

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
    setAvailabilityFilter('all');
    setSortBy('sku');
  };

  const hasFilters = searchQuery || statusFilter !== 'all' || availabilityFilter !== 'all' || sortBy !== 'sku';

  // Memoized form change handlers to prevent re-creation on each render
  const handleFormChange = useCallback((field) => {
    return (value) => setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleQuantityChange = useCallback((componentId) => {
    return (value) =>
      setForm((prev) => ({
        ...prev,
        componentQuantities: { ...prev.componentQuantities, [componentId]: value },
      }));
  }, []);

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

  // Open edit modal with BOM data pre-populated
  function handleEditBom(bom) {
    // Build componentQuantities from existing bom_components
    const componentQuantities = {};
    (bom.bom_components || []).forEach((bc) => {
      componentQuantities[bc.component_id] = String(bc.qty_required);
    });

    setEditForm({
      description: bom.description || '',
      componentQuantities,
    });
    setEditComponentSearch('');
    setSaveError(null);
    setEditingBom(bom);
    setSelectedBom(null); // Close detail modal if open
  }

  // Save BOM edits
  async function handleSaveEdit() {
    setSaving(true);
    setSaveError(null);
    try {
      const componentsList = Object.entries(editForm.componentQuantities)
        .filter(([, qty]) => {
          const parsed = parseInt(qty);
          return !isNaN(parsed) && parsed > 0;
        })
        .map(([component_id, qty_required]) => ({
          component_id,
          qty_required: parseInt(qty_required),
        }));

      if (componentsList.length === 0) {
        setSaveError('BOM must have at least one component with quantity > 0');
        setSaving(false);
        return;
      }

      await updateBom(editingBom.id, {
        description: editForm.description,
        components: componentsList,
      });

      setSuccessMessage(`BOM "${editingBom.bundle_sku}" updated successfully`);
      setEditingBom(null);
      await load();
    } catch (err) {
      setSaveError(err.message || 'Failed to update BOM');
    } finally {
      setSaving(false);
    }
  }

  // Edit form handlers
  const handleEditFormChange = useCallback((field) => {
    return (value) => setEditForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleEditQuantityChange = useCallback((componentId) => {
    return (value) =>
      setEditForm((prev) => ({
        ...prev,
        componentQuantities: { ...prev.componentQuantities, [componentId]: value },
      }));
  }, []);

  // Filter components for edit form
  const editFilteredComponents = useMemo(() => {
    if (!editComponentSearch) return components;
    const query = editComponentSearch.toLowerCase();
    return components.filter(
      (c) =>
        c.internal_sku?.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
    );
  }, [components, editComponentSearch]);

  // Count selected components in edit form
  const editSelectedCount = Object.values(editForm.componentQuantities).filter(
    (qty) => parseInt(qty) > 0
  ).length;

  // Count selected components
  const selectedCount = Object.values(form.componentQuantities).filter(
    (qty) => parseInt(qty) > 0
  ).length;

  // Calculate form cost preview
  const formCostPreview = useMemo(() => {
    let total = 0;
    for (const [compId, qty] of Object.entries(form.componentQuantities)) {
      const parsedQty = parseInt(qty);
      if (isNaN(parsedQty) || parsedQty <= 0) continue;
      const comp = components.find((c) => c.id === compId);
      if (comp?.cost_ex_vat_pence) {
        total += comp.cost_ex_vat_pence * parsedQty;
      }
    }
    return total;
  }, [form.componentQuantities, components]);

  // Calculate stats (uses pre-calculated values)
  const stats = useMemo(() => {
    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    let totalValue = 0;

    boms.forEach((bom) => {
      const { available } = getAvailability(bom);
      const cost = getCost(bom) || 0;

      if (available > 10) inStock++;
      else if (available > 0) lowStock++;
      else outOfStock++;

      totalValue += available * cost;
    });

    return { total: boms.length, inStock, lowStock, outOfStock, totalValue };
  }, [boms, getAvailability, getCost]);

  // Memoized availability badge renderer
  const getAvailabilityBadge = useCallback((bom) => {
    const { available, limitingComponent } = getAvailability(bom);
    if (available <= 0) {
      return (
        <Badge tone="critical">
          Out of stock
          {limitingComponent && ` (${limitingComponent.internal_sku})`}
        </Badge>
      );
    }
    if (available < 10) {
      return (
        <Badge tone="warning">
          {available} available
          {limitingComponent && ` (limited by ${limitingComponent.internal_sku})`}
        </Badge>
      );
    }
    return <Badge tone="success">{available} available</Badge>;
  }, [getAvailability]);

  // Memoize rows for the BOM table (uses pre-calculated values)
  const rows = useMemo(() => {
    return filteredBoms.map((bom) => {
      const compCount = bom.bom_components?.length || 0;
      const compList = bom.bom_components?.slice(0, 3).map((bc) => {
        const comp = bc.components || components.find((c) => c.id === bc.component_id);
        return `${comp?.internal_sku || '?'} ×${bc.qty_required}`;
      }) || [];
      const cost = getCost(bom);

      return [
        <button
          key={bom.id}
          onClick={() => setSelectedBom(bom)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
            color: 'var(--p-color-text-emphasis)',
          }}
        >
          <Text variant="bodyMd" fontWeight="semibold">
            {bom.bundle_sku}
          </Text>
        </button>,
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
        cost ? formatPrice(cost) : '-',
        getAvailabilityBadge(bom),
        bom.is_active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="default">Inactive</Badge>
        ),
      ];
    });
  }, [filteredBoms, components, getCost, getAvailabilityBadge]);

  return (
    <Page
      title="Product Catalog"
      subtitle={`${stats.total} products · ${stats.inStock} available · ${stats.outOfStock} out of stock`}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Stats Card */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Product Availability</Text>
                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Available</Text>
                    <Text variant="headingMd" tone="success">{stats.inStock}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Low Stock</Text>
                    <Text variant="headingMd" tone="warning">{stats.lowStock}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Unavailable</Text>
                    <Text variant="headingMd" tone="critical">{stats.outOfStock}</Text>
                  </BlockStack>
                </InlineStack>
                {stats.total > 0 && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Availability Health</Text>
                    <ProgressBar
                      progress={Math.round((stats.inStock / stats.total) * 100)}
                      tone={stats.outOfStock > 0 ? 'critical' : stats.lowStock > 0 ? 'warning' : 'success'}
                    />
                  </BlockStack>
                )}
                {stats.totalValue > 0 && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Potential Stock Value</Text>
                    <Text variant="headingMd" fontWeight="bold">{formatPrice(stats.totalValue)}</Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Create BOM Form */}
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
                    {formCostPreview > 0 && (
                      <Text variant="bodySm" tone="subdued">
                        Est. cost: {formatPrice(formCostPreview)}
                      </Text>
                    )}
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
                      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        <BlockStack gap="200">
                          {filteredComponents.length === 0 ? (
                            <Text tone="subdued">No components match "{componentSearch}"</Text>
                          ) : (
                            filteredComponents.slice(0, 15).map((c) => (
                              <InlineStack key={c.id} gap="200" blockAlign="center" wrap={false}>
                                <div style={{ flex: 1 }}>
                                  <Text variant="bodySm" fontWeight="semibold">{c.internal_sku}</Text>
                                  <Text variant="bodySm" tone="subdued">{c.description || 'No description'}</Text>
                                  <InlineStack gap="200">
                                    {c.total_available !== null && (
                                      <Text variant="bodySm" tone={c.total_available <= 0 ? 'critical' : 'subdued'}>
                                        Stock: {c.total_available}
                                      </Text>
                                    )}
                                    {c.cost_ex_vat_pence && (
                                      <Text variant="bodySm" tone="subdued">
                                        {formatPrice(c.cost_ex_vat_pence)}
                                      </Text>
                                    )}
                                  </InlineStack>
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
                          {filteredComponents.length > 15 && (
                            <Text tone="subdued">
                              Showing 15 of {filteredComponents.length} components. Use search to find more.
                            </Text>
                          )}
                        </BlockStack>
                      </div>
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
          </BlockStack>
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
                      { label: 'All statuses', value: 'all' },
                      { label: 'Active only', value: 'active' },
                      { label: 'Inactive only', value: 'inactive' },
                    ]}
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                  <Select
                    label="Availability"
                    labelHidden
                    options={[
                      { label: 'All availability', value: 'all' },
                      { label: 'In stock', value: 'in_stock' },
                      { label: 'Low stock', value: 'low' },
                      { label: 'Out of stock', value: 'out' },
                    ]}
                    value={availabilityFilter}
                    onChange={setAvailabilityFilter}
                  />
                  <Select
                    label="Sort"
                    labelHidden
                    options={[
                      { label: 'Sort by SKU', value: 'sku' },
                      { label: 'Availability: Low to High', value: 'availability' },
                      { label: 'Cost: High to Low', value: 'cost' },
                      { label: 'Components: Most', value: 'components' },
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
                    Showing {filteredBoms.length} of {boms.length} BOMs
                  </Text>
                )}
              </BlockStack>
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
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'text', 'text']}
                  headings={['Bundle SKU', 'Description', 'Components', 'Cost', 'Availability', 'Status']}
                  rows={rows}
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
          primaryAction={{
            content: 'Edit BOM',
            onAction: () => handleEditBom(selectedBom),
          }}
          secondaryActions={[
            { content: 'Close', onAction: () => setSelectedBom(null) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* BOM Info */}
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
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Total Cost</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {formatPrice(getCost(selectedBom))}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Availability</Text>
                  {getAvailabilityBadge(selectedBom)}
                </BlockStack>
              </InlineStack>

              {selectedBom.description && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Description</Text>
                  <Text variant="bodyMd">{selectedBom.description}</Text>
                </BlockStack>
              )}

              {/* Availability Breakdown */}
              {(() => {
                const { available, limitingComponent } = getAvailability(selectedBom);
                const cost = getCost(selectedBom);
                return (
                  <Card>
                    <InlineStack gap="800">
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Can Build</Text>
                        <Text variant="headingLg" fontWeight="bold" tone={available > 0 ? 'success' : 'critical'}>
                          {available}
                        </Text>
                      </BlockStack>
                      {cost && (
                        <>
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">Unit Cost</Text>
                            <Text variant="headingLg">{formatPrice(cost)}</Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text variant="bodySm" tone="subdued">Total Value</Text>
                            <Text variant="headingLg" fontWeight="bold">
                              {formatPrice(available * cost)}
                            </Text>
                          </BlockStack>
                        </>
                      )}
                      {limitingComponent && available < 50 && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Limiting Factor</Text>
                          <Badge tone="warning">{limitingComponent.internal_sku}</Badge>
                        </BlockStack>
                      )}
                    </InlineStack>
                  </Card>
                );
              })()}

              <Divider />

              <BlockStack gap="200">
                <Text variant="headingSm">Components ({selectedBom.bom_components?.length || 0})</Text>
                {selectedBom.bom_components?.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'text']}
                    headings={['SKU', 'Description', 'Qty Required', 'Stock', 'Can Make', 'Line Cost']}
                    rows={selectedBom.bom_components.map((bc) => {
                      const comp = bc.components || components.find((c) => c.id === bc.component_id);
                      const stock = comp?.total_available || 0;
                      const canMake = Math.floor(stock / bc.qty_required);
                      const lineCost = comp?.cost_ex_vat_pence ? comp.cost_ex_vat_pence * bc.qty_required : null;

                      return [
                        <Text variant="bodyMd" fontWeight="semibold" key={bc.id}>
                          {comp?.internal_sku || 'Unknown'}
                        </Text>,
                        comp?.description || '-',
                        bc.qty_required,
                        <Badge
                          key={`stock-${bc.id}`}
                          tone={stock <= 0 ? 'critical' : stock < bc.qty_required * 10 ? 'warning' : 'success'}
                        >
                          {stock}
                        </Badge>,
                        <Text
                          key={`canmake-${bc.id}`}
                          tone={canMake <= 0 ? 'critical' : canMake < 10 ? 'warning' : undefined}
                          fontWeight={canMake <= 0 ? 'bold' : undefined}
                        >
                          {canMake}
                        </Text>,
                        lineCost ? formatPrice(lineCost) : '-',
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

      {/* Edit BOM Modal */}
      {editingBom && (
        <Modal
          open={!!editingBom}
          onClose={() => setEditingBom(null)}
          title={`Edit BOM: ${editingBom.bundle_sku}`}
          large
          primaryAction={{
            content: 'Save Changes',
            onAction: handleSaveEdit,
            loading: saving,
            disabled: editSelectedCount === 0,
          }}
          secondaryActions={[
            { content: 'Cancel', onAction: () => setEditingBom(null) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {saveError && (
                <Banner tone="critical" onDismiss={() => setSaveError(null)}>
                  <p>{saveError}</p>
                </Banner>
              )}

              <TextField
                label="Description"
                value={editForm.description}
                onChange={handleEditFormChange('description')}
                placeholder="e.g., Starter Tool Kit"
              />

              <Divider />

              <InlineStack align="space-between">
                <Text variant="headingSm">Components ({editSelectedCount} selected)</Text>
              </InlineStack>

              <TextField
                label="Search components"
                labelHidden
                placeholder="Search components..."
                value={editComponentSearch}
                onChange={setEditComponentSearch}
                clearButton
                onClearButtonClick={() => setEditComponentSearch('')}
                autoComplete="off"
              />

              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <BlockStack gap="200">
                  {editFilteredComponents.length === 0 ? (
                    <Text tone="subdued">No components match "{editComponentSearch}"</Text>
                  ) : (
                    editFilteredComponents.map((c) => {
                      const currentQty = editForm.componentQuantities[c.id] || '';
                      const hasQty = parseInt(currentQty) > 0;
                      return (
                        <div
                          key={c.id}
                          style={{
                            padding: '8px',
                            borderRadius: '4px',
                            backgroundColor: hasQty ? 'var(--p-color-bg-surface-success)' : 'transparent',
                          }}
                        >
                          <InlineStack gap="200" blockAlign="center" wrap={false}>
                            <div style={{ flex: 1 }}>
                              <Text variant="bodySm" fontWeight="semibold">{c.internal_sku}</Text>
                              <Text variant="bodySm" tone="subdued">{c.description || 'No description'}</Text>
                              <InlineStack gap="200">
                                {c.total_available !== null && (
                                  <Text variant="bodySm" tone={c.total_available <= 0 ? 'critical' : 'subdued'}>
                                    Stock: {c.total_available}
                                  </Text>
                                )}
                                {c.cost_ex_vat_pence && (
                                  <Text variant="bodySm" tone="subdued">
                                    {formatPrice(c.cost_ex_vat_pence)}
                                  </Text>
                                )}
                              </InlineStack>
                            </div>
                            <div style={{ width: '80px' }}>
                              <TextField
                                label={`Qty for ${c.internal_sku}`}
                                labelHidden
                                type="number"
                                min="0"
                                value={currentQty}
                                onChange={handleEditQuantityChange(c.id)}
                                placeholder="0"
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>
                        </div>
                      );
                    })
                  )}
                </BlockStack>
              </div>

              {editSelectedCount > 0 && (
                <>
                  <Divider />
                  <Text variant="headingSm">Selected Components:</Text>
                  <InlineStack gap="200" wrap>
                    {Object.entries(editForm.componentQuantities)
                      .filter(([, qty]) => parseInt(qty) > 0)
                      .map(([compId, qty]) => {
                        const comp = components.find((c) => c.id === compId);
                        return (
                          <Badge key={compId} tone="success">
                            {comp?.internal_sku || compId} ×{qty}
                          </Badge>
                        );
                      })}
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
