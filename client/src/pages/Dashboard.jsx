import React, { useEffect, useState, useCallback, memo, useMemo } from 'react';
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
 * Metric Card Component - Clean stat display using hub design system
 * Memoized to prevent unnecessary re-renders
 */
const MetricCard = memo(function MetricCard({ title, value, subtitle, trend, trendUp, onClick, highlighted, loading }) {
  const cardClasses = [
    'hub-stat-card',
    onClick && 'hub-stat-card--clickable',
    highlighted && 'hub-stat-card--highlighted',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClasses} onClick={onClick}>
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
                    <Icon source={trendUp ? ArrowUpIcon : ArrowDownIcon} tone={trendUp ? 'success' : 'critical'} />
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
});

/**
 * Order Pipeline Stage - Visual workflow step
 * Memoized to prevent unnecessary re-renders
 */
const PipelineStage = memo(function PipelineStage({ label, count, color, onClick, active }) {
  return (
    <div
      onClick={onClick}
      className={`hub-stat-card hub-stat-card--clickable ${active ? 'hub-stat-card--highlighted' : ''}`}
      style={{
        flex: 1,
        textAlign: 'center',
        borderLeftColor: active ? color : undefined,
        borderLeftWidth: active ? '4px' : undefined,
        borderLeftStyle: active ? 'solid' : undefined,
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
});

/**
 * Alert Item Component - Uses design system alert styling
 * Memoized to prevent unnecessary re-renders
 */
const AlertItem = memo(function AlertItem({ type, title, description, action, onAction }) {
  const typeToClass = {
    critical: 'hub-stat-card--critical',
    warning: 'hub-stat-card--warning',
    info: 'hub-stat-card--success',
  };
  const icons = {
    critical: AlertCircleIcon,
    warning: AlertCircleIcon,
    info: ClockIcon,
  };

  return (
    <div className={`hub-stat-card ${typeToClass[type] || typeToClass.info}`} style={{ marginBottom: '8px' }}>
      <InlineStack gap="300" blockAlign="center" align="space-between">
        <InlineStack gap="300" blockAlign="center">
          <Icon source={icons[type] || ClockIcon} tone={type === 'critical' ? 'critical' : type === 'warning' ? 'caution' : 'success'} />
          <BlockStack gap="050">
            <Text variant="bodyMd" fontWeight="semibold">{title}</Text>
            {description && <Text variant="bodySm" tone="subdued">{description}</Text>}
          </BlockStack>
        </InlineStack>
        {action && (
          <Button size="slim" onClick={onAction}>{action}</Button>
        )}
      </InlineStack>
    </div>
  );
});

/**
 * Order Row Component - Uses design system CSS variables
 * Memoized to prevent unnecessary re-renders when other parts of dashboard update
 */
const OrderRow = memo(function OrderRow({ order, onClick }) {
  const isToday = order.order_date &&
    new Date(order.order_date).toDateString() === new Date().toDateString();

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--hub-space-sm) var(--hub-space-md)',
        backgroundColor: isToday ? 'var(--hub-success-light)' : 'var(--hub-bg)',
        borderRadius: 'var(--hub-radius-md)',
        border: '1px solid var(--hub-border)',
        cursor: 'pointer',
        transition: 'all var(--hub-transition-fast)',
        marginBottom: 'var(--hub-space-sm)',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--hub-surface-hover)';
        e.currentTarget.style.borderColor = 'var(--hub-border-strong)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = isToday ? 'var(--hub-success-light)' : 'var(--hub-bg)';
        e.currentTarget.style.borderColor = 'var(--hub-border)';
      }}
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
});

/**
 * Status Badge Component - Memoized
 */
const StatusBadge = memo(function StatusBadge({ status }) {
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
});

/**
 * Pulse Ticker Component - Revenue + Estimated Profit
 * Memoized to prevent unnecessary re-renders
 */
