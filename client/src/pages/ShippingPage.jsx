import React, { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useDebounce } from '../hooks/useDebounce.js';
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
  Checkbox,
  Select,
  TextField,
  Divider,
  Icon,
} from '@shopify/polaris';
import { RefreshIcon, CheckIcon, AlertTriangleIcon } from '@shopify/polaris-icons';
import {
  getShippingStatus,
  getShippingServices,
  getReadyToShipOrders,
  getShippingBatches,
  getShippingTodayCost,
  syncShippingTracking,
} from '../utils/api.jsx';
import BatchProgressModal from '../components/BatchProgressModal.jsx';

/**
 * ShippingPage - Batch shipping label creation with Royal Mail integration
 */
export default function ShippingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // API status
  const [apiStatus, setApiStatus] = useState({ connected: false, configured: false });
  const [services, setServices] = useState({ domestic: {}, international: {} });

  // Orders ready to ship
  const [orders, setOrders] = useState([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());

  // Batch history
  const [batches, setBatches] = useState([]);
  const [todayCost, setTodayCost] = useState({ total_cost_pence: 0, label_count: 0 });

  // Modal state
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchDryRun, setBatchDryRun] = useState(false);
  const [selectedServiceCode, setSelectedServiceCode] = useState('');

  // Filters - debounce search for smoother filtering
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);

  // Sync tracking loading
  const [syncing, setSyncing] = useState(false);

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

  // Filter orders - use debounced search for smoother UX
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Search filter using debounced query
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
        const matches =
          order.order_number?.toLowerCase().includes(query) ||
          order.external_order_id?.toLowerCase().includes(query) ||
          order.customer_name?.toLowerCase().includes(query) ||
          order.shipping_address?.zip?.toLowerCase().includes(query) ||
          order.shipping_address?.PostalCode?.toLowerCase().includes(query);
        if (!matches) return false;
      }

      return true;
    });
  }, [orders, debouncedSearchQuery]);

  // Selection handlers
  const handleSelectOrder = (orderId) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedOrderIds.size === filteredOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(filteredOrders.map((o) => o.id)));
    }
  };

  // Format address
  const formatPostcode = (address) => {
    if (!address) return '-';
    return address.zip || address.PostalCode || '-';
  };

  const formatCustomerName = (order) => {
    if (order.customer_name) return order.customer_name;
    if (order.shipping_address?.name) return order.shipping_address.name;
    return '-';
  };

  // Build table rows
  const rows = filteredOrders.map((order) => {
    const isSelected = selectedOrderIds.has(order.id);
    return [
      <Checkbox
        key={`check-${order.id}`}
        checked={isSelected}
        onChange={() => handleSelectOrder(order.id)}
        label=""
        labelHidden
      />,
      order.order_number || order.external_order_id || '-',
      formatCustomerName(order),
      formatPostcode(order.shipping_address),
      order.order_lines?.length || 0,
      `£${((order.total_price_pence || 0) / 100).toFixed(2)}`,
    ];
  });

  // Actions
  const handleCreateLabels = (dryRun = false) => {
    if (selectedOrderIds.size === 0) return;
    setBatchDryRun(dryRun);
    setBatchModalOpen(true);
  };

  const handleBatchComplete = (response) => {
    // Refresh data after batch completes
    loadData();
    setSelectedOrderIds(new Set());
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

  // Service options for dropdown
  const serviceOptions = [
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

        {/* Main Content */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {/* Header */}
              <InlineStack align="space-between">
                <Text variant="headingMd">Ready to Ship ({filteredOrders.length})</Text>
                <InlineStack gap="200">
                  <Select
                    label="Service"
                    labelHidden
                    options={serviceOptions}
                    value={selectedServiceCode}
                    onChange={setSelectedServiceCode}
                  />
                </InlineStack>
              </InlineStack>

              {/* Search Filter */}
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by order #, customer, postcode..."
                value={searchQuery}
                onChange={setSearchQuery}
                clearButton
                onClearButtonClick={() => setSearchQuery('')}
                autoComplete="off"
              />

              {/* Actions Bar */}
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  onClick={() => handleCreateLabels(false)}
                  disabled={selectedOrderIds.size === 0 || !apiStatus.connected}
                >
                  Create Labels ({selectedOrderIds.size})
                </Button>
                <Button
                  onClick={() => handleCreateLabels(true)}
                  disabled={selectedOrderIds.size === 0 || !apiStatus.connected}
                >
                  Dry Run
                </Button>
                <Button onClick={handleSyncTracking} loading={syncing}>
                  Sync Tracking
                </Button>
                {selectedOrderIds.size > 0 && (
                  <Button plain onClick={() => setSelectedOrderIds(new Set())}>
                    Clear Selection
                  </Button>
                )}
              </InlineStack>

              <Divider />

              {/* Orders Table */}
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner accessibilityLabel="Loading orders" size="large" />
                </div>
              ) : filteredOrders.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No orders ready to ship</Text>
                    <Text tone="subdued">
                      Orders appear here when they are picked and ready for shipping labels.
                    </Text>
                  </BlockStack>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'numeric']}
                  headings={[
                    <Checkbox
                      key="select-all"
                      checked={selectedOrderIds.size === filteredOrders.length && filteredOrders.length > 0}
                      onChange={handleSelectAll}
                      label="Select all"
                      labelHidden
                    />,
                    'Order #',
                    'Customer',
                    'Postcode',
                    'Items',
                    'Value',
                  ]}
                  rows={rows}
                  footerContent={`${selectedOrderIds.size} selected of ${filteredOrders.length} orders`}
                />
              )}
            </BlockStack>
          </Card>
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

      {/* Batch Progress Modal */}
      <BatchProgressModal
        open={batchModalOpen}
        orderIds={Array.from(selectedOrderIds)}
        dryRun={batchDryRun}
        serviceCode={selectedServiceCode || undefined}
        onClose={() => setBatchModalOpen(false)}
        onComplete={handleBatchComplete}
      />
    </Page>
  );
}
