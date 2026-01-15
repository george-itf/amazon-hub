import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Page,
  Layout,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  Card,
  Badge,
  Button,
  Divider,
  ProgressBar,
  Tabs,
} from '@shopify/polaris';
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
 * Mini sparkline bar chart
 */
function MiniChart({ data, valueKey, color = '#2c6ecb' }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d[valueKey] || 0));
  if (max === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px' }}>
      {data.slice(-7).map((d, i) => {
        const height = max > 0 ? (d[valueKey] / max) * 100 : 0;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: color,
              height: `${Math.max(height, 2)}%`,
              minWidth: '8px',
              borderRadius: '2px 2px 0 0',
              opacity: 0.7 + (i / data.length) * 0.3,
            }}
            title={`${d.date || d.period}: ${d[valueKey]}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Dashboard - Ops Command Center
 */
export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);

  // Amazon sync state
  const [amazonStatus, setAmazonStatus] = useState(null);
  const [syncingAmazon, setSyncingAmazon] = useState(false);
  const [amazonResult, setAmazonResult] = useState(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load dashboard, analytics, and Amazon status in parallel
      const [dashboardData, analytics, amzStatus] = await Promise.all([
        api.getDashboard(),
        api.getAnalyticsSummary({ start_date: getDateDaysAgo(7) }).catch(() => null),
        api.getAmazonStatus().catch(() => ({ connected: false, configured: false })),
      ]);

      setData(dashboardData);
      setAnalyticsData(analytics);
      setAmazonStatus(amzStatus);
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
      setImportResult(null);
      setImportError(null);
      const result = await api.importOrders();
      await loadDashboard();
      setImportResult(result);
    } catch (err) {
      console.error('Import error:', err);
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Import failed');
      setImportError(errorMsg);
    } finally {
      setImporting(false);
    }
  };

  const handleSyncAmazon = async () => {
    try {
      setSyncingAmazon(true);
      setAmazonResult(null);
      setImportError(null);
      const result = await api.syncAmazonOrders(7); // Last 7 days
      await loadDashboard();
      setAmazonResult(result);
    } catch (err) {
      console.error('Amazon sync error:', err);
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Amazon sync failed');
      setImportError(errorMsg);
    } finally {
      setSyncingAmazon(false);
    }
  };

  // Get date string for X days ago
  function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  // Format price
  function formatPrice(pence) {
    if (!pence && pence !== 0) return '-';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
  }

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
  const criticalBanner = data?.critical_banner;

  // Calculate fulfillment progress
  const totalOrders = stats.orders_total || 0;
  const dispatched = stats.orders_dispatched || 0;
  const fulfillmentProgress = totalOrders > 0 ? Math.round((dispatched / totalOrders) * 100) : 0;

  const tabs = [
    { id: 'overview', content: 'Overview' },
    { id: 'performance', content: 'Performance' },
  ];

  return (
    <Page
      title="Ops Command Center"
      subtitle={`Welcome back, ${user?.name || user?.email}`}
      primaryAction={amazonStatus?.connected ? {
        content: syncingAmazon ? 'Syncing Amazon...' : 'Sync Amazon Orders',
        onAction: handleSyncAmazon,
        loading: syncingAmazon,
      } : {
        content: 'Import from Shopify',
        onAction: handleImportOrders,
        loading: importing,
      }}
      secondaryActions={[
        ...(amazonStatus?.connected ? [{
          content: importing ? 'Importing...' : 'Import Shopify',
          onAction: handleImportOrders,
          disabled: importing,
        }] : []),
        { content: 'Refresh', onAction: loadDashboard },
      ]}
    >
      <BlockStack gap="600">
        {/* Import Result Banner */}
        {importResult && (
          <Banner
            title="Shopify Import Complete"
            tone="info"
            onDismiss={() => setImportResult(null)}
          >
            <p>
              Imported: {importResult.imported} | Updated: {importResult.updated} | Skipped: {importResult.skipped}
            </p>
          </Banner>
        )}

        {/* Amazon Sync Result Banner */}
        {amazonResult && (
          <Banner
            title="Amazon Sync Complete"
            tone="success"
            onDismiss={() => setAmazonResult(null)}
          >
            <p>
              {amazonResult.created} new orders imported
              {amazonResult.linked > 0 && `, ${amazonResult.linked} linked to Shopify`}
              , {amazonResult.updated} updated, {amazonResult.skipped} unchanged
              {amazonResult.errors?.length > 0 && ` (${amazonResult.errors.length} errors)`}
            </p>
          </Banner>
        )}

        {/* Import Error Banner */}
        {importError && (
          <Banner
            title="Import Failed"
            tone="critical"
            onDismiss={() => setImportError(null)}
          >
            <p>{importError}</p>
          </Banner>
        )}

        {/* Critical State Banner */}
        {criticalBanner && criticalBanner.severity !== 'GREEN' && (
          <Banner
            title={criticalBanner.message}
            tone={criticalBanner.severity === 'RED' ? 'critical' : 'warning'}
            action={criticalBanner.action_url ? {
              content: 'Take Action',
              onAction: () => navigate(criticalBanner.action_url),
            } : undefined}
          >
            {criticalBanner.severity === 'RED' && (
              <p>Orders are blocked and need immediate attention.</p>
            )}
          </Banner>
        )}

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

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
          {selectedTab === 0 && (
            <BlockStack gap="600">
              {/* Key Metrics Row */}
              <Layout>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Ready to Pick</Text>
                        <Badge tone={stats.orders_ready_to_pick > 0 ? 'success' : 'info'}>
                          {stats.orders_ready_to_pick > 0 ? 'Active' : 'Clear'}
                        </Badge>
                      </InlineStack>
                      <Text variant="heading2xl" fontWeight="bold">
                        {stats.orders_ready_to_pick || 0}
                      </Text>
                      <InvictaButton
                        size="slim"
                        fullWidth
                        onClick={() => navigate('/orders?status=READY_TO_PICK')}
                        disabled={!stats.orders_ready_to_pick}
                      >
                        View Orders
                      </InvictaButton>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Needs Review</Text>
                        {stats.orders_needs_review > 0 && (
                          <Badge tone="warning">Action Required</Badge>
                        )}
                      </InlineStack>
                      <Text variant="heading2xl" fontWeight="bold" tone={stats.orders_needs_review > 0 ? 'critical' : undefined}>
                        {stats.orders_needs_review || 0}
                      </Text>
                      <InvictaButton
                        size="slim"
                        fullWidth
                        variant={stats.orders_needs_review > 0 ? 'primary' : 'secondary'}
                        onClick={() => navigate('/review')}
                        disabled={!stats.orders_needs_review}
                      >
                        Start Review
                      </InvictaButton>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Active Batches</Text>
                        <Badge tone="info">{stats.batches_in_progress || 0} in progress</Badge>
                      </InlineStack>
                      <Text variant="heading2xl" fontWeight="bold">
                        {stats.batches_in_progress || 0}
                      </Text>
                      <InvictaButton
                        size="slim"
                        fullWidth
                        onClick={() => navigate('/picklists')}
                      >
                        Manage Batches
                      </InvictaButton>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Low Stock Alerts</Text>
                        {stats.components_low_stock > 0 && (
                          <Badge tone="critical">Attention</Badge>
                        )}
                      </InlineStack>
                      <Text variant="heading2xl" fontWeight="bold" tone={stats.components_low_stock > 0 ? 'critical' : 'success'}>
                        {stats.components_low_stock || 0}
                      </Text>
                      <InvictaButton
                        size="slim"
                        fullWidth
                        onClick={() => navigate('/components')}
                      >
                        View Inventory
                      </InvictaButton>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

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
                            onClick={() => navigate('/orders?status=READY_TO_PICK')}
                          >
                            Create Batch
                          </InvictaButton>
                        )
                      }
                    >
                      {readyToPick.length === 0 ? (
                        <Card>
                          <BlockStack gap="200" inlineAlign="center">
                            <Text tone="subdued">No orders ready to pick.</Text>
                            <Text variant="bodySm" tone="subdued">
                              Sync orders from Amazon or resolve pending reviews.
                            </Text>
                          </BlockStack>
                        </Card>
                      ) : (
                        <Card>
                          <BlockStack gap="200">
                            {readyToPick.slice(0, 8).map(order => (
                              <OrderRow key={order.id} order={order} onClick={() => navigate(`/orders?id=${order.id}`)} />
                            ))}
                            {readyToPick.length > 8 && (
                              <Divider />
                            )}
                            {readyToPick.length > 8 && (
                              <InlineStack align="center">
                                <InvictaButton variant="secondary" onClick={() => navigate('/orders?status=READY_TO_PICK')}>
                                  View all {readyToPick.length} orders
                                </InvictaButton>
                              </InlineStack>
                            )}
                          </BlockStack>
                        </Card>
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
                        <Card>
                          <BlockStack gap="200">
                            {bottlenecks.slice(0, 5).map(item => (
                              <BottleneckRow key={item.component_id} item={item} />
                            ))}
                            {bottlenecks.length > 5 && (
                              <Text variant="bodySm" tone="subdued" alignment="center">
                                +{bottlenecks.length - 5} more bottlenecks
                              </Text>
                            )}
                          </BlockStack>
                        </Card>
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
                        <Card>
                          <BlockStack gap="200">
                            {needsReview.slice(0, 5).map(item => (
                              <ReviewRow key={item.id} item={item} />
                            ))}
                            {needsReview.length > 5 && (
                              <Text variant="bodySm" tone="subdued" alignment="center">
                                +{needsReview.length - 5} more items in review queue
                              </Text>
                            )}
                          </BlockStack>
                        </Card>
                      </InvictaSectionHeader>
                    )}
                  </BlockStack>
                </Layout.Section>

                {/* Sidebar */}
                <Layout.Section variant="oneThird">
                  <BlockStack gap="400">
                    {/* Quick Actions */}
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingSm">Quick Actions</Text>
                        <Divider />
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
                          <InvictaButton fullWidth variant="secondary" onClick={() => navigate('/profit')}>
                            View Analytics
                          </InvictaButton>
                          {isAdmin && (
                            <InvictaButton fullWidth variant="secondary" onClick={() => navigate('/returns')}>
                              Process Returns
                            </InvictaButton>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Card>

                    {/* Today's Performance */}
                    {analyticsData && (
                      <Card>
                        <BlockStack gap="300">
                          <Text variant="headingSm">Today's Performance</Text>
                          <Divider />
                          <InlineStack align="space-between">
                            <Text variant="bodySm">Orders</Text>
                            <Text variant="bodyMd" fontWeight="bold">{analyticsData.orders_today || 0}</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodySm">Revenue</Text>
                            <Text variant="bodyMd" fontWeight="bold" tone="success">
                              {formatPrice(analyticsData.revenue_today || 0)}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodySm">This Week</Text>
                            <Text variant="bodyMd" fontWeight="bold">
                              {analyticsData.orders_this_week || 0} orders
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text variant="bodySm">This Month</Text>
                            <Text variant="bodyMd" fontWeight="bold">
                              {analyticsData.orders_this_month || 0} orders
                            </Text>
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    )}

                    {/* System Status */}
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingSm">System Status</Text>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text variant="bodySm">Amazon SP-API</Text>
                          <Badge tone={amazonStatus?.connected ? 'success' : 'critical'}>
                            {amazonStatus?.connected ? 'Connected' : 'Not Connected'}
                          </Badge>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text variant="bodySm">Active Listings</Text>
                          <Text variant="bodyMd" fontWeight="semibold">{stats.listings_active || 0}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text variant="bodySm">Active BOMs</Text>
                          <Text variant="bodyMd" fontWeight="semibold">{stats.boms_active || 0}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text variant="bodySm">Total Components</Text>
                          <Text variant="bodyMd" fontWeight="semibold">{stats.components_total || 0}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text variant="bodySm">Total Orders</Text>
                          <Text variant="bodyMd" fontWeight="semibold">{totalOrders}</Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>

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
          )}

          {selectedTab === 1 && (
            <BlockStack gap="600">
              {/* Performance Metrics */}
              {analyticsData ? (
                <>
                  <Layout>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Total Revenue (7d)</Text>
                          <Text variant="heading2xl" fontWeight="bold" tone="success">
                            {formatPrice(analyticsData.total_revenue || 0)}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Gross Profit (7d)</Text>
                          <Text variant="heading2xl" fontWeight="bold">
                            {formatPrice(analyticsData.total_profit || 0)}
                          </Text>
                          <Badge tone={parseFloat(analyticsData.gross_margin_pct) >= 30 ? 'success' : 'warning'}>
                            {analyticsData.gross_margin_pct}% margin
                          </Badge>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Orders (7d)</Text>
                          <Text variant="heading2xl" fontWeight="bold">
                            {analyticsData.total_orders || 0}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    <Layout.Section variant="oneQuarter">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="bodySm" tone="subdued">Avg Order Value</Text>
                          <Text variant="heading2xl" fontWeight="bold">
                            {formatPrice(analyticsData.avg_order_value || 0)}
                          </Text>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                  </Layout>

                  {/* Weekly Trend */}
                  {analyticsData.daily_trend && Object.keys(analyticsData.daily_trend).length > 0 && (
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingSm">Daily Trend (Last 7 Days)</Text>
                        <MiniChart
                          data={Object.entries(analyticsData.daily_trend).map(([date, d]) => ({
                            date,
                            revenue: d.revenue,
                            orders: d.orders,
                          }))}
                          valueKey="revenue"
                          color="#008060"
                        />
                        <InlineStack align="space-between">
                          {Object.entries(analyticsData.daily_trend).slice(0, 7).map(([date, d]) => (
                            <BlockStack key={date} gap="100" inlineAlign="center">
                              <Text variant="bodySm" tone="subdued">
                                {new Date(date).toLocaleDateString('en-GB', { weekday: 'short' })}
                              </Text>
                              <Text variant="bodySm" fontWeight="semibold">{d.orders}</Text>
                            </BlockStack>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  )}

                  {/* Status Breakdown */}
                  {analyticsData.orders_by_status && (
                    <Card>
                      <BlockStack gap="300">
                        <Text variant="headingSm">Orders by Status</Text>
                        <Divider />
                        <InlineGrid columns={4} gap="400">
                          {Object.entries(analyticsData.orders_by_status).map(([status, count]) => (
                            <BlockStack key={status} gap="100">
                              <Badge tone={
                                status === 'DISPATCHED' ? 'success' :
                                status === 'CANCELLED' ? 'critical' :
                                status === 'NEEDS_REVIEW' ? 'warning' : 'info'
                              }>
                                {status}
                              </Badge>
                              <Text variant="headingMd" fontWeight="bold">{count}</Text>
                            </BlockStack>
                          ))}
                        </InlineGrid>
                      </BlockStack>
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No analytics data available</Text>
                    <Text tone="subdued">Import orders and process them to see performance metrics.</Text>
                    <InvictaButton onClick={() => navigate('/profit')}>
                      View Full Analytics
                    </InvictaButton>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          )}
        </Tabs>
      </BlockStack>
    </Page>
  );
}

/**
 * OrderRow - Single order row for list display
 */
function OrderRow({ order, onClick }) {
  const orderDate = order.order_date ? new Date(order.order_date) : null;
  const isToday = orderDate && orderDate.toDateString() === new Date().toDateString();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        backgroundColor: isToday ? '#F0FDF4' : '#FAFAFA',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      }}
      onClick={onClick}
      onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#F1F1F1'}
      onMouseOut={(e) => e.currentTarget.style.backgroundColor = isToday ? '#F0FDF4' : '#FAFAFA'}
    >
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center">
          <Text variant="bodyMd" fontWeight="semibold">
            {order.external_order_id}
          </Text>
          {isToday && <Badge tone="success" size="small">Today</Badge>}
        </InlineStack>
        <Text variant="bodySm" tone="subdued">
          {order.customer_name || order.customer_email || 'Unknown customer'}
        </Text>
      </BlockStack>
      <InlineStack gap="300" blockAlign="center">
        <BlockStack gap="100" inlineAlign="end">
          <Text variant="bodySm" tone="subdued">
            {order.order_lines?.length || 0} items
          </Text>
          {order.total_price_pence && (
            <Text variant="bodySm" fontWeight="semibold">
              £{(order.total_price_pence / 100).toFixed(2)}
            </Text>
          )}
        </BlockStack>
        <InvictaBadge status={order.status} size="small" />
      </InlineStack>
    </div>
  );
}

/**
 * BottleneckRow - Stock bottleneck item
 */
function BottleneckRow({ item }) {
  const severity = item.available <= 0 ? 'critical' : item.available < 5 ? 'high' : 'medium';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        backgroundColor: severity === 'critical' ? '#FEF2F2' : severity === 'high' ? '#FFFBEB' : '#FEF9C3',
        borderRadius: '6px',
        borderLeft: `4px solid ${severity === 'critical' ? '#DC2626' : severity === 'high' ? '#D97706' : '#CA8A04'}`,
      }}
    >
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="semibold">
          {item.internal_sku}
        </Text>
        <Text variant="bodySm" tone="subdued">
          {item.description?.substring(0, 40)}{item.description?.length > 40 ? '...' : ''}
        </Text>
      </BlockStack>
      <InlineStack gap="300" blockAlign="center">
        <BlockStack gap="100" inlineAlign="end">
          <Text variant="bodySm" fontWeight="semibold">
            {item.available} available
          </Text>
          {item.blocked_orders > 0 && (
            <Text variant="bodySm" tone="critical">
              Blocks {item.blocked_orders} order{item.blocked_orders > 1 ? 's' : ''}
            </Text>
          )}
        </BlockStack>
        <Badge tone={severity === 'critical' ? 'critical' : 'warning'}>
          {item.available <= 0 ? 'Out of Stock' : 'Low Stock'}
        </Badge>
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
        padding: '10px 12px',
        backgroundColor: '#FFFBEB',
        borderRadius: '6px',
        borderLeft: '4px solid #D97706',
      }}
    >
      <BlockStack gap="100">
        <Text variant="bodyMd" fontWeight="semibold">
          {item.title?.substring(0, 45) || item.asin || item.sku || 'Unknown'}
          {item.title?.length > 45 && '...'}
        </Text>
        <InlineStack gap="200">
          {item.asin && (
            <Text variant="bodySm" tone="subdued">ASIN: {item.asin}</Text>
          )}
          {item.sku && (
            <Text variant="bodySm" tone="subdued">SKU: {item.sku}</Text>
          )}
        </InlineStack>
      </BlockStack>
      <Badge tone="warning">{item.reason || 'Pending'}</Badge>
    </div>
  );
}
