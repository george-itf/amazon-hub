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
  Icon,
  Tooltip,
} from '@shopify/polaris';
import { PlusIcon, DeleteIcon, EditIcon } from '@shopify/polaris-icons';
import { getComponents, createComponent, adjustStock, getStockMovements, updateComponent } from '../utils/api.jsx';
import { useUserPreferences } from '../hooks/useUserPreferences.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * InventoryPage - Component stock management with custom tabs
 *
 * Features:
 * - View all component stock with cost prices
 * - Custom tabs by brand, product type, or any grouping
 * - Easy cost price updating
 * - Stock adjustments
 * - Filtering and search
 */
export default function InventoryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [components, setComponents] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [sortBy, setSortBy] = useState('sku');
  const [usageFilter, setUsageFilter] = useState('all'); // 'all', 'active', 'unassigned'

  // User preferences for cross-device sync
  const { getPreference, setPreference, loading: prefsLoading } = useUserPreferences();

  // Custom tabs state - synced via user preferences
  const [customTabs, setCustomTabs] = useState(() => {
    // Initial load from localStorage while preferences are loading
    try {
      const saved = localStorage.getItem('inventory_custom_tabs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // Sync custom tabs from user preferences when loaded
  useEffect(() => {
    if (!prefsLoading) {
      const savedTabs = getPreference('inventory_custom_tabs', []);
      if (Array.isArray(savedTabs)) {
        setCustomTabs(savedTabs);
      }
    }
  }, [prefsLoading, getPreference]);

  // Tab management modal
  const [tabModalOpen, setTabModalOpen] = useState(false);
  const [tabForm, setTabForm] = useState({ name: '', filterType: 'brand', filterValue: '' });

  // Detail modal state
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [componentHistory, setComponentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Stock adjustment modal state
  const [adjustModal, setAdjustModal] = useState({ open: false, component: null });
  const [adjustForm, setAdjustForm] = useState({ quantity: '', reason: 'STOCK_COUNT', note: '' });
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState(null);

  // Edit cost modal
  const [editCostModal, setEditCostModal] = useState({ open: false, component: null });
  const [editCostValue, setEditCostValue] = useState('');
  const [editingCost, setEditingCost] = useState(false);

  // Create component modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ internal_sku: '', description: '', brand: '', product_type: '', cost_ex_vat_pence: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Save custom tabs to user preferences (syncs to server if logged in)
  useEffect(() => {
    // Skip initial render to avoid overwriting server data before it loads
    if (!prefsLoading) {
      setPreference('inventory_custom_tabs', customTabs);
    }
  }, [customTabs, setPreference, prefsLoading]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getComponents({ limit: 99999 });
      setComponents(data.components || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load inventory');
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

  // Get unique brands and product types for tab creation
  const uniqueBrands = useMemo(() => {
    const brands = new Set(components.map(c => c.brand).filter(Boolean));
    return Array.from(brands).sort();
  }, [components]);

  const uniqueProductTypes = useMemo(() => {
    const types = new Set(components.map(c => c.product_type).filter(Boolean));
    return Array.from(types).sort();
  }, [components]);

  // Build tabs array: "All" + custom tabs
  const tabs = useMemo(() => {
    const allTab = { id: 'all', content: `All (${components.length})` };
    const customTabItems = customTabs.map((tab, index) => {
      const count = components.filter(c => {
        if (tab.filterType === 'brand') return c.brand === tab.filterValue;
        if (tab.filterType === 'product_type') return c.product_type === tab.filterValue;
        return false;
      }).length;
      return {
        id: `custom-${index}`,
        content: `${tab.name} (${count})`,
        filterType: tab.filterType,
        filterValue: tab.filterValue,
      };
    });
    return [allTab, ...customTabItems];
  }, [components, customTabs]);

  // Filter components based on selected tab + search + filters
  const filteredComponents = useMemo(() => {
    let result = components;

    // Apply usage filter (Active = in BOM, Unassigned = not in any BOM)
    if (usageFilter === 'active') {
      result = result.filter(c => c.active_bom_count > 0);
    } else if (usageFilter === 'unassigned') {
      result = result.filter(c => !c.active_bom_count || c.active_bom_count === 0);
    }

    // Apply tab filter
    if (selectedTabIndex > 0 && customTabs[selectedTabIndex - 1]) {
      const tab = customTabs[selectedTabIndex - 1];
      result = result.filter(c => {
        if (tab.filterType === 'brand') return c.brand === tab.filterValue;
        if (tab.filterType === 'product_type') return c.product_type === tab.filterValue;
        return true;
      });
    }

    // Apply stock filter
    result = result.filter(c => {
      if (stockFilter === 'low' && (c.total_available === null || c.total_available >= 10)) return false;
      if (stockFilter === 'out' && (c.total_available === null || c.total_available > 0)) return false;
      if (stockFilter === 'in' && (c.total_available === null || c.total_available <= 0)) return false;
      return true;
    });

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.internal_sku?.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query) ||
        c.brand?.toLowerCase().includes(query) ||
        c.product_type?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'sku') return (a.internal_sku || '').localeCompare(b.internal_sku || '');
      if (sortBy === 'stock_asc') return (a.total_available || 0) - (b.total_available || 0);
      if (sortBy === 'stock_desc') return (b.total_available || 0) - (a.total_available || 0);
      if (sortBy === 'cost') return (b.cost_ex_vat_pence || 0) - (a.cost_ex_vat_pence || 0);
      if (sortBy === 'brand') return (a.brand || '').localeCompare(b.brand || '');
      return 0;
    });

    return result;
  }, [components, selectedTabIndex, customTabs, searchQuery, stockFilter, sortBy, usageFilter]);

  // Stats for current view
  const stats = useMemo(() => {
    const items = filteredComponents;
    const total = items.length;
    const inStock = items.filter(c => c.total_available !== null && c.total_available > 10).length;
    const lowStock = items.filter(c => c.total_available !== null && c.total_available > 0 && c.total_available <= 10).length;
    const outOfStock = items.filter(c => c.total_available !== null && c.total_available <= 0).length;
    const totalValue = items.reduce((sum, c) => {
      const qty = c.total_available || 0;
      const cost = c.cost_ex_vat_pence || 0;
      return sum + qty * cost;
    }, 0);
    return { total, inStock, lowStock, outOfStock, totalValue };
  }, [filteredComponents]);

  // Global usage stats (not affected by filters)
  const usageStats = useMemo(() => {
    const activeCount = components.filter(c => c.active_bom_count > 0).length;
    const unassignedCount = components.filter(c => !c.active_bom_count || c.active_bom_count === 0).length;
    return { activeCount, unassignedCount };
  }, [components]);

  // Tab management
  const handleAddTab = () => {
    if (!tabForm.name || !tabForm.filterValue) return;
    setCustomTabs(prev => [...prev, { ...tabForm }]);
    setTabForm({ name: '', filterType: 'brand', filterValue: '' });
    setTabModalOpen(false);
  };

  const handleRemoveTab = (index) => {
    setCustomTabs(prev => prev.filter((_, i) => i !== index));
    if (selectedTabIndex > index + 1) {
      setSelectedTabIndex(selectedTabIndex - 1);
    } else if (selectedTabIndex === index + 1) {
      setSelectedTabIndex(0);
    }
  };

  // Stock badge
  function getStockBadge(available, reorderPoint = 10) {
    if (available === undefined || available === null) {
      return <Badge tone="default">No data</Badge>;
    }
    if (available <= 0) {
      return <Badge tone="critical">Out</Badge>;
    }
    if (available < reorderPoint) {
      return <Badge tone="warning">{available}</Badge>;
    }
    return <Badge tone="success">{available}</Badge>;
  }

  // Adjust stock handlers
  function openAdjustModal(component) {
    setAdjustModal({ open: true, component });
    setAdjustForm({ quantity: '', reason: 'STOCK_COUNT', note: '' });
    setAdjustError(null);
  }

  function closeAdjustModal() {
    setAdjustModal({ open: false, component: null });
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
      await adjustStock(adjustModal.component.id, 'DEFAULT', qty, adjustForm.reason, adjustForm.note || undefined);
      setSuccessMessage(`Stock adjusted for ${adjustModal.component.internal_sku}`);
      closeAdjustModal();
      await load();
    } catch (err) {
      setAdjustError(err?.message || 'Failed to adjust stock');
    } finally {
      setAdjusting(false);
    }
  }

  // Edit cost handlers
  function openEditCost(component) {
    setEditCostModal({ open: true, component });
    setEditCostValue(component.cost_ex_vat_pence ? (component.cost_ex_vat_pence / 100).toFixed(2) : '');
  }

  async function handleUpdateCost() {
    if (!editCostModal.component) return;
    setEditingCost(true);
    try {
      const costPence = editCostValue ? Math.round(parseFloat(editCostValue) * 100) : null;
      await updateComponent(editCostModal.component.id, { cost_ex_vat_pence: costPence });
      setSuccessMessage(`Cost updated for ${editCostModal.component.internal_sku}`);
      setEditCostModal({ open: false, component: null });
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to update cost');
    } finally {
      setEditingCost(false);
    }
  }

  // Create component handlers
  async function handleCreateComponent() {
    setCreating(true);
    setCreateError(null);
    try {
      const costPence = createForm.cost_ex_vat_pence ? Math.round(parseFloat(createForm.cost_ex_vat_pence) * 100) : null;
      await createComponent({
        internal_sku: createForm.internal_sku,
        description: createForm.description,
        brand: createForm.brand,
        product_type: createForm.product_type,
        cost_ex_vat_pence: costPence,
      });
      setSuccessMessage(`Component ${createForm.internal_sku} created`);
      setCreateForm({ internal_sku: '', description: '', brand: '', product_type: '', cost_ex_vat_pence: '' });
      setCreateModal(false);
      await load();
    } catch (err) {
      setCreateError(err?.message || 'Failed to create component');
    } finally {
      setCreating(false);
    }
  }

  // Table rows
  const rows = filteredComponents.map(c => [
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
    <Text variant="bodySm" key={`desc-${c.id}`} tone="subdued">
      {c.description?.substring(0, 40) || '-'}
      {c.description?.length > 40 && '...'}
    </Text>,
    c.brand || '-',
    c.active_bom_count > 0 ? (
      <Badge key={`bom-${c.id}`} tone="success">{c.active_bom_count} BOM{c.active_bom_count !== 1 ? 's' : ''}</Badge>
    ) : (
      <Badge key={`bom-${c.id}`} tone="info">Unassigned</Badge>
    ),
    <InlineStack gap="100" key={`cost-${c.id}`} blockAlign="center">
      <Text variant="bodyMd" fontWeight="medium">{formatPrice(c.cost_ex_vat_pence)}</Text>
      <Button size="micro" variant="plain" onClick={() => openEditCost(c)} icon={EditIcon} />
    </InlineStack>,
    <InlineStack gap="200" key={`stock-${c.id}`} blockAlign="center">
      {getStockBadge(c.total_available)}
      <Button size="slim" onClick={() => openAdjustModal(c)}>Adjust</Button>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Inventory"
      subtitle={`${stats.total} items • ${formatPrice(stats.totalValue)} total value`}
      primaryAction={{
        content: 'Add Item',
        onAction: () => setCreateModal(true),
        icon: PlusIcon,
      }}
      secondaryActions={[
        { content: 'Add Tab', onAction: () => setTabModalOpen(true) },
        { content: 'Refresh', onAction: load },
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
              <Text variant="bodySm" tone="subdued">Total Items</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.total}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">In Stock</Text>
              <Text variant="headingLg" fontWeight="bold" tone="success">{stats.inStock}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Low Stock</Text>
              <Text variant="headingLg" fontWeight="bold" tone={stats.lowStock > 0 ? 'caution' : undefined}>
                {stats.lowStock}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Out of Stock</Text>
              <Text variant="headingLg" fontWeight="bold" tone={stats.outOfStock > 0 ? 'critical' : undefined}>
                {stats.outOfStock}
              </Text>
            </BlockStack>
          </Card>
        </div>

        {/* Custom Tabs */}
        <Card>
          <BlockStack gap="400">
            <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={setSelectedTabIndex}>
              {/* Tab content handled below */}
            </Tabs>

            {/* Tab removal buttons for custom tabs */}
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

        {/* Usage Filter Tabs (Active vs Unassigned) */}
        <Card>
          <BlockStack gap="200">
            <Text variant="headingSm">Filter by Usage</Text>
            <InlineStack gap="200">
              <Button
                variant={usageFilter === 'all' ? 'primary' : 'secondary'}
                onClick={() => setUsageFilter('all')}
                size="slim"
              >
                All ({components.length})
              </Button>
              <Button
                variant={usageFilter === 'active' ? 'primary' : 'secondary'}
                onClick={() => setUsageFilter('active')}
                size="slim"
              >
                Active in BOMs ({usageStats.activeCount})
              </Button>
              <Button
                variant={usageFilter === 'unassigned' ? 'primary' : 'secondary'}
                onClick={() => setUsageFilter('unassigned')}
                size="slim"
              >
                Unassigned ({usageStats.unassignedCount})
              </Button>
            </InlineStack>
            <Text variant="bodySm" tone="subdued">
              {usageFilter === 'active'
                ? 'Components currently used in active listing BOMs'
                : usageFilter === 'unassigned'
                  ? 'Components not assigned to any BOM - available for new listings'
                  : 'Showing all components'}
            </Text>
          </BlockStack>
        </Card>

        {/* Search and Filters */}
        <Card>
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
                { label: 'Sort by Brand', value: 'brand' },
                { label: 'Stock: Low to High', value: 'stock_asc' },
                { label: 'Stock: High to Low', value: 'stock_desc' },
                { label: 'Cost: High to Low', value: 'cost' },
              ]}
              value={sortBy}
              onChange={setSortBy}
            />
          </InlineStack>
        </Card>

        {/* Data Table */}
        <Card>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Spinner accessibilityLabel="Loading inventory" size="large" />
            </div>
          ) : filteredComponents.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No items found</Text>
                <Text tone="subdued">
                  {searchQuery || stockFilter !== 'all'
                    ? 'Try adjusting your search or filter.'
                    : 'Add your first inventory item to get started.'}
                </Text>
                {(searchQuery || stockFilter !== 'all') && (
                  <Button onClick={() => { setSearchQuery(''); setStockFilter('all'); }}>
                    Clear filters
                  </Button>
                )}
              </BlockStack>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'text']}
              headings={['SKU', 'Description', 'Brand', 'Usage', 'Cost', 'Stock']}
              rows={rows}
              footerContent={`${filteredComponents.length} item(s)`}
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
              <p>Create a tab to quickly filter your inventory by brand or product type.</p>
            </Banner>
            <FormLayout>
              <TextField
                label="Tab Name"
                value={tabForm.name}
                onChange={(v) => setTabForm(f => ({ ...f, name: v }))}
                placeholder="e.g., Makita, Screws, Power Tools"
                autoComplete="off"
              />
              <Select
                label="Filter By"
                options={[
                  { label: 'Brand', value: 'brand' },
                  { label: 'Product Type', value: 'product_type' },
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
                    : uniqueProductTypes.map(t => ({ label: t, value: t }))
                  ),
                ]}
                value={tabForm.filterValue}
                onChange={(v) => setTabForm(f => ({ ...f, filterValue: v }))}
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Create Component Modal */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Add Inventory Item"
        primaryAction={{
          content: 'Create',
          onAction: handleCreateComponent,
          loading: creating,
          disabled: !createForm.internal_sku,
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
            <FormLayout>
              <TextField
                label="Internal SKU"
                value={createForm.internal_sku}
                onChange={(v) => setCreateForm(f => ({ ...f, internal_sku: v }))}
                placeholder="e.g., INV-SCRW-001"
                autoComplete="off"
              />
              <TextField
                label="Description"
                value={createForm.description}
                onChange={(v) => setCreateForm(f => ({ ...f, description: v }))}
                placeholder="e.g., M6 x 20mm Hex Bolt"
              />
              <TextField
                label="Brand"
                value={createForm.brand}
                onChange={(v) => setCreateForm(f => ({ ...f, brand: v }))}
                placeholder="e.g., Makita, DeWalt, Bosch"
              />
              <TextField
                label="Product Type"
                value={createForm.product_type}
                onChange={(v) => setCreateForm(f => ({ ...f, product_type: v }))}
                placeholder="e.g., Screws, Drills, Bits"
              />
              <TextField
                label="Cost ex VAT (£)"
                value={createForm.cost_ex_vat_pence}
                type="number"
                onChange={(v) => setCreateForm(f => ({ ...f, cost_ex_vat_pence: v }))}
                placeholder="0.00"
                prefix="£"
                step="0.01"
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Edit Cost Modal */}
      <Modal
        open={editCostModal.open}
        onClose={() => setEditCostModal({ open: false, component: null })}
        title={`Edit Cost: ${editCostModal.component?.internal_sku}`}
        primaryAction={{
          content: 'Update Cost',
          onAction: handleUpdateCost,
          loading: editingCost,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setEditCostModal({ open: false, component: null }) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Cost ex VAT (£)"
              value={editCostValue}
              type="number"
              onChange={setEditCostValue}
              prefix="£"
              step="0.01"
              autoComplete="off"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

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
          secondaryActions={[{ content: 'Cancel', onAction: closeAdjustModal }]}
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
                      {adjustModal.component?.total_available ?? 0}
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
                  onChange={(v) => setAdjustForm(f => ({ ...f, quantity: v }))}
                  helpText="Positive to add, negative to remove"
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
                  onChange={(v) => setAdjustForm(f => ({ ...f, reason: v }))}
                />
                <TextField
                  label="Note (optional)"
                  value={adjustForm.note}
                  onChange={(v) => setAdjustForm(f => ({ ...f, note: v }))}
                  placeholder="Add a note about this adjustment"
                  multiline={2}
                />
              </FormLayout>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

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

              {selectedComponent.total_available > 0 && selectedComponent.cost_ex_vat_pence && (
                <Card>
                  <InlineStack gap="800">
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Quantity</Text>
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
                    rows={componentHistory.map(m => [
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
    </Page>
  );
}
