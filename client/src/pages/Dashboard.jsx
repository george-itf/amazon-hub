import React, { useEffect, useState, useCallback } from 'react';
import {
  Page,
  Layout,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Card,
  Badge,
  Button,
  Divider,
  ProgressBar,
  Box,
  Icon,
  Tooltip,
  Spinner,
} from '@shopify/polaris';
import {
  AlertCircleIcon,
  ClockIcon,
  PackageIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  RefreshIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import * as api from '../utils/api.jsx';

/**
 * Format currency in GBP
 */
function formatPrice(pence) {
  if (!pence && pence !== 0) return '£0.00';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100);
}

/**
 * Format relative time
 */
function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

/**
 * Metric Card Component - Clean stat display
 */
function MetricCard({ title, value, subtitle, trend, trendUp, onClick, highlighted, loading }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '20px',
        backgroundColor: highlighted ? '#FFF7ED' : '#FFFFFF',
        borderRadius: '12px',
        border: highlighted ? '2px solid #F97316' : '1px solid #E5E7EB',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        height: '100%',
      }}
      onMouseOver={(e) => onClick && (e.currentTarget.style.borderColor = '#6366F1')}
      onMouseOut={(e) => onClick && (e.currentTarget.style.borderColor = highlighted ? '#F97316' : '#E5E7EB')}
    >
      <BlockStack gap="200">
        <Text variant="bodySm" tone="subdued">{title}</Text>
        {loading ? (
          <Spinner size="small" />
        ) : (
          <>
            <Text variant="heading2xl" fontWeight="bold">{value}</Text>
            {(subtitle || trend) && (
              <InlineStack gap="200" blockAlign="center">
                {subtitle && <Text variant="bodySm" tone="subdued">{subtitle}</Text>}
                {trend && (
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{ color: trendUp ? '#059669' : '#DC2626' }}>
                      <Icon source={trendUp ? ArrowUpIcon : ArrowDownIcon} />
                    </div>
                    <Text variant="bodySm" tone={trendUp ? 'success' : 'critical'}>
                      {trend}
                    </Text>
                  </InlineStack>
                )}
              </InlineStack>
            )}
          </>
        )}
      </BlockStack>
    </div>
  );
}

/**
 * Order Pipeline Stage
 */
function PipelineStage({ label, count, color, onClick, active }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: active ? color + '15' : '#F9FAFB',
        borderRadius: '8px',
        cursor: 'pointer',
        border: active ? `2px solid ${color}` : '1px solid #E5E7EB',
        textAlign: 'center',
        transition: 'all 0.2s ease',
      }}
    >
      <BlockStack gap="100" inlineAlign="center">
        <Text variant="headingXl" fontWeight="bold" tone={active ? 'success' : undefined}>
          {count}
        </Text>
        <Text variant="bodySm" tone="subdued">{label}</Text>
      </BlockStack>
    </div>
  );
}

/**
 * Alert Item Component
 */
function AlertItem({ type, title, description, action, onAction }) {
  const colors = {
    critical: { bg: '#FEF2F2', border: '#DC2626', icon: AlertCircleIcon },
    warning: { bg: '#FFFBEB', border: '#D97706', icon: AlertCircleIcon },
    info: { bg: '#EFF6FF', border: '#3B82F6', icon: ClockIcon },
  };
  const style = colors[type] || colors.info;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      backgroundColor: style.bg,
      borderLeft: `4px solid ${style.border}`,
      borderRadius: '0 8px 8px 0',
      marginBottom: '8px',
    }}>
      <InlineStack gap="300" blockAlign="center">
        <div style={{ color: style.border }}>
          <Icon source={style.icon} />
        </div>
        <BlockStack gap="050">
          <Text variant="bodyMd" fontWeight="semibold">{title}</Text>
          {description && <Text variant="bodySm" tone="subdued">{description}</Text>}
        </BlockStack>
      </InlineStack>
      {action && (
        <Button size="slim" onClick={onAction}>{action}</Button>
      )}
    </div>
  );
}

