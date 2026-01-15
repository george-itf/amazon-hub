import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Divider,
  TextField,
  Select,
  DataTable,
  Modal,
  Tabs,
  ProgressBar,
  Checkbox,
  FormLayout,
} from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import {
  InvictaLoading,
  InvictaButton,
  InvictaBadge,
} from '../components/ui/index.jsx';
import KeepaMetrics, { KeepaMetricsCompact, KeepaStatusCard } from '../components/KeepaMetrics.jsx';
import * as api from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (!pence && pence !== 0) return '-';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

/**
 * AmazonPage - Amazon integration management
 */
export default function AmazonPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Status and stats
  const [amazonStatus, setAmazonStatus] = useState(null);
  const [shippingStatus, setShippingStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [pendingShipments, setPendingShipments] = useState([]);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncType, setSyncType] = useState(null);

  // Shipment confirmation modal (single)
  const [shipmentModal, setShipmentModal] = useState({ open: false, order: null });
  const [trackingNumber, setTrackingNumber] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Bulk shipment confirmation
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkTrackingNumbers, setBulkTrackingNumbers] = useState({});
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // Tabs
  const [selectedTab, setSelectedTab] = useState(0);

  // Listings state
  const [listings, setListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsSearch, setListingsSearch] = useState('');
  const [listingsFilter, setListingsFilter] = useState('all');
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [catalogSyncResult, setCatalogSyncResult] = useState(null);

  // BOM mapping modal
  const [mappingModal, setMappingModal] = useState({ open: false, listing: null });
  const [selectedBomId, setSelectedBomId] = useState('');
  const [mapping, setMapping] = useState(false);
  const [availableBoms, setAvailableBoms] = useState([]);

  // Scheduler state
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [schedulerSettings, setSchedulerSettings] = useState({
    orderSyncEnabled: true,
    orderSyncInterval: 30,
    trackingSyncEnabled: true,
    trackingSyncInterval: 60,
    catalogSyncEnabled: false,
    catalogSyncInterval: 360,
  });
  const [savingScheduler, setSavingScheduler] = useState(false);

  // Inventory allocation state
  const [inventoryRecommendations, setInventoryRecommendations] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // Inventory push state
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushDryRun, setPushDryRun] = useState(true);
  const [pushResult, setPushResult] = useState(null);
  const [pushing, setPushing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [amzStatus, shipStatus, amzStats, pending] = await Promise.all([
        api.getAmazonStatus().catch(() => ({ connected: false })),
        api.getShippingStatus().catch(() => ({ connected: false })),
        api.getAmazonStats().catch(() => null),
        api.getAmazonPendingShipments().catch(() => ({ orders: [] })),
      ]);

      setAmazonStatus(amzStatus);
      setShippingStatus(shipStatus);
      setStats(amzStats);
      setPendingShipments(pending.orders || []);
    } catch (err) {
      console.error('Load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load listings when tab changes to listings
  const loadListings = useCallback(async () => {
    try {
      setListingsLoading(true);
      const params = { limit: 100 };
      if (listingsSearch) params.search = listingsSearch;
      if (listingsFilter !== 'all') params.mapped = listingsFilter === 'mapped' ? 'true' : 'false';

      const result = await api.getAmazonListings(params);
      setListings(result.listings || []);
    } catch (err) {
      console.error('Failed to load listings:', err);
      setError(err.message);
    } finally {
      setListingsLoading(false);
    }
  }, [listingsSearch, listingsFilter]);

  useEffect(() => {
    if (selectedTab === 3) {
      loadListings();
    }
  }, [selectedTab, loadListings]);

  const handleSyncCatalog = async () => {
    try {
      setCatalogSyncing(true);
      setCatalogSyncResult(null);
      const result = await api.syncAmazonCatalog(null, 30);
      setCatalogSyncResult(result);
      await loadListings();
    } catch (err) {
      setError(err.message);
    } finally {
      setCatalogSyncing(false);
    }
  };

  const openMappingModal = async (listing) => {
    setMappingModal({ open: true, listing });
    setSelectedBomId('');

    // Load available BOMs
    try {
      const result = await api.getBoms({ limit: 500, status: 'ACTIVE' });
      setAvailableBoms(result.boms || []);
    } catch (err) {
      console.error('Failed to load BOMs:', err);
    }
  };

  const handleMapListing = async () => {
    if (!selectedBomId || !mappingModal.listing) return;

    try {
      setMapping(true);
      await api.mapAmazonListing(mappingModal.listing.asin, selectedBomId);
      setMappingModal({ open: false, listing: null });
      await loadListings();
    } catch (err) {
      setError(err.message);
    } finally {
      setMapping(false);
    }
  };

  // Load scheduler status
  const loadSchedulerStatus = useCallback(async () => {
    try {
      const status = await api.getSchedulerStatus();
      setSchedulerStatus(status);
    } catch (err) {
      console.error('Failed to load scheduler status:', err);
    }
  }, []);

  useEffect(() => {
    if (selectedTab === 2) {
      loadSchedulerStatus();
    }
  }, [selectedTab, loadSchedulerStatus]);

  // Load inventory recommendations when tab changes
  const loadInventoryRecommendations = useCallback(async () => {
    try {
      setInventoryLoading(true);
      const result = await api.getInventoryRecommendations({ location: 'Warehouse' });
      setInventoryRecommendations(result);
    } catch (err) {
      console.error('Failed to load inventory recommendations:', err);
      setError(err.message);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTab === 4) {
      loadInventoryRecommendations();
    }
  }, [selectedTab, loadInventoryRecommendations]);

  // Handle inventory push to Amazon
  const handlePushInventory = async () => {
    try {
      setPushing(true);
      const result = await api.pushAmazonInventory({
        location: 'Warehouse',
        dry_run: pushDryRun,
        only_mapped: true,
        limit: 50,
      });
      setPushResult(result);

      // If live push was successful, refresh recommendations
      if (!pushDryRun && result.success > 0) {
        await loadInventoryRecommendations();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPushing(false);
    }
  };

  const handleSaveSchedulerSettings = async () => {
    try {
      setSavingScheduler(true);
      await api.updateSchedulerSettings(schedulerSettings);
      await loadSchedulerStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingScheduler(false);
    }
  };

  const handleSyncOrders = async () => {
    try {
      setSyncing(true);
      setSyncType('orders');
      setSyncResult(null);
      const result = await api.syncAmazonOrders(7);
      setSyncResult({ type: 'orders', ...result });
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
      setSyncType(null);
    }
  };

  const handleSyncFees = async () => {
    try {
      setSyncing(true);
      setSyncType('fees');
      setSyncResult(null);
      const result = await api.syncAmazonFees(30);
      setSyncResult({ type: 'fees', ...result });
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
      setSyncType(null);
    }
  };

  const handleSyncTracking = async () => {
    try {
      setSyncing(true);
      setSyncType('tracking');
      setSyncResult(null);
      const result = await api.syncShippingTracking(7, true);
      setSyncResult({ type: 'tracking', ...result });
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
      setSyncType(null);
    }
  };

  const handleConfirmShipment = async () => {
    if (!trackingNumber || !shipmentModal.order) return;

    try {
      setConfirming(true);
      const orderId = shipmentModal.order.external_order_id || shipmentModal.order.amazon_order_id;
      await api.confirmAmazonShipment(orderId, 'Royal Mail', trackingNumber);
      setShipmentModal({ open: false, order: null });
      setTrackingNumber('');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  };

  const openShipmentModal = (order) => {
    setShipmentModal({ open: true, order });
    setTrackingNumber('');
  };

  // Bulk selection handlers
  const toggleOrderSelection = (orderId) => {
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === pendingShipments.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(pendingShipments.map(o => o.id)));
    }
  };

  const openBulkModal = () => {
    // Initialize tracking numbers for selected orders
    const initialTracking = {};
    selectedOrders.forEach(id => {
      initialTracking[id] = '';
    });
    setBulkTrackingNumbers(initialTracking);
    setBulkResult(null);
    setBulkModal(true);
  };

  const handleBulkConfirm = async () => {
    // Build shipments array
    const shipments = [];
    for (const [orderId, tracking] of Object.entries(bulkTrackingNumbers)) {
      if (tracking.trim()) {
        shipments.push({
          orderId,
          trackingNumber: tracking.trim(),
          carrierCode: 'Royal Mail',
        });
      }
    }

    if (shipments.length === 0) {
      setError('Please enter at least one tracking number');
      return;
    }

    try {
      setBulkConfirming(true);
      const result = await api.confirmBulkShipments(shipments, true);
      setBulkResult(result);

      if (result.confirmed > 0) {
        // Clear selection and reload data
        setSelectedOrders(new Set());
        await loadData();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkConfirming(false);
    }
  };

  const getSelectedOrderDetails = () => {
    return pendingShipments.filter(o => selectedOrders.has(o.id));
  };

  if (loading) {
    return (
      <Page title="Amazon">
        <InvictaLoading message="Loading Amazon data..." />
      </Page>
    );
  }

  const tabs = [
    { id: 'overview', content: 'Overview' },
    { id: 'shipments', content: `Pending Shipments (${pendingShipments.length})` },
    { id: 'sync', content: 'Sync & Settings' },
    { id: 'listings', content: 'Listings' },
    { id: 'inventory', content: 'Inventory Allocation' },
  ];

  return (
    <Page
      title="Amazon Settings"
      subtitle="Configure SP-API connection, sync orders, and manage shipping"
      primaryAction={{
        content: syncing && syncType === 'orders' ? 'Syncing...' : 'Sync Orders',
        onAction: handleSyncOrders,
        loading: syncing && syncType === 'orders',
        disabled: !amazonStatus?.connected,
      }}
      secondaryActions={[
        {
          content: 'Sync Tracking',
          onAction: handleSyncTracking,
          disabled: !shippingStatus?.connected || syncing,
        },
        { content: 'Refresh', onAction: loadData },
      ]}
    >
      <BlockStack gap="600">
        {/* Error Banner */}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Sync Result Banner */}
        {syncResult && (
          <Banner
            tone="success"
            title={`${syncResult.type === 'orders' ? 'Order' : syncResult.type === 'fees' ? 'Fees' : 'Tracking'} Sync Complete`}
            onDismiss={() => setSyncResult(null)}
          >
            <p>
              {syncResult.type === 'orders' && (
                <>
                  {syncResult.created} new, {syncResult.linked || 0} linked, {syncResult.updated} updated, {syncResult.skipped} unchanged
                  {syncResult.errors?.length > 0 && ` (${syncResult.errors.length} errors)`}
                </>
              )}
              {syncResult.type === 'fees' && (
                <>{syncResult.created} fee records synced</>
              )}
              {syncResult.type === 'tracking' && (
                <>
                  {syncResult.trackingFound} tracking numbers found, {syncResult.amazonConfirmed} confirmed on Amazon
                </>
              )}
            </p>
          </Banner>
        )}

        {/* Connection Status */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingSm">Amazon SP-API</Text>
                  <Badge tone={amazonStatus?.connected ? 'success' : 'critical'}>
                    {amazonStatus?.connected ? 'Connected' : 'Not Connected'}
                  </Badge>
                </InlineStack>
                {amazonStatus?.connected && (
                  <Text variant="bodySm" tone="subdued">
                    Marketplace: {amazonStatus.marketplaceId}
                  </Text>
                )}
                {!amazonStatus?.connected && (
                  <Text variant="bodySm" tone="subdued">
                    {amazonStatus?.message || 'Configure SP-API credentials'}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingSm">Royal Mail Click & Drop</Text>
                  <Badge tone={shippingStatus?.connected ? 'success' : 'critical'}>
                    {shippingStatus?.connected ? 'Connected' : 'Not Connected'}
                  </Badge>
                </InlineStack>
                {!shippingStatus?.connected && (
                  <Text variant="bodySm" tone="subdued">
                    {shippingStatus?.message || 'Configure ROYAL_MAIL_API_KEY'}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <KeepaStatusCard />
          </Layout.Section>
        </Layout>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
          {/* Overview Tab - Sales Dashboard */}
          {selectedTab === 0 && stats && (
            <BlockStack gap="400">
              {/* Key Metrics */}
              <Layout>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Monthly Orders</Text>
                      <Text variant="heading2xl" fontWeight="bold">
                        {stats.monthly_order_count || 0}
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        {stats.total_orders || 0} total orders
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Monthly Revenue</Text>
                      <Text variant="heading2xl" fontWeight="bold" tone="success">
                        {formatPrice(stats.monthly_revenue_pence)}
                      </Text>
                      {stats.revenue_growth_percent !== undefined && (
                        <InlineStack gap="100" blockAlign="center">
                          <Badge tone={stats.revenue_growth_percent >= 0 ? 'success' : 'critical'}>
                            {stats.revenue_growth_percent >= 0 ? '+' : ''}{stats.revenue_growth_percent}%
                          </Badge>
                          <Text variant="bodySm" tone="subdued">vs last month</Text>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Amazon Fees</Text>
                      <Text variant="heading2xl" fontWeight="bold" tone="critical">
                        {formatPrice(stats.monthly_fees_pence)}
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        {stats.monthly_revenue_pence > 0
                          ? `${((stats.monthly_fees_pence / stats.monthly_revenue_pence) * 100).toFixed(1)}% of revenue`
                          : '-'}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Monthly Net</Text>
                      <Text
                        variant="heading2xl"
                        fontWeight="bold"
                        tone={stats.monthly_net_pence >= 0 ? 'success' : 'critical'}
                      >
                        {formatPrice(stats.monthly_net_pence)}
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        {stats.monthly_revenue_pence > 0
                          ? `${((stats.monthly_net_pence / stats.monthly_revenue_pence) * 100).toFixed(1)}% margin`
                          : '-'}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

              {/* Sales Trend Chart */}
              {stats.sales_trend && stats.sales_trend.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm">Sales Trend (14 Days)</Text>
                    <Divider />
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: 120, gap: 4 }}>
                      {stats.sales_trend.map((day, idx) => {
                        const maxRevenue = Math.max(...stats.sales_trend.map(d => d.revenue_pence), 1);
                        const height = (day.revenue_pence / maxRevenue) * 100;
                        const date = new Date(day.date);
                        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                        return (
                          <div
                            key={idx}
                            style={{
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title={`${day.date}: ${formatPrice(day.revenue_pence)} (${day.orders} orders)`}
                          >
                            <div
                              style={{
                                width: '100%',
                                height: `${Math.max(height, 2)}%`,
                                backgroundColor: isWeekend ? '#9CA3AF' : '#2563EB',
                                borderRadius: 2,
                                minHeight: day.orders > 0 ? 4 : 2,
                              }}
                            />
                            <Text variant="bodySm" tone="subdued" alignment="center">
                              {date.getDate()}
                            </Text>
                          </div>
                        );
                      })}
                    </div>
                    <InlineStack gap="400">
                      <InlineStack gap="100" blockAlign="center">
                        <div style={{ width: 12, height: 12, backgroundColor: '#2563EB', borderRadius: 2 }} />
                        <Text variant="bodySm" tone="subdued">Weekday</Text>
                      </InlineStack>
                      <InlineStack gap="100" blockAlign="center">
                        <div style={{ width: 12, height: 12, backgroundColor: '#9CA3AF', borderRadius: 2 }} />
                        <Text variant="bodySm" tone="subdued">Weekend</Text>
                      </InlineStack>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              <Layout>
                <Layout.Section variant="oneHalf">
                  {/* Top Products */}
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Top Products This Month</Text>
                      <Divider />
                      {stats.top_products && stats.top_products.length > 0 ? (
                        <BlockStack gap="200">
                          {stats.top_products.map((product, idx) => (
                            <InlineStack key={idx} gap="300" align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
                                  #{idx + 1}
                                </Text>
                                <BlockStack gap="100">
                                  <Text variant="bodySm" fontFamily="monospace">
                                    {product.asin}
                                  </Text>
                                  <Text variant="bodySm" tone="subdued" truncate>
                                    {product.title?.substring(0, 40) || '-'}
                                    {product.title?.length > 40 ? '...' : ''}
                                  </Text>
                                </BlockStack>
                              </InlineStack>
                              <Badge>{product.quantity} units</Badge>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      ) : (
                        <Text variant="bodySm" tone="subdued">No sales data this month</Text>
                      )}
                    </BlockStack>
                  </Card>
                </Layout.Section>

                <Layout.Section variant="oneHalf">
                  {/* Orders by Status */}
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Orders by Status</Text>
                      <Divider />
                      <BlockStack gap="200">
                        {Object.entries(stats.orders_by_status || {}).map(([status, count]) => (
                          <InlineStack key={status} gap="200" align="space-between" blockAlign="center">
                            <InvictaBadge status={status} />
                            <Text variant="bodyMd" fontWeight="semibold">{count}</Text>
                          </InlineStack>
                        ))}
                        {Object.keys(stats.orders_by_status || {}).length === 0 && (
                          <Text variant="bodySm" tone="subdued">No orders yet</Text>
                        )}
                      </BlockStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

              {/* Pending Shipments Alert */}
              {stats.pending_shipments > 0 && (
                <Banner
                  title={`${stats.pending_shipments} orders need shipping confirmation`}
                  tone="warning"
                  action={{ content: 'View', onAction: () => setSelectedTab(1) }}
                >
                  <p>Orders that have been picked need tracking numbers sent to Amazon.</p>
                </Banner>
              )}
            </BlockStack>
          )}

          {/* Pending Shipments Tab */}
          {selectedTab === 1 && (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingSm">Orders Awaiting Shipment Confirmation</Text>
                  <InlineStack gap="200">
                    {selectedOrders.size > 0 && (
                      <InvictaButton
                        size="slim"
                        variant="primary"
                        onClick={openBulkModal}
                      >
                        Confirm {selectedOrders.size} Selected
                      </InvictaButton>
                    )}
                    {shippingStatus?.connected && (
                      <InvictaButton
                        size="slim"
                        onClick={handleSyncTracking}
                        loading={syncing && syncType === 'tracking'}
                      >
                        Auto-Sync from Royal Mail
                      </InvictaButton>
                    )}
                  </InlineStack>
                </InlineStack>
                <Divider />
                {pendingShipments.length === 0 ? (
                  <Text tone="subdued">No orders pending shipment confirmation.</Text>
                ) : (
                  <>
                    <InlineStack gap="200" blockAlign="center">
                      <Checkbox
                        label={`Select all (${pendingShipments.length})`}
                        checked={selectedOrders.size === pendingShipments.length && pendingShipments.length > 0}
                        onChange={toggleSelectAll}
                      />
                      {selectedOrders.size > 0 && (
                        <Text variant="bodySm" tone="subdued">
                          {selectedOrders.size} selected
                        </Text>
                      )}
                    </InlineStack>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'text']}
                      headings={['', 'Order ID', 'Customer', 'Items', 'Total', 'Action']}
                      rows={pendingShipments.map(order => [
                        <Checkbox
                          key={`chk-${order.id}`}
                          label=""
                          labelHidden
                          checked={selectedOrders.has(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                        />,
                        <button
                          key={order.id}
                          onClick={() => navigate(`/orders?id=${order.id}`)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}
                        >
                          {order.external_order_id || order.amazon_order_id}
                        </button>,
                        order.customer_name || '-',
                        order.order_lines?.length || 0,
                        formatPrice(order.total_price_pence),
                        <InvictaButton
                          key={`btn-${order.id}`}
                          size="slim"
                          variant="primary"
                          onClick={() => openShipmentModal(order)}
                        >
                          Add Tracking
                        </InvictaButton>,
                      ])}
                    />
                  </>
                )}
              </BlockStack>
            </Card>
          )}

          {/* Sync & Settings Tab */}
          {selectedTab === 2 && (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Manual Sync Actions</Text>
                  <Divider />
                  <InlineStack gap="300">
                    <InvictaButton
                      onClick={handleSyncOrders}
                      loading={syncing && syncType === 'orders'}
                      disabled={!amazonStatus?.connected}
                    >
                      Sync Orders (7 days)
                    </InvictaButton>
                    <InvictaButton
                      variant="secondary"
                      onClick={handleSyncFees}
                      loading={syncing && syncType === 'fees'}
                      disabled={!amazonStatus?.connected}
                    >
                      Sync Fees (30 days)
                    </InvictaButton>
                    <InvictaButton
                      variant="secondary"
                      onClick={handleSyncTracking}
                      loading={syncing && syncType === 'tracking'}
                      disabled={!shippingStatus?.connected}
                    >
                      Sync Tracking
                    </InvictaButton>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingSm">Auto-Sync Scheduler</Text>
                    {schedulerStatus && (
                      <Badge tone={schedulerStatus.enabled ? 'success' : 'attention'}>
                        {schedulerStatus.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    )}
                  </InlineStack>
                  <Divider />

                  {!schedulerStatus?.enabled && (
                    <Banner tone="info">
                      <p>Auto-sync is disabled. Set <code>ENABLE_AUTO_SYNC=true</code> in environment variables to enable.</p>
                    </Banner>
                  )}

                  <FormLayout>
                    <FormLayout.Group>
                      <Checkbox
                        label="Enable Order Sync"
                        checked={schedulerSettings.orderSyncEnabled}
                        onChange={(checked) => setSchedulerSettings(prev => ({ ...prev, orderSyncEnabled: checked }))}
                        helpText="Automatically sync orders from Amazon"
                      />
                      <TextField
                        label="Interval (minutes)"
                        type="number"
                        value={String(schedulerSettings.orderSyncInterval)}
                        onChange={(value) => setSchedulerSettings(prev => ({ ...prev, orderSyncInterval: parseInt(value) || 30 }))}
                        disabled={!schedulerSettings.orderSyncEnabled}
                        min={5}
                        max={1440}
                      />
                    </FormLayout.Group>

                    <FormLayout.Group>
                      <Checkbox
                        label="Enable Tracking Sync"
                        checked={schedulerSettings.trackingSyncEnabled}
                        onChange={(checked) => setSchedulerSettings(prev => ({ ...prev, trackingSyncEnabled: checked }))}
                        helpText="Sync tracking from Royal Mail and confirm on Amazon"
                      />
                      <TextField
                        label="Interval (minutes)"
                        type="number"
                        value={String(schedulerSettings.trackingSyncInterval)}
                        onChange={(value) => setSchedulerSettings(prev => ({ ...prev, trackingSyncInterval: parseInt(value) || 60 }))}
                        disabled={!schedulerSettings.trackingSyncEnabled}
                        min={15}
                        max={1440}
                      />
                    </FormLayout.Group>

                    <FormLayout.Group>
                      <Checkbox
                        label="Enable Catalog Sync"
                        checked={schedulerSettings.catalogSyncEnabled}
                        onChange={(checked) => setSchedulerSettings(prev => ({ ...prev, catalogSyncEnabled: checked }))}
                        helpText="Refresh product catalog data periodically"
                      />
                      <TextField
                        label="Interval (minutes)"
                        type="number"
                        value={String(schedulerSettings.catalogSyncInterval)}
                        onChange={(value) => setSchedulerSettings(prev => ({ ...prev, catalogSyncInterval: parseInt(value) || 360 }))}
                        disabled={!schedulerSettings.catalogSyncEnabled}
                        min={60}
                        max={1440}
                      />
                    </FormLayout.Group>
                  </FormLayout>

                  <InvictaButton
                    onClick={handleSaveSchedulerSettings}
                    loading={savingScheduler}
                  >
                    Save Scheduler Settings
                  </InvictaButton>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Environment Variables Required</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <Text variant="bodySm">
                      <strong>SP_API_CLIENT_ID</strong> - Amazon LWA Client ID
                    </Text>
                    <Text variant="bodySm">
                      <strong>SP_API_CLIENT_SECRET</strong> - Amazon LWA Client Secret
                    </Text>
                    <Text variant="bodySm">
                      <strong>SP_API_REFRESH_TOKEN</strong> - Amazon OAuth Refresh Token
                    </Text>
                    <Text variant="bodySm">
                      <strong>SP_API_APPLICATION_ID</strong> - Amazon Application ID
                    </Text>
                    <Text variant="bodySm">
                      <strong>ROYAL_MAIL_API_KEY</strong> - Click & Drop API Key
                    </Text>
                    <Text variant="bodySm">
                      <strong>ENABLE_AUTO_SYNC</strong> - Set to "true" to enable auto-sync
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          {/* Listings Tab */}
          {selectedTab === 3 && (
            <BlockStack gap="400">
              {catalogSyncResult && (
                <Banner
                  tone={catalogSyncResult.errors?.length > 0 ? 'warning' : 'success'}
                  title="Catalog Sync Complete"
                  onDismiss={() => setCatalogSyncResult(null)}
                >
                  <p>
                    {catalogSyncResult.synced} synced, {catalogSyncResult.skipped} already up-to-date
                    {catalogSyncResult.errors?.length > 0 && ` (${catalogSyncResult.errors.length} errors)`}
                  </p>
                </Banner>
              )}

              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text variant="headingSm">Amazon Listings</Text>
                    <InlineStack gap="200">
                      <InvictaButton
                        size="slim"
                        onClick={handleSyncCatalog}
                        loading={catalogSyncing}
                        disabled={!amazonStatus?.connected}
                      >
                        Sync Catalog
                      </InvictaButton>
                    </InlineStack>
                  </InlineStack>
                  <Divider />

                  <InlineStack gap="300">
                    <div style={{ flexGrow: 1, maxWidth: '300px' }}>
                      <TextField
                        placeholder="Search by ASIN, title, or brand..."
                        value={listingsSearch}
                        onChange={setListingsSearch}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => setListingsSearch('')}
                      />
                    </div>
                    <Select
                      label=""
                      labelHidden
                      options={[
                        { label: 'All Listings', value: 'all' },
                        { label: 'Mapped to BOM', value: 'mapped' },
                        { label: 'Unmapped', value: 'unmapped' },
                      ]}
                      value={listingsFilter}
                      onChange={setListingsFilter}
                    />
                  </InlineStack>

                  {listingsLoading ? (
                    <InvictaLoading message="Loading listings..." />
                  ) : listings.length === 0 ? (
                    <BlockStack gap="200">
                      <Text tone="subdued">No listings found. Sync your catalog to get started.</Text>
                    </BlockStack>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                      headings={['Image', 'ASIN', 'Title', 'Market Data', 'BOM Mapping', 'Action']}
                      rows={listings.map(listing => [
                        listing.main_image_url ? (
                          <img
                            key={`img-${listing.asin}`}
                            src={listing.main_image_url}
                            alt={listing.title}
                            style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4 }}
                          />
                        ) : (
                          <div
                            key={`placeholder-${listing.asin}`}
                            style={{
                              width: 40,
                              height: 40,
                              backgroundColor: '#f4f4f4',
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text variant="bodySm" tone="subdued">-</Text>
                          </div>
                        ),
                        <Text key={`asin-${listing.asin}`} variant="bodyMd" fontWeight="semibold">
                          {listing.asin}
                        </Text>,
                        <div key={`title-${listing.asin}`} style={{ maxWidth: 250 }}>
                          <Text variant="bodySm" truncate>
                            {listing.title || '-'}
                          </Text>
                          {listing.brand && (
                            <Text variant="bodySm" tone="subdued">{listing.brand}</Text>
                          )}
                        </div>,
                        <KeepaMetricsCompact
                          key={`keepa-${listing.asin}`}
                          asin={listing.asin}
                          showPrice
                          showRank
                          showRating
                        />,
                        listing.is_mapped ? (
                          <Badge key={`mapped-${listing.asin}`} tone="success">
                            {listing.bom_name}
                          </Badge>
                        ) : (
                          <Badge key={`unmapped-${listing.asin}`} tone="attention">
                            Unmapped
                          </Badge>
                        ),
                        <InvictaButton
                          key={`action-${listing.asin}`}
                          size="slim"
                          variant={listing.is_mapped ? 'secondary' : 'primary'}
                          onClick={() => openMappingModal(listing)}
                        >
                          {listing.is_mapped ? 'Change' : 'Map to BOM'}
                        </InvictaButton>,
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          {/* Inventory Allocation Tab */}
          {selectedTab === 4 && (
            <BlockStack gap="400">
              <Banner tone="info">
                <p>
                  Inventory allocation prevents overselling when multiple BOMs share the same component (e.g., tool cores).
                  Recommended quantities are calculated to ensure the total across all BOMs does not exceed available stock.
                </p>
              </Banner>

              {inventoryLoading ? (
                <InvictaLoading message="Calculating inventory recommendations..." />
              ) : inventoryRecommendations ? (
                <>
                  {/* Summary Stats */}
                  <Layout>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Total BOMs</Text>
                          <Text variant="heading2xl" fontWeight="bold">
                            {inventoryRecommendations.total || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Pooled BOMs</Text>
                          <Text variant="heading2xl" fontWeight="bold" tone="warning">
                            {inventoryRecommendations.pooled || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Non-Pooled BOMs</Text>
                          <Text variant="heading2xl" fontWeight="bold" tone="success">
                            {inventoryRecommendations.non_pooled || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Active Pools</Text>
                          <Text variant="heading2xl" fontWeight="bold">
                            {inventoryRecommendations.pools?.length || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                  </Layout>

                  {/* Pool Summaries */}
                  {inventoryRecommendations.pools && inventoryRecommendations.pools.length > 0 && (
                    <Card>
                      <BlockStack gap="400">
                        <Text variant="headingSm">Inventory Pools</Text>
                        <Divider />
                        <BlockStack gap="300">
                          {inventoryRecommendations.pools.map(pool => (
                            <Card key={pool.pool_id} background="bg-surface-secondary">
                              <BlockStack gap="200">
                                <InlineStack align="space-between">
                                  <BlockStack gap="100">
                                    <Text variant="headingSm">{pool.pool_name}</Text>
                                    <Text variant="bodySm" tone="subdued">
                                      Shared component: {pool.pool_component_sku}
                                    </Text>
                                  </BlockStack>
                                  <InlineStack gap="200">
                                    <Badge tone="info">{pool.pool_available} available</Badge>
                                    <Badge>{pool.member_count} BOMs</Badge>
                                  </InlineStack>
                                </InlineStack>
                                <ProgressBar
                                  progress={pool.pool_available > 0 ? Math.min(100, (pool.total_allocated / pool.pool_available) * 100) : 0}
                                  size="small"
                                  tone={pool.total_allocated > pool.pool_available ? 'critical' : 'highlight'}
                                />
                                <Text variant="bodySm" tone="subdued">
                                  {pool.total_allocated || 0} of {pool.pool_available} units allocated across pool members
                                </Text>
                              </BlockStack>
                            </Card>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  )}

                  {/* Push to Amazon Card */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <BlockStack gap="100">
                          <Text variant="headingSm">Push to Amazon</Text>
                          <Text variant="bodySm" tone="subdued">
                            Update FBM listing quantities on Amazon to match recommended allocations
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <InvictaButton
                            size="slim"
                            variant="secondary"
                            onClick={() => {
                              setPushDryRun(true);
                              setPushResult(null);
                              setPushModalOpen(true);
                            }}
                            disabled={!amazonStatus?.connected}
                          >
                            Preview Changes
                          </InvictaButton>
                          <InvictaButton
                            size="slim"
                            variant="primary"
                            onClick={() => {
                              setPushDryRun(false);
                              setPushResult(null);
                              setPushModalOpen(true);
                            }}
                            disabled={!amazonStatus?.connected}
                          >
                            Push Live
                          </InvictaButton>
                        </InlineStack>
                      </InlineStack>
                      {!amazonStatus?.connected && (
                        <Text variant="bodySm" tone="critical">
                          SP-API not connected. Configure credentials to enable inventory push.
                        </Text>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Recommendations Table */}
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text variant="headingSm">Recommended Quantities per BOM</Text>
                        <InvictaButton
                          size="slim"
                          variant="secondary"
                          onClick={loadInventoryRecommendations}
                          loading={inventoryLoading}
                        >
                          Refresh
                        </InvictaButton>
                      </InlineStack>
                      <Divider />
                      {inventoryRecommendations.recommendations && inventoryRecommendations.recommendations.length > 0 ? (
                        <DataTable
                          columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text', 'text']}
                          headings={['Bundle SKU', 'Description', 'Buildable', 'Recommended', 'Constraint', 'Pool']}
                          rows={inventoryRecommendations.recommendations.map(rec => [
                            <Text key={`sku-${rec.bom_id}`} variant="bodyMd" fontWeight="semibold">
                              {rec.bundle_sku}
                            </Text>,
                            <Text key={`desc-${rec.bom_id}`} variant="bodySm" truncate>
                              {rec.bom_description || '-'}
                            </Text>,
                            rec.buildable,
                            <Text
                              key={`qty-${rec.bom_id}`}
                              variant="bodyMd"
                              fontWeight="bold"
                              tone={rec.recommended_qty < rec.buildable ? 'caution' : 'success'}
                            >
                              {rec.recommended_qty}
                            </Text>,
                            rec.constraint_internal_sku ? (
                              <Badge key={`constraint-${rec.bom_id}`} tone="attention">
                                {rec.constraint_internal_sku}
                              </Badge>
                            ) : '-',
                            rec.pool_name ? (
                              <Badge key={`pool-${rec.bom_id}`} tone="info">
                                {rec.pool_name}
                              </Badge>
                            ) : (
                              <Text key={`nopool-${rec.bom_id}`} variant="bodySm" tone="subdued">-</Text>
                            ),
                          ])}
                        />
                      ) : (
                        <Text tone="subdued">No BOMs found. Create BOMs to see inventory recommendations.</Text>
                      )}
                    </BlockStack>
                  </Card>
                </>
              ) : (
                <Card>
                  <Text tone="subdued">Unable to load inventory recommendations.</Text>
                </Card>
              )}
            </BlockStack>
          )}
        </Tabs>

        {/* Shipment Confirmation Modal */}
        <Modal
          open={shipmentModal.open}
          onClose={() => setShipmentModal({ open: false, order: null })}
          title="Confirm Shipment"
          primaryAction={{
            content: confirming ? 'Confirming...' : 'Confirm & Send to Amazon',
            onAction: handleConfirmShipment,
            loading: confirming,
            disabled: !trackingNumber,
          }}
          secondaryActions={[
            { content: 'Cancel', onAction: () => setShipmentModal({ open: false, order: null }) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {shipmentModal.order && (
                <BlockStack gap="200">
                  <Text variant="bodyMd">
                    <strong>Order:</strong> {shipmentModal.order.external_order_id || shipmentModal.order.amazon_order_id}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Customer: {shipmentModal.order.customer_name}
                  </Text>
                </BlockStack>
              )}
              <TextField
                label="Tracking Number"
                value={trackingNumber}
                onChange={setTrackingNumber}
                placeholder="e.g., AB123456789GB"
                autoComplete="off"
              />
              <Text variant="bodySm" tone="subdued">
                Carrier: Royal Mail (default)
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Bulk Shipment Confirmation Modal */}
        <Modal
          open={bulkModal}
          onClose={() => !bulkConfirming && setBulkModal(false)}
          title={`Confirm ${selectedOrders.size} Shipments`}
          primaryAction={{
            content: bulkConfirming ? 'Confirming...' : 'Confirm All & Send to Amazon',
            onAction: handleBulkConfirm,
            loading: bulkConfirming,
            disabled: Object.values(bulkTrackingNumbers).every(t => !t.trim()),
          }}
          secondaryActions={[
            { content: 'Cancel', onAction: () => setBulkModal(false), disabled: bulkConfirming },
          ]}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              {bulkResult && (
                <Banner
                  tone={bulkResult.errors?.length > 0 ? 'warning' : 'success'}
                  title={`${bulkResult.confirmed} of ${bulkResult.total} confirmed`}
                >
                  <p>
                    {bulkResult.amazonConfirmed} confirmed on Amazon
                    {bulkResult.errors?.length > 0 && ` (${bulkResult.errors.length} errors)`}
                  </p>
                </Banner>
              )}

              <Text variant="bodySm" tone="subdued">
                Enter tracking numbers for each order. Orders without tracking numbers will be skipped.
              </Text>

              <FormLayout>
                {getSelectedOrderDetails().map(order => (
                  <TextField
                    key={order.id}
                    label={
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">
                          {order.external_order_id || order.amazon_order_id}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          ({order.customer_name})
                        </Text>
                      </InlineStack>
                    }
                    value={bulkTrackingNumbers[order.id] || ''}
                    onChange={(value) => setBulkTrackingNumbers(prev => ({
                      ...prev,
                      [order.id]: value,
                    }))}
                    placeholder="e.g., AB123456789GB"
                    autoComplete="off"
                  />
                ))}
              </FormLayout>

              <Text variant="bodySm" tone="subdued">
                Carrier: Royal Mail (for all shipments)
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* BOM Mapping Modal */}
        <Modal
          open={mappingModal.open}
          onClose={() => !mapping && setMappingModal({ open: false, listing: null })}
          title="Map Listing to BOM"
          primaryAction={{
            content: mapping ? 'Mapping...' : 'Save Mapping',
            onAction: handleMapListing,
            loading: mapping,
            disabled: !selectedBomId,
          }}
          secondaryActions={[
            { content: 'Cancel', onAction: () => setMappingModal({ open: false, listing: null }), disabled: mapping },
          ]}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              {mappingModal.listing && (
                <>
                  <Card>
                    <InlineStack gap="400" blockAlign="start">
                      {mappingModal.listing.main_image_url ? (
                        <img
                          src={mappingModal.listing.main_image_url}
                          alt={mappingModal.listing.title}
                          style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 4 }}
                        />
                      ) : (
                        <div style={{
                          width: 80,
                          height: 80,
                          backgroundColor: '#f4f4f4',
                          borderRadius: 4,
                        }} />
                      )}
                      <BlockStack gap="100">
                        <Text variant="headingSm" fontWeight="semibold">
                          {mappingModal.listing.asin}
                        </Text>
                        <Text variant="bodySm">
                          {mappingModal.listing.title}
                        </Text>
                        {mappingModal.listing.brand && (
                          <Text variant="bodySm" tone="subdued">
                            Brand: {mappingModal.listing.brand}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>
                  </Card>

                  {/* Keepa Market Data */}
                  <KeepaMetrics asin={mappingModal.listing.asin} compact showCharts={false} />
                </>
              )}

              <Select
                label="Select BOM"
                placeholder="Choose a BOM..."
                options={availableBoms.map(bom => ({
                  // NOTE: Schema uses bundle_sku/description, not name/sku
                  label: `${bom.bundle_sku}${bom.description ? ` - ${bom.description}` : ''}`,
                  value: bom.id,
                }))}
                value={selectedBomId}
                onChange={setSelectedBomId}
              />

              <Text variant="bodySm" tone="subdued">
                This mapping will be remembered for future orders with this ASIN.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Push Inventory Modal */}
        <Modal
          open={pushModalOpen}
          onClose={() => !pushing && setPushModalOpen(false)}
          title={pushDryRun ? 'Preview Inventory Push' : 'Push Inventory to Amazon'}
          primaryAction={{
            content: pushing ? 'Processing...' : (pushDryRun ? 'Run Preview' : 'Push to Amazon'),
            onAction: handlePushInventory,
            loading: pushing,
            tone: pushDryRun ? undefined : 'critical',
          }}
          secondaryActions={[
            { content: 'Close', onAction: () => setPushModalOpen(false), disabled: pushing },
          ]}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              {pushDryRun ? (
                <Banner tone="info">
                  <p>
                    This will show what changes would be made to Amazon without actually updating anything.
                  </p>
                </Banner>
              ) : (
                <Banner tone="warning">
                  <p>
                    This will update listing quantities on Amazon. Make sure you have reviewed the recommendations first.
                  </p>
                </Banner>
              )}

              {pushResult && (
                <>
                  {pushResult.dry_run ? (
                    <Banner
                      tone="info"
                      title={`Preview: ${pushResult.planned_updates} listings would be updated`}
                    >
                      <p>
                        {pushResult.total_eligible} eligible listings found
                        {pushResult.truncated && ` (limited to ${pushResult.max_limit})`}
                        {pushResult.skipped_count > 0 && `, ${pushResult.skipped_count} skipped`}
                      </p>
                    </Banner>
                  ) : (
                    <Banner
                      tone={pushResult.failed > 0 ? 'warning' : 'success'}
                      title={`${pushResult.success} of ${pushResult.total} listings updated`}
                    >
                      {pushResult.failed > 0 && (
                        <p>{pushResult.failed} failed</p>
                      )}
                    </Banner>
                  )}

                  {pushResult.updates && pushResult.updates.length > 0 && (
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingSm">
                          {pushResult.dry_run ? 'Planned Updates' : 'Completed Updates'}
                        </Text>
                        <Divider />
                        <DataTable
                          columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
                          headings={['SKU', 'ASIN', 'Bundle', 'New Qty', 'Pool']}
                          rows={pushResult.updates.slice(0, 20).map(u => [
                            u.sku,
                            u.asin || '-',
                            u.bundle_sku || '-',
                            u.new_qty,
                            u.pool_name || '-',
                          ])}
                        />
                        {pushResult.updates.length > 20 && (
                          <Text variant="bodySm" tone="subdued">
                            ...and {pushResult.updates.length - 20} more
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  )}

                  {pushResult.errors && pushResult.errors.length > 0 && (
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="headingSm" tone="critical">Errors</Text>
                        <Divider />
                        {pushResult.errors.slice(0, 10).map((err, i) => (
                          <InlineStack key={i} gap="200">
                            <Badge tone="critical">{err.sku}</Badge>
                            <Text variant="bodySm">{err.error}</Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </Card>
                  )}
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