const PulseTicker = memo(function PulseTicker({ data, loading }) {
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
          <Badge tone="success">Live</Badge>
        </InlineStack>

        <div className="hub-grid hub-grid--3">
          {/* Today - Primary highlight */}
          <div className="hub-stat-card hub-stat-card--success" style={{ textAlign: 'center' }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" tone="subdued">Today</Text>
              <Text variant="headingXl" fontWeight="bold">
                {formatPrice(revenue?.today || 0)}
              </Text>
              <Badge tone="success">+{formatPrice(estimated_profit?.today || 0)} profit</Badge>
              <Text variant="bodySm" tone="subdued">{orders?.today || 0} orders</Text>
            </BlockStack>
          </div>

          {/* This Week */}
          <div className="hub-stat-card" style={{ textAlign: 'center' }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" tone="subdued">This Week</Text>
              <Text variant="headingLg" fontWeight="bold">
                {formatPrice(revenue?.week || 0)}
              </Text>
              <Text variant="bodySm" tone="success">
                +{formatPrice(estimated_profit?.week || 0)} profit
              </Text>
              <Text variant="bodySm" tone="subdued">{orders?.week || 0} orders</Text>
            </BlockStack>
          </div>

          {/* This Month */}
          <div className="hub-stat-card" style={{ textAlign: 'center' }}>
            <BlockStack gap="200" inlineAlign="center">
              <Text variant="bodySm" tone="subdued">This Month</Text>
              <Text variant="headingLg" fontWeight="bold">
                {formatPrice(revenue?.month || 0)}
              </Text>
              <Text variant="bodySm" tone="success">
                +{formatPrice(estimated_profit?.month || 0)} profit
              </Text>
              <Text variant="bodySm" tone="subdued">{orders?.month || 0} orders</Text>
            </BlockStack>
          </div>
        </div>
      </BlockStack>
    </Card>
  );
});

/**
 * Stock Heatmap Component - 10x10 grid showing days of coverage
 * Memoized to prevent expensive re-renders
 */
const StockHeatmap = memo(function StockHeatmap({ data, loading, onClick }) {
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

  // Get bucket color using design system variables
  const getBucketColor = (bucket) => {
    switch (bucket) {
      case 'critical': return 'var(--hub-critical)';
      case 'low': return 'var(--hub-warning)';
      case 'medium': return 'var(--hub-info)';
      case 'healthy': return 'var(--hub-success)';
      default: return 'var(--hub-text-muted)';
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
            <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--hub-critical)', borderRadius: 'var(--hub-radius-sm)' }} />
            <Text variant="bodySm">0-7d</Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--hub-warning)', borderRadius: 'var(--hub-radius-sm)' }} />
            <Text variant="bodySm">7-14d</Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--hub-info)', borderRadius: 'var(--hub-radius-sm)' }} />
            <Text variant="bodySm">14-30d</Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--hub-success)', borderRadius: 'var(--hub-radius-sm)' }} />
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
});

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
        <div className="hub-grid hub-grid--4">
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
              gap: 'var(--hub-space-sm)',
              alignItems: 'stretch',
            }}>
              <PipelineStage
                label="Needs Review"
                count={reviewCount}
                color="var(--hub-warning)"
                active={reviewCount > 0}
                onClick={() => navigate('/listings?tab=review')}
              />
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--hub-text-muted)' }}>→</div>
              <PipelineStage
                label="Ready to Pick"
                count={pendingCount}
                color="var(--hub-info)"
                active={pendingCount > 0}
                onClick={() => navigate('/shipping')}
              />
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--hub-text-muted)' }}>→</div>
              <PipelineStage
                label="Picked"
                count={pickedCount}
                color="var(--hub-primary)"
                active={pickedCount > 0}
                onClick={() => navigate('/shipping')}
              />
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--hub-text-muted)' }}>→</div>
              <PipelineStage
                label="Shipped Today"
                count={shippedToday}
                color="var(--hub-success)"
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
                    padding: 'var(--hub-space-2xl) var(--hub-space-lg)',
                    backgroundColor: 'var(--hub-bg)',
                    borderRadius: 'var(--hub-radius-md)',
                    border: '1px dashed var(--hub-border)',
                  }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <div style={{ color: 'var(--hub-success)' }}>
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
