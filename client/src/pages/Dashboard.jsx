import React, { useEffect, useState, useCallback } from 'react';
import { Page, Layout, Banner, Text, BlockStack, InlineStack, InlineGrid } from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  InvictaSectionHeader,
  InvictaPanel,
  InvictaStatPanel,
  InvictaPanelGrid,
  InvictaBadge,
  InvictaButton,
  InvictaButtonGroup,
  InvictaLoading,
  InvictaActivityFeed,
} from '../components/ui/index.jsx';
import * as api from '../utils/api.jsx';

/**
 * Dashboard - Ops Command Center
 *
 * The homepage serves as the operational command center, showing:
 * - Orders needing review (urgent action items)
 * - Ready to pick orders (today's work)
 * - Stock bottlenecks (potential blockers)
 * - Recent activity timeline
 * - Quick stats for at-a-glance status
 */
export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [importing, setImporting] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const dashboardData = await api.getDashboard();
      setData(dashboardData);
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError(typeof err === 'string' ? err : err.message || JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleImportOrders = async () => {
    try {
      setImporting(true);
      const result = await api.importOrders();
      await loadDashboard();
      // Show result
      alert(`Imported ${result.imported} orders, updated ${result.updated}, skipped ${result.skipped}`);
    } catch (err) {
      console.error('Import error:', err);
      alert('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <Page title="Dashboard">
        <InvictaLoading message="Loading ops command center..." />
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Dashboard">
        <Banner tone="critical">
          <p>Failed to load dashboard: {error}</p>
        </Banner>
      </Page>
    );
  }

  const stats = data?.stats || {};
  const needsReview = data?.needs_review || [];
  const readyToPick = data?.ready_to_pick || [];
  const bottlenecks = data?.bottlenecks || [];
  const recentActivity = data?.recent_activity || [];

  return (
    <Page
      title="Ops Command Center"
      subtitle={`Welcome back, ${user?.name || user?.email}`}
      primaryAction={{
        content: 'Import from Shopify',
        onAction: handleImportOrders,
        loading: importing,
      }}
      secondaryActions={[
        { content: 'Refresh', onAction: loadDashboard },
      ]}
    >
      <BlockStack gap="600">
        {/* Urgent Actions Banner */}
        {needsReview.length > 0 && (
          <Banner
            title={`${needsReview.length} order(s) need review`}
            tone="warning"
            action={{ content: 'Review Now', onAction: () => navigate('/review') }}
          >
            <p>Orders are waiting for listing resolution before they can be picked.</p>
          </Banner>
        )}

        {/* Quick Stats */}
        <InvictaSectionHeader title="Today's Overview" count={null}>
          <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
            <InvictaStatPanel
              label="Ready to Pick"
              value={stats.orders_ready_to_pick || 0}
              variant={stats.orders_ready_to_pick > 0 ? 'highlight' : 'default'}
            />
            <InvictaStatPanel
              label="Needs Review"
              value={stats.orders_needs_review || 0}
              variant={stats.orders_needs_review > 0 ? 'warning' : 'default'}
            />
            <InvictaStatPanel
              label="Active Batches"
              value={stats.batches_in_progress || 0}
            />
            <InvictaStatPanel
              label="Pending Returns"
              value={stats.returns_pending || 0}
              variant={stats.returns_pending > 0 ? 'warning' : 'default'}
            />
            <InvictaStatPanel
              label="Low Stock Items"
              value={stats.components_low_stock || 0}
              variant={stats.components_low_stock > 0 ? 'error' : 'default'}
            />
          </InlineGrid>
        </InvictaSectionHeader>

        <Layout>
          {/* Main Content Area */}
          <Layout.Section>
            <BlockStack gap="400">
              {/* Ready to Pick Orders */}
              <InvictaSectionHeader
                title="Ready to Pick"
                count={readyToPick.length}
                collapsible
                action={
                  readyToPick.length > 0 && isAdmin && (
                    <InvictaButton
                      variant="primary"
                      size="slim"
                      onClick={() => navigate('/picklists')}
                    >
                      Create Batch
                    </InvictaButton>
                  )
                }
              >
                {readyToPick.length === 0 ? (
                  <Text tone="subdued">No orders ready to pick. Import orders from Shopify or resolve pending reviews.</Text>
                ) : (
                  <BlockStack gap="200">
                    {readyToPick.slice(0, 10).map(order => (
                      <OrderRow key={order.id} order={order} onClick={() => navigate(`/orders?id=${order.id}`)} />
                    ))}
                    {readyToPick.length > 10 && (
                      <InvictaButton variant="secondary" onClick={() => navigate('/orders?status=READY_TO_PICK')}>
                        View all {readyToPick.length} orders
                      </InvictaButton>
                    )}
                  </BlockStack>
                )}
              </InvictaSectionHeader>

              {/* Stock Bottlenecks */}
              {bottlenecks.length > 0 && (
                <InvictaSectionHeader
                  title="Stock Bottlenecks"
                  count={bottlenecks.length}
                  collapsible
                  action={
                    <InvictaButton variant="secondary" size="slim" onClick={() => navigate('/components')}>
                      View Inventory
                    </InvictaButton>
                  }
                >
                  <BlockStack gap="200">
                    {bottlenecks.slice(0, 5).map(item => (
                      <BottleneckRow key={item.component_id} item={item} />
                    ))}
                  </BlockStack>
                </InvictaSectionHeader>
              )}

              {/* Needs Review */}
              {needsReview.length > 0 && (
                <InvictaSectionHeader
                  title="Needs Review"
                  count={needsReview.length}
                  collapsible
                  defaultCollapsed={false}
                  action={
                    <InvictaButton variant="primary" size="slim" onClick={() => navigate('/review')}>
                      Start Review
                    </InvictaButton>
                  }
                >
                  <BlockStack gap="200">
                    {needsReview.slice(0, 5).map(item => (
                      <ReviewRow key={item.id} item={item} />
                    ))}
                    {needsReview.length > 5 && (
                      <Text tone="subdued">+{needsReview.length - 5} more items in review queue</Text>
                    )}
                  </BlockStack>
                </InvictaSectionHeader>
              )}
            </BlockStack>
          </Layout.Section>

          {/* Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Quick Actions */}
              <InvictaPanel title="Quick Actions">
                <BlockStack gap="200">
                  <InvictaButton fullWidth onClick={() => navigate('/orders')}>
                    View All Orders
                  </InvictaButton>
                  <InvictaButton fullWidth variant="secondary" onClick={() => navigate('/components')}>
                    Manage Inventory
                  </InvictaButton>
                  <InvictaButton fullWidth variant="secondary" onClick={() => navigate('/bundles')}>
                    View BOMs
                  </InvictaButton>
                  {isAdmin && (
                    <InvictaButton fullWidth variant="secondary" onClick={() => navigate('/returns')}>
                      Process Returns
                    </InvictaButton>
                  )}
                </BlockStack>
              </InvictaPanel>

              {/* System Status */}
              <InvictaPanel title="System Status">
                <BlockStack gap="200">
                  <StatusRow label="Active Listings" value={stats.listings_active || 0} />
                  <StatusRow label="Active BOMs" value={stats.boms_active || 0} />
                  <StatusRow label="Total Components" value={stats.components_total || 0} />
                  <StatusRow label="Orders Today" value={stats.orders_today || 0} />
                </BlockStack>
              </InvictaPanel>

              {/* Recent Activity */}
              <InvictaActivityFeed
                events={recentActivity}
                limit={5}
                title="Recent Activity"
              />
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

/**
 * OrderRow - Single order row for list display
 */
function OrderRow({ order, onClick }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        backgroundColor: '#FAFAFA',
        borderRadius: '4px',
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="semibold">
          {order.external_order_id}
        </Text>
        <Text variant="bodySm" tone="subdued">
          {order.customer_name || order.customer_email || 'Unknown customer'}
        </Text>
      </BlockStack>
      <InlineStack gap="200" blockAlign="center">
        <Text variant="bodySm" tone="subdued">
          {order.order_lines?.length || 0} items
        </Text>
        <InvictaBadge status={order.status} size="small" />
      </InlineStack>
    </div>
  );
}

/**
 * BottleneckRow - Stock bottleneck item
 */
function BottleneckRow({ item }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        backgroundColor: item.available <= 0 ? '#FFF5F5' : '#FFFBEB',
        borderRadius: '4px',
      }}
    >
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="semibold">
          {item.internal_sku}
        </Text>
        <Text variant="bodySm" tone="subdued">
          {item.description}
        </Text>
      </BlockStack>
      <InlineStack gap="200" blockAlign="center">
        <BlockStack gap="100">
          <Text variant="bodySm" alignment="end">
            {item.available} available
          </Text>
          <Text variant="bodySm" tone="subdued" alignment="end">
            Blocks {item.blocked_orders || 0} orders
          </Text>
        </BlockStack>
        <InvictaBadge status={item.available <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK'} size="small" />
      </InlineStack>
    </div>
  );
}

/**
 * ReviewRow - Review queue item
 */
function ReviewRow({ item }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        backgroundColor: '#FFFBEB',
        borderRadius: '4px',
      }}
    >
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="semibold">
          {item.title?.substring(0, 50) || item.asin || item.sku || 'Unknown'}
          {item.title?.length > 50 && '...'}
        </Text>
        <InlineStack gap="100">
          {item.asin && <Text variant="bodySm" tone="subdued">ASIN: {item.asin}</Text>}
          {item.sku && <Text variant="bodySm" tone="subdued">SKU: {item.sku}</Text>}
        </InlineStack>
      </BlockStack>
      <InvictaBadge status={item.reason || 'PENDING'} size="small" />
    </div>
  );
}

/**
 * StatusRow - Simple key-value status display
 */
function StatusRow({ label, value }) {
  return (
    <InlineStack align="space-between">
      <Text variant="bodyMd">{label}</Text>
      <Text variant="bodyMd" fontWeight="semibold">{value}</Text>
    </InlineStack>
  );
}