/**
 * Order Row Component
 */
function OrderRow({ order, onClick }) {
  const isToday = order.order_date &&
    new Date(order.order_date).toDateString() === new Date().toDateString();

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: isToday ? '#F0FDF4' : '#FAFAFA',
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        marginBottom: '8px',
      }}
      onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#F3F4F6'}
      onMouseOut={(e) => e.currentTarget.style.backgroundColor = isToday ? '#F0FDF4' : '#FAFAFA'}
    >
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center">
          <Text variant="bodyMd" fontWeight="semibold">
            {order.order_number || order.external_order_id}
          </Text>
          {order.channel === 'AMAZON' && (
            <Badge tone="info" size="small">Amazon</Badge>
          )}
          {isToday && <Badge tone="success" size="small">Today</Badge>}
        </InlineStack>
        <Text variant="bodySm" tone="subdued">
          {order.customer_name || 'Customer'} • {order.order_lines?.length || 0} item(s)
        </Text>
      </BlockStack>
      <InlineStack gap="300" blockAlign="center">
        <Text variant="bodyMd" fontWeight="semibold">
          {formatPrice(order.total_price_pence)}
        </Text>
        <StatusBadge status={order.status} />
        <Icon source={ChevronRightIcon} tone="subdued" />
      </InlineStack>
    </div>
  );
}

/**
 * Status Badge Component
 */
