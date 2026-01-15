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
} from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import {
  InvictaLoading,
  InvictaButton,
  InvictaBadge,
} from '../components/ui/index.jsx';
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

  // Shipment confirmation modal
  const [shipmentModal, setShipmentModal] = useState({ open: false, order: null });
  const [trackingNumber, setTrackingNumber] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Tabs
  const [selectedTab, setSelectedTab] = useState(0);

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
  ];

  return (
    <Page
      title="Amazon Integration"
      subtitle="Manage Amazon orders, shipping, and fees"
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
          <Layout.Section variant="oneHalf">
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
          <Layout.Section variant="oneHalf">
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
        </Layout>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
          {/* Overview Tab */}
          {selectedTab === 0 && stats && (
            <BlockStack gap="400">
              <Layout>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Total Amazon Orders</Text>
                      <Text variant="heading2xl" fontWeight="bold">
                        {stats.total_orders || 0}
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
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Monthly Fees</Text>
                      <Text variant="heading2xl" fontWeight="bold" tone="critical">
                        {formatPrice(stats.monthly_fees_pence)}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="bodySm" tone="subdued">Monthly Net</Text>
                      <Text variant="heading2xl" fontWeight="bold">
                        {formatPrice(stats.monthly_net_pence)}
                      </Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

              {/* Orders by Status */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Orders by Status</Text>
                  <Divider />
                  <InlineStack gap="400" wrap>
                    {Object.entries(stats.orders_by_status || {}).map(([status, count]) => (
                      <InlineStack key={status} gap="200" blockAlign="center">
                        <InvictaBadge status={status} />
                        <Text variant="bodyMd" fontWeight="semibold">{count}</Text>
                      </InlineStack>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>

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
                <Divider />
                {pendingShipments.length === 0 ? (
                  <Text tone="subdued">No orders pending shipment confirmation.</Text>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
                    headings={['Order ID', 'Customer', 'Items', 'Total', 'Action']}
                    rows={pendingShipments.map(order => [
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
                  </BlockStack>
                </BlockStack>
              </Card>
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
      </BlockStack>
    </Page>
  );
}
