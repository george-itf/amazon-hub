import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Select,
  Icon,
} from '@shopify/polaris';
import { RefreshIcon, CheckIcon, AlertTriangleIcon, ExportIcon } from '@shopify/polaris-icons';
import {
  getShippingStatus,
  getShippingServices,
  getReadyToShipOrders,
  getShippingBatches,
  getShippingTodayCost,
  syncShippingTracking,
} from '../utils/api.jsx';
import BatchProgressModal from '../components/BatchProgressModal.jsx';
import ShippingPreflightModal from '../components/ShippingPreflightModal.jsx';
import HubTable, { useHubTableState, useColumnManagement } from '../components/HubTable.jsx';
import { useSavedViews } from '../hooks/useSavedViews.js';

/**
 * ShippingPage - Batch shipping label creation with Royal Mail integration
 *
 * Migrated to use HubTable for unified table UX pattern.
 */

// Define columns for the shipping orders table
const SHIPPING_COLUMNS = [
  {
    key: 'order_id',
    label: 'Order ID',
    visible: true,
    required: true,
    sortable: true,
    accessor: (row) => row.order_number || row.external_order_id || '-',
  },
  {
    key: 'customer_name',
    label: 'Customer Name',
    visible: true,
    sortable: true,
    accessor: (row) => {
      if (row.customer_name) return row.customer_name;
      if (row.shipping_address?.name) return row.shipping_address.name;
      return '-';
    },
  },
  {
    key: 'status',
    label: 'Status',
    visible: true,
    sortable: true,
    accessor: (row) => row.status || 'READY_TO_SHIP',
    render: (value) => {
      const statusTones = {
        PICKED: 'success',
        READY_TO_PICK: 'warning',
        DISPATCHED: 'info',
        READY_TO_SHIP: 'attention',
        SHIPPED: 'success',
        CANCELLED: 'critical',
      };
      return <Badge tone={statusTones[value] || 'default'}>{value?.replace(/_/g, ' ')}</Badge>;
    },
  },
  {
    key: 'items_count',
    label: 'Items',
    visible: true,
    sortable: true,
    accessor: (row) => row.order_lines?.length || 0,
  },
  {
    key: 'total_value',
    label: 'Total Value',
    visible: true,
    sortable: true,
    accessor: (row) => row.total_price_pence || 0,
    render: (value) => `£${(value / 100).toFixed(2)}`,
  },
  {
    key: 'ship_by_date',
    label: 'Ship By',
    visible: true,
    sortable: true,
    accessor: (row) => row.ship_by_date || row.required_ship_date,
    render: (value) => value ? new Date(value).toLocaleDateString() : '-',
  },
  {
    key: 'service_code',
    label: 'Service',
    visible: true,
    sortable: true,
    accessor: (row) => row.service_code || row.shipping_service || '-',
  },
  {
    key: 'created_at',
    label: 'Created',
    visible: true,
    sortable: true,
    accessor: (row) => row.created_at,
    render: (value) => value ? new Date(value).toLocaleDateString() : '-',
  },
  {
    key: 'postcode',
    label: 'Postcode',
    visible: true,
    sortable: true,
    accessor: (row) => {
      const address = row.shipping_address;
      if (!address) return '-';
      return address.zip || address.PostalCode || '-';
    },
  },
];

// Define filter options
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'PICKED', label: 'Picked' },
  { value: 'READY_TO_PICK', label: 'Ready to Pick' },
  { value: 'READY_TO_SHIP', label: 'Ready to Ship' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'SHIPPED', label: 'Shipped' },
];

