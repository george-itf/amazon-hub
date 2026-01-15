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
} from '@shopify/polaris';
import { getComponents, createComponent, adjustStock, getStockMovements } from '../utils/api.jsx';
import SavedViewsBar from '../components/SavedViewsBar.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * ComponentsPage lists all components and provides a simple form to
 * create new ones. Shows stock levels and allows creating inventory items.
 */
export default function ComponentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({ internal_sku: '', description: '', brand: '', cost_ex_vat_pence: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [sortBy, setSortBy] = useState('sku');

  // Detail modal state
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [componentHistory, setComponentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Stock adjustment modal state
  const [adjustModal, setAdjustModal] = useState({ open: false, component: null });
  const [adjustForm, setAdjustForm] = useState({ quantity: '', reason: 'STOCK_COUNT', note: '' });
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getComponents({ limit: 99999 });
      setComponents(data.components || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load components');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Load component history when detail modal opens
  useEffect(() => {
    async function loadHistory() {
      if (!selectedComponent) return;
      setHistoryLoading(true);
      try {
        const data = await getStockMovements({ component_id: selectedComponent.id, limit: 20 });
        setComponentHistory(data.movements || []);
      } catch (err) {
        console.error('Failed to load component history:', err);
        setComponentHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    }
    loadHistory();
  }, [selectedComponent]);

  // Filter and search
  const filteredComponents = useMemo(() => {
    let result = components.filter((c) => {
      // Stock filter
      if (stockFilter === 'low' && (c.total_available === null || c.total_available >= 10)) return false;
      if (stockFilter === 'out' && (c.total_available === null || c.total_available > 0)) return false;
      if (stockFilter === 'in' && (c.total_available === null || c.total_available <= 0)) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          c.internal_sku?.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.brand?.toLowerCase().includes(query)
        );
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'sku') return (a.internal_sku || '').localeCompare(b.internal_sku || '');
      if (sortBy === 'stock_asc') return (a.total_available || 0) - (b.total_available || 0);
      if (sortBy === 'stock_desc') return (b.total_available || 0) - (a.total_available || 0);
      if (sortBy === 'cost') return (b.cost_ex_vat_pence || 0) - (a.cost_ex_vat_pence || 0);
      return 0;
    });

    return result;
  }, [components, searchQuery, stockFilter, sortBy]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStockFilter('all');
    setSortBy('sku');
  };

  // Handler for SavedViewsBar filter changes
  const handleViewFilterChange = useCallback((filters) => {
    if (filters.searchQuery !== undefined) setSearchQuery(filters.searchQuery);
    if (filters.stockFilter !== undefined) setStockFilter(filters.stockFilter);
    if (filters.sortBy !== undefined) setSortBy(filters.sortBy);
  }, []);

  // Current filters for SavedViewsBar
  const currentFilters = useMemo(() => ({
    searchQuery,
    stockFilter,
    sortBy,
  }), [searchQuery, stockFilter, sortBy]);

  const hasFilters = searchQuery || stockFilter !== 'all' || sortBy !== 'sku';

  function handleChange(field) {
    return (value) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    setCreating(true);
    setCreateError(null);
    try {
      // Convert cost to pence
      const costPence = form.cost_ex_vat_pence ? Math.round(parseFloat(form.cost_ex_vat_pence) * 100) : null;
      await createComponent({
        internal_sku: form.internal_sku,
        description: form.description,
        brand: form.brand,
        cost_ex_vat_pence: costPence,
      });
      setForm({ internal_sku: '', description: '', brand: '', cost_ex_vat_pence: '' });
      setSuccessMessage(`Component ${form.internal_sku} created successfully`);
      await load();
    } catch (err) {
      setCreateError(err.message || 'Failed to create component');
    } finally {
      setCreating(false);
    }
  }

  function openAdjustModal(component) {
    setAdjustModal({ open: true, component });
    setAdjustForm({ quantity: '', reason: 'STOCK_COUNT', note: '' });
    setAdjustError(null);
  }

  function closeAdjustModal() {
    setAdjustModal({ open: false, component: null });
    setAdjustForm({ quantity: '', reason: 'STOCK_COUNT', note: '' });
    setAdjustError(null);
  }

  async function handleAdjustStock() {
    if (!adjustModal.component) return;

    const qty = parseInt(adjustForm.quantity);
    if (isNaN(qty) || qty === 0) {
      setAdjustError('Please enter a valid quantity');
      return;
    }

    setAdjusting(true);
    setAdjustError(null);
    try {
      // adjustStock(componentId, location, delta, reason, note, idempotencyKey)
      await adjustStock(
        adjustModal.component.id,
        'DEFAULT', // Default warehouse location
        qty,
        adjustForm.reason,
        adjustForm.note || undefined
      );
      setSuccessMessage(`Stock adjusted for ${adjustModal.component.internal_sku}`);
      closeAdjustModal();
      await load();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to adjust stock');
      setAdjustError(errorMsg);
    } finally {
      setAdjusting(false);
    }
  }

  function getStockBadge(available, reorderPoint = 10) {
    if (available === undefined || available === null) {
      return <Badge tone="default">No stock data</Badge>;
    }
    if (available <= 0) {
      return <Badge tone="critical">Out of stock</Badge>;
    }
    if (available < reorderPoint) {
      return <Badge tone="warning">Low: {available}</Badge>;
    }
    return <Badge tone="success">{available} available</Badge>;
  }

  // Calculate stats
  const stats = useMemo(() => {
    const total = components.length;
    const inStock = components.filter((c) => c.total_available !== null && c.total_available > 10).length;
    const lowStock = components.filter((c) => c.total_available !== null && c.total_available > 0 && c.total_available <= 10).length;
    const outOfStock = components.filter((c) => c.total_available !== null && c.total_available <= 0).length;
    const totalValue = components.reduce((sum, c) => {
      const qty = c.total_available || 0;
      const cost = c.cost_ex_vat_pence || 0;
      return sum + qty * cost;
    }, 0);
    return { total, inStock, lowStock, outOfStock, totalValue };
  }, [components]);

  const rows = filteredComponents.map((c) => [
    <Text
      variant="bodyMd"
      fontWeight="semibold"
      key={c.id}
      as="button"
      onClick={() => setSelectedComponent(c)}
      style={{ cursor: 'pointer', textDecoration: 'underline' }}
    >
      {c.internal_sku}
    </Text>,
    c.description || '-',
    c.brand || '-',
    formatPrice(c.cost_ex_vat_pence),
    <InlineStack gap="200" key={`stock-${c.id}`} blockAlign="center">
      {getStockBadge(c.total_available)}
      <Button size="slim" onClick={() => openAdjustModal(c)}>Adjust</Button>
    </InlineStack>,
  ]);

  // Calculate alert message
  const alertCount = stats.lowStock + stats.outOfStock;

  return (
    <Page
      title="Inventory"
      subtitle={alertCount > 0
        ? `${alertCount} item${alertCount > 1 ? 's' : ''} need attention • ${stats.total} total SKUs`
        : `${stats.total} SKUs • £${(stats.totalValue / 100).toFixed(2)} total value`}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Stats Cards */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd">Stock Health</Text>
                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">In Stock</Text>
                    <Text variant="headingMd" tone="success">{stats.inStock}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Low Stock</Text>
                    <Text variant="headingMd" tone="warning">{stats.lowStock}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Out</Text>
                    <Text variant="headingMd" tone="critical">{stats.outOfStock}</Text>
                  </BlockStack>
                </InlineStack>
                {stats.total > 0 && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Stock Health</Text>
                    <ProgressBar
                      progress={Math.round((stats.inStock / stats.total) * 100)}
                      tone={stats.outOfStock > 0 ? 'critical' : stats.lowStock > 0 ? 'warning' : 'success'}
                    />
                    <Text variant="bodySm" tone="subdued">
                      {Math.round((stats.inStock / stats.total) * 100)}% healthy
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Add Inventory Item Form */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Add Inventory Item</Text>

                {createError && (
                  <Banner tone="critical" onDismiss={() => setCreateError(null)}>
                    <p>{createError}</p>
                  </Banner>
                )}

                <FormLayout>
                  <TextField
                    label="Internal SKU"
                    value={form.internal_sku}
                    onChange={handleChange('internal_sku')}
                    placeholder="e.g., INV-SCRW-001"
                    helpText="Unique identifier for this component"
                    autoComplete="off"
                  />
                  <TextField
                    label="Description"
                    value={form.description}
                    onChange={handleChange('description')}
                    placeholder="e.g., M6 x 20mm Hex Bolt"
                  />
                  <TextField
                    label="Brand"
                    value={form.brand}
                    onChange={handleChange('brand')}
                    placeholder="e.g., Invicta"
                  />
                  <TextField
                    label="Cost ex VAT (£)"
                    value={form.cost_ex_vat_pence}
                    type="number"
                    onChange={handleChange('cost_ex_vat_pence')}
                    placeholder="0.00"
                    prefix="£"
                    step="0.01"
                  />
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    loading={creating}
                    disabled={!form.internal_sku}
                  >
                    Create Component
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            {/* Success message */}
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

            {/* Saved Views Bar */}
            <Card>
              <SavedViewsBar
                context="components"
                currentFilters={currentFilters}
                onFilterChange={handleViewFilterChange}
                filterKeys={['searchQuery', 'stockFilter', 'sortBy']}
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
                      placeholder="Search by SKU, description, brand..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                      clearButton
                      onClearButtonClick={() => setSearchQuery('')}
                      autoComplete="off"
                    />
                  </div>
                  <Select
                    label="Stock"
                    labelHidden
                    options={[
                      { label: 'All stock levels', value: 'all' },
                      { label: 'In stock', value: 'in' },
                      { label: 'Low stock', value: 'low' },
                      { label: 'Out of stock', value: 'out' },
                    ]}
                    value={stockFilter}
                    onChange={setStockFilter}
                  />
                  <Select
                    label="Sort"
                    labelHidden
                    options={[
                      { label: 'Sort by SKU', value: 'sku' },
                      { label: 'Stock: Low to High', value: 'stock_asc' },
                      { label: 'Stock: High to Low', value: 'stock_desc' },
                      { label: 'Cost: High to Low', value: 'cost' },
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
                    Showing {filteredComponents.length} of {components.length} components
                  </Text>
                )}
              </BlockStack>
            </Card>

            <Card>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner accessibilityLabel="Loading components" size="large" />
                </div>
              ) : components.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No components yet</Text>
                    <Text tone="subdued">
                      Create your first component using the form on the left.
                    </Text>
                  </BlockStack>
                </div>
              ) : filteredComponents.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No matching components</Text>
                    <Text tone="subdued">
                      Try adjusting your search or filter criteria.
                    </Text>
                    <Button onClick={handleClearFilters}>Clear filters</Button>
                  </BlockStack>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
                  headings={['SKU', 'Description', 'Brand', 'Cost', 'Stock']}
                  rows={rows}
                  footerContent={`${filteredComponents.length} of ${components.length} component(s)`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Component Detail Modal */}
      {selectedComponent && (
        <Modal
          open={!!selectedComponent}
          onClose={() => setSelectedComponent(null)}
          title={selectedComponent.internal_sku}
          large
          primaryAction={{
            content: 'Adjust Stock',
            onAction: () => {
              setSelectedComponent(null);
              openAdjustModal(selectedComponent);
            },
          }}
          secondaryActions={[{ content: 'Close', onAction: () => setSelectedComponent(null) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* Component Info */}
              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">SKU</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{selectedComponent.internal_sku}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Brand</Text>
                  <Text variant="bodyMd">{selectedComponent.brand || '-'}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Cost</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{formatPrice(selectedComponent.cost_ex_vat_pence)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Stock</Text>
                  {getStockBadge(selectedComponent.total_available)}
                </BlockStack>
              </InlineStack>

              {selectedComponent.description && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Description</Text>
                  <Text variant="bodyMd">{selectedComponent.description}</Text>
                </BlockStack>
              )}

              {/* Stock Value */}
              {selectedComponent.total_available > 0 && selectedComponent.cost_ex_vat_pence && (
                <Card>
                  <InlineStack gap="800">
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Stock Quantity</Text>
                      <Text variant="headingMd">{selectedComponent.total_available}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Unit Cost</Text>
                      <Text variant="headingMd">{formatPrice(selectedComponent.cost_ex_vat_pence)}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Total Value</Text>
                      <Text variant="headingMd" fontWeight="bold">
                        {formatPrice(selectedComponent.total_available * selectedComponent.cost_ex_vat_pence)}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Card>
              )}

              <Divider />

              {/* Stock Movement History */}
              <BlockStack gap="200">
                <Text variant="headingSm">Recent Stock Movements</Text>
                {historyLoading ? (
                  <div style={{ padding: '20px', textAlign: 'center' }}>
                    <Spinner size="small" />
                  </div>
                ) : componentHistory.length === 0 ? (
                  <Text tone="subdued">No stock movements recorded yet.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'numeric', 'text', 'text']}
                    headings={['Date', 'Change', 'Reason', 'Note']}
                    rows={componentHistory.map((m) => [
                      new Date(m.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      <Text
                        key={m.id}
                        tone={m.delta > 0 ? 'success' : m.delta < 0 ? 'critical' : undefined}
                        fontWeight="semibold"
                      >
                        {m.delta > 0 ? '+' : ''}{m.delta}
                      </Text>,
                      <Badge key={`reason-${m.id}`}>{m.reason || 'Unknown'}</Badge>,
                      m.note || '-',
                    ])}
                  />
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModal.open && (
        <Modal
          open={adjustModal.open}
          onClose={closeAdjustModal}
          title={`Adjust Stock: ${adjustModal.component?.internal_sku}`}
          primaryAction={{
            content: 'Adjust Stock',
            onAction: handleAdjustStock,
            loading: adjusting,
          }}
          secondaryActions={[{
            content: 'Cancel',
            onAction: closeAdjustModal,
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {adjustError && (
                <Banner tone="critical" onDismiss={() => setAdjustError(null)}>
                  <p>{adjustError}</p>
                </Banner>
              )}

              <Card>
                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Current Stock</Text>
                    <Text variant="headingMd" fontWeight="bold">
                      {adjustModal.component?.total_available ?? 'Unknown'}
                    </Text>
                  </BlockStack>
                  {adjustForm.quantity && !isNaN(parseInt(adjustForm.quantity)) && (
                    <>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Change</Text>
                        <Text
                          variant="headingMd"
                          fontWeight="bold"
                          tone={parseInt(adjustForm.quantity) > 0 ? 'success' : 'critical'}
                        >
                          {parseInt(adjustForm.quantity) > 0 ? '+' : ''}{adjustForm.quantity}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">New Stock</Text>
                        <Text variant="headingMd" fontWeight="bold">
                          {(adjustModal.component?.total_available || 0) + parseInt(adjustForm.quantity)}
                        </Text>
                      </BlockStack>
                    </>
                  )}
                </InlineStack>
              </Card>

              <FormLayout>
                <TextField
                  label="Quantity Change"
                  type="number"
                  value={adjustForm.quantity}
                  onChange={(value) => setAdjustForm((prev) => ({ ...prev, quantity: value }))}
                  helpText="Use positive numbers to add stock, negative to remove"
                  placeholder="e.g., 10 or -5"
                  autoComplete="off"
                />
                <Select
                  label="Reason"
                  options={[
                    { label: 'Stock Count', value: 'STOCK_COUNT' },
                    { label: 'Purchase', value: 'PURCHASE' },
                    { label: 'Damage/Loss', value: 'DAMAGE' },
                    { label: 'Return to Supplier', value: 'SUPPLIER_RETURN' },
                    { label: 'Customer Return', value: 'CUSTOMER_RETURN' },
                    { label: 'Adjustment', value: 'ADJUSTMENT' },
                  ]}
                  value={adjustForm.reason}
                  onChange={(value) => setAdjustForm((prev) => ({ ...prev, reason: value }))}
                />
                <TextField
                  label="Note (optional)"
                  value={adjustForm.note}
                  onChange={(value) => setAdjustForm((prev) => ({ ...prev, note: value }))}
                  placeholder="Add a note about this adjustment"
                  multiline={2}
                />
              </FormLayout>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