function StatusBadge({ status }) {
  const statusConfig = {
    READY_TO_PICK: { label: 'Ready', tone: 'success' },
    NEEDS_REVIEW: { label: 'Review', tone: 'warning' },
    PICKED: { label: 'Picked', tone: 'info' },
    DISPATCHED: { label: 'Shipped', tone: 'success' },
    IMPORTED: { label: 'New', tone: 'info' },
    CANCELLED: { label: 'Cancelled', tone: 'critical' },
  };
  const config = statusConfig[status] || { label: status, tone: 'info' };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

/**
 * Pulse Ticker Component - Revenue + Estimated Profit
 */
function PulseTicker({ data, loading }) {
  if (loading) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" fontWeight="bold">Pulse</Text>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
            <Spinner size="small" />
          </div>
        </BlockStack>
      </Card>
    );
  }

  if (!data) return null;

  const { revenue, estimated_profit, orders } = data;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text variant="headingMd" fontWeight="bold">Pulse</Text>
          <Badge tone="info">Live</Badge>
        </InlineStack>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
        }}>
          {/* Today */}
          <div style={{
            padding: '16px',
            backgroundColor: '#F0FDF4',
            borderRadius: '8px',
            textAlign: 'center',
          }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" tone="subdued">Today</Text>
              <Text variant="headingLg" fontWeight="bold">
                {formatPrice(revenue?.today || 0)}
              </Text>
              <InlineStack gap="100" blockAlign="center">
                <Text variant="bodySm" tone="success">
                  +{formatPrice(estimated_profit?.today || 0)} profit
                </Text>
              </InlineStack>
              <Text variant="bodySm" tone="subdued">{orders?.today || 0} orders</Text>
            </BlockStack>
          </div>

          {/* This Week */}
          <div style={{
            padding: '16px',
            backgroundColor: '#EFF6FF',
            borderRadius: '8px',
            textAlign: 'center',
          }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" tone="subdued">This Week</Text>
              <Text variant="headingLg" fontWeight="bold">
                {formatPrice(revenue?.week || 0)}
              </Text>
              <InlineStack gap="100" blockAlign="center">
                <Text variant="bodySm" tone="success">
                  +{formatPrice(estimated_profit?.week || 0)} profit
                </Text>
              </InlineStack>
              <Text variant="bodySm" tone="subdued">{orders?.week || 0} orders</Text>
            </BlockStack>
          </div>

          {/* This Month */}
          <div style={{
            padding: '16px',
            backgroundColor: '#FEF3C7',
            borderRadius: '8px',
            textAlign: 'center',
          }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" tone="subdued">This Month</Text>
              <Text variant="headingLg" fontWeight="bold">
                {formatPrice(revenue?.month || 0)}
              </Text>
              <InlineStack gap="100" blockAlign="center">
                <Text variant="bodySm" tone="success">
                  +{formatPrice(estimated_profit?.month || 0)} profit
                </Text>
              </InlineStack>
              <Text variant="bodySm" tone="subdued">{orders?.month || 0} orders</Text>
            </BlockStack>
          </div>
        </div>
      </BlockStack>
    </Card>
  );
}

/**
 * Stock Heatmap Component - 10x10 grid showing days of coverage
 */
function StockHeatmap({ data, loading, onClick }) {
  if (loading) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" fontWeight="bold">Stock Heatmap</Text>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
            <Spinner size="small" />
          </div>
        </BlockStack>
      </Card>
    );
  }

  if (!data || !data.components) return null;

  const { components, buckets, summary } = data;

  // Get bucket color
  const getBucketColor = (bucket) => {
    switch (bucket) {
      case 'critical': return '#DC2626'; // Red
      case 'low': return '#F59E0B';      // Orange
      case 'medium': return '#3B82F6';   // Blue
      case 'healthy': return '#10B981';  // Green
      default: return '#9CA3AF';
    }
  };

  // Create 10x10 grid cells (max 100 items)
  const gridItems = components.slice(0, 100);

  // Pad to 100 items if needed for consistent grid
  while (gridItems.length < 100 && gridItems.length > 0) {
    gridItems.push({ bucket: 'empty', component_id: `empty-${gridItems.length}` });
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text variant="headingMd" fontWeight="bold">Stock Heatmap</Text>
          <InlineStack gap="200">
            <Tooltip content="0-7 days">
              <Badge tone="critical">{buckets?.critical || 0}</Badge>
            </Tooltip>
            <Tooltip content="7-14 days">
              <Badge tone="warning">{buckets?.low || 0}</Badge>
            </Tooltip>
            <Tooltip content="14-30 days">
              <Badge tone="info">{buckets?.medium || 0}</Badge>
            </Tooltip>
            <Tooltip content="30+ days">
              <Badge tone="success">{buckets?.healthy || 0}</Badge>
            </Tooltip>
          </InlineStack>
        </InlineStack>

        {/* 10x10 Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
          gap: '3px',
          aspectRatio: '1',
        }}>
          {gridItems.map((item, index) => (
            <Tooltip
              key={item.component_id || index}
              content={item.bucket !== 'empty'
                ? `${item.internal_sku}: ${item.days_of_coverage}d (${item.on_hand} units)`
                : ''
              }
            >
              <div
                onClick={() => item.bucket !== 'empty' && onClick?.(item)}
                style={{
                  backgroundColor: item.bucket === 'empty' ? '#F3F4F6' : getBucketColor(item.bucket),
                  borderRadius: '2px',
                  cursor: item.bucket !== 'empty' ? 'pointer' : 'default',
                  aspectRatio: '1',
                  opacity: item.bucket === 'empty' ? 0.3 : 1,
                  transition: 'transform 0.1s ease',
                }}
                onMouseOver={(e) => item.bucket !== 'empty' && (e.currentTarget.style.transform = 'scale(1.1)')}
                onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
              />
            </Tooltip>
          ))}
        </div>

        {/* Legend */}
        <InlineStack gap="400" align="center">
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: '#DC2626', borderRadius: '2px' }} />
            <Text variant="bodySm">0-7d</Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: '#F59E0B', borderRadius: '2px' }} />
            <Text variant="bodySm">7-14d</Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: '#3B82F6', borderRadius: '2px' }} />
            <Text variant="bodySm">14-30d</Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: '#10B981', borderRadius: '2px' }} />
            <Text variant="bodySm">30+d</Text>
          </InlineStack>
        </InlineStack>

        {/* Summary */}
        {summary?.critical_count > 0 && (
          <Banner tone="warning">
            <p>{summary.critical_count} component(s) need restocking within 7 days</p>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Dashboard - Amazon Seller Command Center
 */
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [amazonStats, setAmazonStats] = useState(null);
  const [amazonStatus, setAmazonStatus] = useState(null);

  // Pulse and Heatmap state
  const [pulseData, setPulseData] = useState(null);
  const [pulseLoading, setPulseLoading] = useState(true);
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(true);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  // Track mounted state for cleanup
  const mountedRef = React.useRef(true);

  const loadDashboard = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      // Load core dashboard data
      const [dashboardData, amzStats, amzStatus] = await Promise.all([
        api.getDashboard(),
        api.getAmazonStats().catch(() => null),
        api.getAmazonStatus().catch(() => ({ connected: false })),
      ]);

      // Only update state if still mounted
      if (!mountedRef.current) return;

      setData(dashboardData);
      setAmazonStats(amzStats);
      setAmazonStatus(amzStatus);

      // Load pulse and heatmap in parallel (non-blocking)
      api.getDashboardPulse()
        .then(data => { if (mountedRef.current) setPulseData(data); })
        .catch(err => console.warn('Pulse load error:', err))
        .finally(() => { if (mountedRef.current) setPulseLoading(false); });

      api.getStockHeatmap()
        .then(data => { if (mountedRef.current) setHeatmapData(data); })
        .catch(err => console.warn('Heatmap load error:', err))
        .finally(() => { if (mountedRef.current) setHeatmapLoading(false); });

    } catch (err) {
      // Don't update state if unmounted or cancelled
      if (!mountedRef.current || err.code === 'CANCELLED') return;
      console.error('Dashboard load error:', err);
      setError(err.message || 'Failed to load dashboard');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSyncAmazon = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const result = await api.syncAmazonOrders(7);
      setSyncResult(result);
      await loadDashboard(true);
    } catch (err) {
      console.error('Sync error:', err);
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Page title="Dashboard">
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '400px',
        }}>
          <BlockStack gap="400" inlineAlign="center">
            <Spinner size="large" />
            <Text tone="subdued">Loading your seller dashboard...</Text>
          </BlockStack>
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Dashboard">
        <Banner tone="critical" title="Error loading dashboard">
          <p>{error}</p>
          <Button onClick={() => loadDashboard()}>Retry</Button>
        </Banner>
      </Page>
    );
  }

  const stats = data?.stats || {};
  const readyToPick = data?.ready_to_pick || [];
  const needsReview = data?.needs_review || [];
  const recentActivity = data?.recent_activity || [];
  const bottlenecks = data?.bottlenecks || [];

  // Calculate pipeline numbers
  const pendingCount = stats.orders_ready_to_pick || 0;
  const reviewCount = stats.orders_needs_review || 0;
  const pickedCount = stats.orders_picked || 0;
  const shippedToday = amazonStats?.sales_trend?.slice(-1)[0]?.orders || 0;

  // Build alerts
  const alerts = [];
  if (reviewCount > 0) {
    alerts.push({
      type: 'warning',
      title: `${reviewCount} order(s) need review`,
      description: 'Resolve listing issues to process these orders',
      action: 'Review Now',
      onAction: () => navigate('/listings?tab=review'),
    });
  }
  if (bottlenecks.length > 0) {
    alerts.push({
      type: 'critical',
      title: `${bottlenecks.length} stock bottleneck(s)`,
      description: 'Low inventory blocking orders',
      action: 'View Stock',
      onAction: () => navigate('/inventory'),
    });
  }
  if (!amazonStatus?.connected) {
    alerts.push({
      type: 'info',
      title: 'Connect Amazon SP-API',
      description: 'Link your Amazon account to sync orders automatically',
      action: 'Connect',
      onAction: () => navigate('/settings'),
    });
  }

  return (
    <Page
      title={
        <InlineStack gap="200" blockAlign="center">
          <span>Seller Dashboard</span>
          {refreshing && <Spinner size="small" />}
        </InlineStack>
      }
      subtitle={`Welcome back, ${user?.name || user?.email?.split('@')[0] || 'Seller'}`}
      primaryAction={{
        content: syncing ? 'Syncing...' : 'Sync Orders',
        onAction: handleSyncAmazon,
        loading: syncing,
        disabled: !amazonStatus?.connected,
        icon: RefreshIcon,
      }}
      secondaryActions={[
        {
          content: 'Refresh',
          onAction: () => loadDashboard(true),
          disabled: refreshing,
        },
      ]}
    >
      <BlockStack gap="600">
        {/* Sync Result Banner */}
        {syncResult && !syncResult.error && (
          <Banner
            tone="success"
            title="Sync Complete"
            onDismiss={() => setSyncResult(null)}
          >
            <p>
              {syncResult.created} new • {syncResult.updated} updated • {syncResult.skipped} unchanged
            </p>
          </Banner>
        )}
        {syncResult?.error && (
          <Banner tone="critical" title="Sync Failed" onDismiss={() => setSyncResult(null)}>
            <p>{syncResult.error}</p>
          </Banner>
        )}

        {/* Pulse Ticker - Revenue + Estimated Profit */}
        <PulseTicker data={pulseData} loading={pulseLoading} />

        {/* Alerts Section */}
        {alerts.length > 0 && (
          <div>
            {alerts.map((alert, i) => (
              <AlertItem key={i} {...alert} />
            ))}
          </div>
        )}

        {/* Sales Metrics Row - Uses same data source as Pulse for consistency */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
        }}>
          <MetricCard
            title="Today's Orders"
            value={pulseData?.orders?.today || 0}
            subtitle={formatPrice(pulseData?.revenue?.today || 0)}
            onClick={() => navigate('/shipping')}
            loading={pulseLoading}
          />
          <MetricCard
            title="This Week"
            value={`${pulseData?.orders?.week || 0} orders`}
            subtitle={formatPrice(pulseData?.revenue?.week || 0)}
            loading={pulseLoading}
          />
          <MetricCard
            title="This Month"
            value={formatPrice(pulseData?.revenue?.month || 0)}
            subtitle={`${pulseData?.orders?.month || 0} orders`}
            trend={amazonStats?.revenue_growth_percent ? `${amazonStats.revenue_growth_percent}%` : null}
            trendUp={amazonStats?.revenue_growth_percent > 0}
            loading={pulseLoading}
          />
          <MetricCard
            title="Pending Shipment"
            value={pendingCount}
            subtitle={pendingCount > 0 ? 'Action required' : 'All caught up'}
            highlighted={pendingCount > 0}
            onClick={() => navigate('/shipping')}
          />
        </div>

        {/* Order Pipeline */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text variant="headingMd" fontWeight="bold">Order Pipeline</Text>
              <Button variant="plain" onClick={() => navigate('/shipping')}>
                View all orders
              </Button>
            </InlineStack>
            <div style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'stretch',
            }}>
              <PipelineStage
                label="Needs Review"
                count={reviewCount}
                color="#D97706"
                active={reviewCount > 0}
                onClick={() => navigate('/listings?tab=review')}
              />
              <div style={{ display: 'flex', alignItems: 'center', color: '#9CA3AF' }}>→</div>
              <PipelineStage
                label="Ready to Pick"
                count={pendingCount}
                color="#2563EB"
                active={pendingCount > 0}
                onClick={() => navigate('/shipping')}
              />
              <div style={{ display: 'flex', alignItems: 'center', color: '#9CA3AF' }}>→</div>
              <PipelineStage
                label="Picked"
                count={pickedCount}
                color="#7C3AED"
                active={pickedCount > 0}
                onClick={() => navigate('/shipping')}
              />
              <div style={{ display: 'flex', alignItems: 'center', color: '#9CA3AF' }}>→</div>
              <PipelineStage
                label="Shipped Today"
                count={shippedToday}
                color="#059669"
                active={false}
                onClick={() => navigate('/shipping')}
              />
            </div>
          </BlockStack>
        </Card>

        <Layout>
          {/* Main Content - Recent Orders */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" fontWeight="bold">
                    Orders Awaiting Shipment
                  </Text>
                  {readyToPick.length > 0 && (
                    <Button
                      variant="primary"
                      size="slim"
                      onClick={() => navigate('/shipping')}
                    >
                      Process Orders
                    </Button>
                  )}
                </InlineStack>

                {readyToPick.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    backgroundColor: '#F9FAFB',
                    borderRadius: '8px',
                  }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <div style={{ color: '#10B981' }}>
                        <Icon source={CheckCircleIcon} />
                      </div>
                      <Text variant="headingMd">All caught up!</Text>
                      <Text tone="subdued">No orders waiting to ship</Text>
                      <Button onClick={handleSyncAmazon} disabled={syncing || !amazonStatus?.connected}>
                        Check for new orders
                      </Button>
                    </BlockStack>
                  </div>
                ) : (
                  <BlockStack gap="100">
                    {readyToPick.slice(0, 10).map(order => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        onClick={() => navigate('/shipping')}
                      />
                    ))}
                    {readyToPick.length > 10 && (
                      <Button
                        variant="plain"
                        fullWidth
                        onClick={() => navigate('/shipping')}
                      >
                        View all {readyToPick.length} orders
                      </Button>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Stock Heatmap - Days of Coverage */}
              <StockHeatmap
                data={heatmapData}
                loading={heatmapLoading}
                onClick={(item) => navigate(`/inventory?component=${item.component_id}`)}
              />

              {/* Account Health */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="bold">Account Status</Text>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text variant="bodySm">Amazon Connection</Text>
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
                    <Text variant="bodySm">Low Stock Items</Text>
                    <Badge tone={stats.components_low_stock > 0 ? 'warning' : 'success'}>
                      {stats.components_low_stock || 0}
                    </Badge>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Top Products This Month */}
              {amazonStats?.top_products?.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" fontWeight="bold">Top Products (30d)</Text>
                    <Divider />
                    {amazonStats.top_products.slice(0, 5).map((product, i) => (
                      <InlineStack key={i} align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text variant="bodySm" fontWeight="medium">
                            {product.title?.substring(0, 30) || product.asin}
                            {product.title?.length > 30 && '...'}
                          </Text>
                          <Text variant="bodySm" tone="subdued">{product.asin}</Text>
                        </BlockStack>
                        <Badge>{product.quantity} sold</Badge>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              {/* Quick Actions - Navigate to all pages */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" fontWeight="bold">Quick Actions</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <Button fullWidth onClick={() => navigate('/inventory')}>
                      Manage Inventory
                    </Button>
                    <Button fullWidth variant="secondary" onClick={() => navigate('/listings')}>
                      Amazon Listings
                    </Button>
                    <Button fullWidth variant="secondary" onClick={() => navigate('/analyzer')}>
                      ASIN Analyzer
                    </Button>
                    <Button fullWidth variant="secondary" onClick={() => navigate('/shipping')}>
                      Ship Orders
                    </Button>
                    <Button fullWidth variant="secondary" onClick={() => navigate('/analytics')}>
                      View Analytics
                    </Button>
                    <Button fullWidth variant="secondary" onClick={() => navigate('/settings')}>
                      Settings
                    </Button>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Recent Activity */}
              {recentActivity.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" fontWeight="bold">Recent Activity</Text>
                    <Divider />
                    {recentActivity.slice(0, 5).map((event, i) => (
                      <BlockStack key={i} gap="050">
                        <Text variant="bodySm" fontWeight="medium">
                          {event.description || event.event_type}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          {formatRelativeTime(event.created_at)}
                        </Text>
                      </BlockStack>
                    ))}
                    <Button variant="plain" onClick={() => navigate('/settings')}>
                      View all activity
                    </Button>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