export default function ShippingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // API status
  const [apiStatus, setApiStatus] = useState({ connected: false, configured: false });
  const [services, setServices] = useState({ domestic: {}, international: {} });

  // Orders ready to ship
  const [orders, setOrders] = useState([]);

  // Batch history
  const [batches, setBatches] = useState([]);
  const [todayCost, setTodayCost] = useState({ total_cost_pence: 0, label_count: 0 });

  // Modal state
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchDryRun, setBatchDryRun] = useState(false);
  const [selectedServiceCode, setSelectedServiceCode] = useState('');
  const [preflightModalOpen, setPreflightModalOpen] = useState(false);

  // Sync tracking loading
  const [syncing, setSyncing] = useState(false);

  // HubTable state management
  const tableState = useHubTableState({
    initialPageSize: 50,
    initialFilters: {},
    syncToUrl: true,
  });

  // Column management with persistence
  const { columns, setColumnVisibility, reorderColumns } = useColumnManagement(
    SHIPPING_COLUMNS,
    'shipping_columns'
  );

  // Saved views integration
  const savedViewsHook = useSavedViews('shipping', {
    onViewChange: (view) => {
      // Apply view's filters to table state
      if (view?.filters) {
        tableState.setFilters(view.filters);
      } else {
        tableState.setFilters({});
      }
      if (view?.sort?.column) {
        tableState.setSort(view.sort.column, view.sort.direction || 'descending');
      }
    },
    syncUrl: true,
    autoApplyDefault: true,
  });

  // Build service options for filter
  const serviceOptions = useMemo(() => {
    const options = [{ value: 'all', label: 'All Services' }];
    Object.entries(services.domestic || {}).forEach(([key, svc]) => {
      options.push({
        value: svc.code,
        label: `${svc.name}`,
      });
    });
    return options;
  }, [services]);

  // Define filters for HubTable
  const filters = useMemo(() => [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: STATUS_OPTIONS,
    },
    {
      key: 'service_code',
      label: 'Service',
      type: 'select',
      options: serviceOptions,
    },
  ], [serviceOptions]);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statusRes, servicesRes, ordersRes, batchesRes, costRes] = await Promise.all([
        getShippingStatus(),
        getShippingServices(),
        getReadyToShipOrders(),
        getShippingBatches(10),
        getShippingTodayCost(),
      ]);

      setApiStatus(statusRes);
      setServices(servicesRes);
      setOrders(ordersRes.orders || []);
      setBatches(batchesRes.batches || []);
      setTodayCost(costRes);
    } catch (err) {
      console.error('Failed to load shipping data:', err);
      setError(err.message || 'Failed to load shipping data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter orders based on table state
  const filteredOrders = useMemo(() => {
    let result = [...orders];

    // Apply search filter
    if (tableState.searchValue) {
      const query = tableState.searchValue.toLowerCase();
      result = result.filter((order) => {
        return (
          order.order_number?.toLowerCase().includes(query) ||
          order.external_order_id?.toLowerCase().includes(query) ||
          order.customer_name?.toLowerCase().includes(query) ||
          order.shipping_address?.zip?.toLowerCase().includes(query) ||
          order.shipping_address?.PostalCode?.toLowerCase().includes(query)
        );
      });
    }

    // Apply status filter
    if (tableState.activeFilters.status && tableState.activeFilters.status !== 'all') {
      result = result.filter((order) => order.status === tableState.activeFilters.status);
    }

    // Apply service code filter
    if (tableState.activeFilters.service_code && tableState.activeFilters.service_code !== 'all') {
      result = result.filter((order) =>
        order.service_code === tableState.activeFilters.service_code ||
        order.shipping_service === tableState.activeFilters.service_code
      );
    }

    // Apply sorting
    if (tableState.sortColumn) {
      const column = columns.find(c => c.key === tableState.sortColumn);
      if (column?.accessor) {
        result.sort((a, b) => {
          const aVal = column.accessor(a);
          const bVal = column.accessor(b);

          if (aVal < bVal) return tableState.sortDirection === 'ascending' ? -1 : 1;
          if (aVal > bVal) return tableState.sortDirection === 'ascending' ? 1 : -1;
          return 0;
        });
      }
    }

    return result;
  }, [orders, tableState.searchValue, tableState.activeFilters, tableState.sortColumn, tableState.sortDirection, columns]);

  // Get selected orders
  const selectedOrders = useMemo(() => {
    return filteredOrders.filter(order => tableState.selectedIds.includes(order.id));
  }, [filteredOrders, tableState.selectedIds]);

  // Actions
  const handleCreateLabels = (dryRun = false) => {
    if (tableState.selectedIds.length === 0) return;

    if (dryRun) {
      // Dry run goes directly to batch modal
      setBatchDryRun(true);
      setBatchModalOpen(true);
    } else {
      // Live label creation goes through preflight modal first
      setPreflightModalOpen(true);
    }
  };

  // Called when user confirms in preflight modal
  const handlePreflightConfirm = () => {
    setPreflightModalOpen(false);
    setBatchDryRun(false);
    setBatchModalOpen(true);
  };

  const handleBatchComplete = (response) => {
    // Refresh data after batch completes
    loadData();
    tableState.setSelectedIds([]);
  };

  const handleSyncTracking = async () => {
    setSyncing(true);
    try {
      await syncShippingTracking({ daysBack: 7 });
      await loadData();
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = () => {
    // Export selected orders as CSV
    const selectedData = selectedOrders.map(order => ({
      order_id: order.order_number || order.external_order_id,
      customer: order.customer_name || order.shipping_address?.name || '',
      status: order.status,
      items: order.order_lines?.length || 0,
      total: ((order.total_price_pence || 0) / 100).toFixed(2),
      postcode: order.shipping_address?.zip || order.shipping_address?.PostalCode || '',
    }));

    const csv = [
      Object.keys(selectedData[0] || {}).join(','),
      ...selectedData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipping-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Define bulk actions for HubTable
  const bulkActions = useMemo(() => [
    {
      id: 'create-labels',
      label: `Create Labels (${tableState.selectedIds.length})`,
      primary: true,
      disabled: tableState.selectedIds.length === 0 || tableState.selectedIds.length > 100 || !apiStatus.connected,
      tooltip: !apiStatus.connected
        ? 'Royal Mail API not connected'
        : tableState.selectedIds.length > 100
          ? 'Maximum 100 orders per batch'
          : 'Create shipping labels for selected orders',
      onAction: () => handleCreateLabels(false),
    },
    {
      id: 'dry-run',
      label: 'Dry Run',
      disabled: tableState.selectedIds.length === 0 || tableState.selectedIds.length > 100 || !apiStatus.connected,
      tooltip: 'Test label creation without printing',
      onAction: () => handleCreateLabels(true),
    },
    {
      id: 'export',
      label: 'Export',
      icon: ExportIcon,
      disabled: tableState.selectedIds.length === 0,
      tooltip: 'Export selected orders as CSV',
      onAction: handleExport,
    },
  ], [tableState.selectedIds, apiStatus.connected]);

  // Handle saving a view
  const handleSaveView = async (name, isShared) => {
    try {
      await savedViewsHook.saveView(name, {
        filters: tableState.activeFilters,
        columns: columns.filter(c => c.visible !== false).map(c => c.key),
        sort: tableState.sortColumn ? {
          column: tableState.sortColumn,
          direction: tableState.sortDirection,
        } : {},
        is_shared: isShared,
      });
    } catch (err) {
      setError(err.message || 'Failed to save view');
    }
  };

  // Service options for dropdown (for label creation)
  const labelServiceOptions = [
    { label: 'Default (Tracked 24)', value: '' },
    ...Object.entries(services.domestic || {}).map(([key, svc]) => ({
      label: `${svc.name} - ${svc.description}`,
      value: svc.code,
    })),
  ];

  // Last batch info
  const lastBatch = batches[0];

  return (
    <Page
      title="Shipping"
      subtitle="Batch label creation with Royal Mail Click & Drop"
      primaryAction={{
        content: 'Refresh',
        icon: RefreshIcon,
        onAction: loadData,
        loading: loading,
      }}
      secondaryActions={[
        {
          content: 'Sync Tracking',
          onAction: handleSyncTracking,
          loading: syncing,
        },
      ]}
    >
      <Layout>
        {/* Status Cards - Using design system */}
        <Layout.Section>
          <div className="hub-grid hub-grid--3">
            {/* API Status Card */}
            <div className={`hub-stat-card ${apiStatus.connected ? 'hub-stat-card--success' : 'hub-stat-card--critical'}`}>
              <BlockStack gap="200">
                <InlineStack gap="200" align="center">
                  {apiStatus.connected ? (
                    <Icon source={CheckIcon} tone="success" />
                  ) : (
                    <Icon source={AlertTriangleIcon} tone="critical" />
                  )}
                  <Text variant="headingSm">Royal Mail API</Text>
                </InlineStack>
                <Badge tone={apiStatus.connected ? 'success' : 'critical'}>
                  {apiStatus.connected ? 'Connected' : apiStatus.configured ? 'Disconnected' : 'Not Configured'}
                </Badge>
              </BlockStack>
            </div>

            {/* Last Batch Card */}
            <div className="hub-stat-card">
              <BlockStack gap="200">
                <Text variant="headingSm">Last Batch</Text>
                {lastBatch ? (
                  <>
                    <InlineStack gap="200">
                      <Badge tone="success">{lastBatch.success} ok</Badge>
                      {lastBatch.failed > 0 && <Badge tone="critical">{lastBatch.failed} failed</Badge>}
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">
                      {new Date(lastBatch.created_at).toLocaleString()}
                    </Text>
                  </>
                ) : (
                  <Text variant="bodySm" tone="subdued">No batches yet</Text>
                )}
              </BlockStack>
            </div>

            {/* Today's Cost Card */}
            <div className="hub-stat-card">
              <BlockStack gap="200">
                <Text variant="headingSm">Today's Shipping</Text>
                <Text variant="headingLg" fontWeight="bold">
                  £{todayCost.total_cost_pounds || '0.00'}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  {todayCost.label_count} labels
                </Text>
              </BlockStack>
            </div>
          </div>
        </Layout.Section>

        {/* Error Banner */}
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Service Selector for Label Creation */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd">Ready to Ship ({filteredOrders.length})</Text>
                <Select
                  label="Label Service"
                  labelHidden
                  options={labelServiceOptions}
                  value={selectedServiceCode}
                  onChange={setSelectedServiceCode}
                />
              </InlineStack>

              {tableState.selectedIds.length > 100 && (
                <Banner tone="warning">
                  <p>Maximum 100 orders per batch. Please deselect {tableState.selectedIds.length - 100} orders.</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Main Orders Table using HubTable */}
        <Layout.Section>
          <HubTable
            // Data
            columns={columns}
            rows={filteredOrders}
            resourceName={{ singular: 'order', plural: 'orders' }}
            idAccessor="id"

            // Selection
            selectable={true}
            selectedIds={tableState.selectedIds}
            onSelectionChange={tableState.setSelectedIds}

            // Filtering
            filters={filters}
            activeFilters={tableState.activeFilters}
            onFilterChange={tableState.setFilters}

            // Search
            searchValue={tableState.searchValue}
            onSearchChange={tableState.setSearch}
            searchPlaceholder="Search by order #, customer, postcode..."

            // Saved Views
            savedViews={savedViewsHook.views}
            currentViewId={savedViewsHook.activeViewId}
            onViewChange={(viewId) => savedViewsHook.selectView(viewId)}
            onSaveView={handleSaveView}
            onDeleteView={savedViewsHook.deleteView}

            // Bulk Actions
            bulkActions={bulkActions}

            // Sorting
            sortColumn={tableState.sortColumn}
            sortDirection={tableState.sortDirection}
            onSort={tableState.setSort}

            // Pagination
            page={tableState.page}
            pageSize={tableState.pageSize}
            totalCount={filteredOrders.length}
            onPageChange={tableState.setPage}
            onPageSizeChange={tableState.setPageSize}

            // Column Management
            onColumnVisibilityChange={setColumnVisibility}
            onColumnReorder={reorderColumns}

            // Loading
            loading={loading}

            // Footer
            footerContent={`${tableState.selectedIds.length} selected of ${filteredOrders.length} orders • Max 100 per batch`}

            // Empty state
            emptyState={{
              heading: 'No orders ready to ship',
              description: 'Orders appear here when they are picked and ready for shipping labels.',
            }}

            // URL sync
            syncToUrl={true}
          />
        </Layout.Section>

        {/* Batch History */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd">Recent Batches</Text>
              {batches.length === 0 ? (
                <Text tone="subdued">No batch history yet</Text>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'text']}
                  headings={['Time', 'Type', 'Total', 'Success', 'Failed', 'Cost', 'Duration']}
                  rows={batches.map((batch) => [
                    new Date(batch.created_at).toLocaleString(),
                    batch.dry_run ? <Badge tone="info">Dry Run</Badge> : <Badge tone="success">Live</Badge>,
                    batch.total,
                    batch.success,
                    batch.failed > 0 ? (
                      <Text tone="critical">{batch.failed}</Text>
                    ) : (
                      batch.failed
                    ),
                    `£${((batch.total_cost_pence || 0) / 100).toFixed(2)}`,
                    `${batch.duration_ms}ms`,
                  ])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Shipping Preflight Modal - Guardrail pattern */}
      <ShippingPreflightModal
        open={preflightModalOpen}
        orderIds={tableState.selectedIds}
        orders={filteredOrders}
        serviceCode={selectedServiceCode || undefined}
        serviceName={
          selectedServiceCode
            ? labelServiceOptions.find(opt => opt.value === selectedServiceCode)?.label
            : 'Tracked 24'
        }
        onClose={() => setPreflightModalOpen(false)}
        onConfirm={handlePreflightConfirm}
      />

      {/* Batch Progress Modal */}
      <BatchProgressModal
        open={batchModalOpen}
        orderIds={tableState.selectedIds}
        dryRun={batchDryRun}
        serviceCode={selectedServiceCode || undefined}
        onClose={() => setBatchModalOpen(false)}
        onComplete={handleBatchComplete}
      />
    </Page>
  );
}
