import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Select,
  Button,
  TextField,
  Tabs,
  Divider,
  ProgressBar,
  Modal,
  Icon,
} from '@shopify/polaris';
import {
  getAnalyticsSummary,
  getAnalyticsProducts,
  getAnalyticsTrends,
  getAnalyticsCustomers,
  exportAnalytics,
} from '../utils/api.jsx';
import {
  InvictaLoading,
  InvictaPanel,
  InvictaSectionHeader,
} from '../components/ui/index.jsx';
import { useProductModal } from '../context/ProductModalContext.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence, showSign = false) {
  if (!pence && pence !== 0) return '-';
  const value = pence / 100;
  const formatted = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(Math.abs(value));
  if (showSign && value < 0) return `-${formatted}`;
  if (showSign && value > 0) return `+${formatted}`;
  return value < 0 ? `-${formatted}` : formatted;
}

/**
 * Format large numbers compactly
 */
function formatCompact(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Date presets for quick selection
 */
const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'This month', value: 'month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'This year', value: 'year' },
  { label: 'All time', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

function getDateRange(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return { start: today.toISOString().split('T')[0], end: today.toISOString().split('T')[0] };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: yesterday.toISOString().split('T')[0], end: yesterday.toISOString().split('T')[0] };
    }
    case '7d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] };
    }
    case '30d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] };
    }
    case '90d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
    }
    case 'year': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] };
    }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

/**
 * Simple sparkline/bar chart component
 */
function MiniChart({ data, valueKey, maxValue, color = '#2c6ecb' }) {
  if (!data || data.length === 0) return null;
  const max = maxValue || Math.max(...data.map(d => d[valueKey] || 0));
  if (max === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '40px' }}>
      {data.map((d, i) => {
        const height = max > 0 ? (d[valueKey] / max) * 100 : 0;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: color,
              height: `${Math.max(height, 2)}%`,
              minWidth: '4px',
              borderRadius: '2px 2px 0 0',
              opacity: 0.7,
            }}
            title={`${d.period}: ${formatCompact(d[valueKey])}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Stat card component
 */
function StatCard({ title, value, subtitle, change, changeTone, large }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text variant="bodySm" tone="subdued">{title}</Text>
        <Text variant={large ? 'heading2xl' : 'headingXl'} fontWeight="bold">
          {value}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          {subtitle && <Text variant="bodySm" tone="subdued">{subtitle}</Text>}
          {change !== undefined && (
            <Badge tone={changeTone || (change >= 0 ? 'success' : 'critical')}>
              {change >= 0 ? '+' : ''}{change}%
            </Badge>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

/**
 * ProfitPage - Comprehensive profitability analytics
 */
export default function ProfitPage() {
  const { openProductModal } = useProductModal();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Date range state
  const [datePreset, setDatePreset] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Data state
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [customers, setCustomers] = useState(null);

  // UI state
  const [selectedTab, setSelectedTab] = useState(0);
  const [productSort, setProductSort] = useState('revenue');
  const [productView, setProductView] = useState('top'); // 'top' or 'bottom'
  const [exporting, setExporting] = useState(false);
  const [granularity, setGranularity] = useState('daily');

  // Calculate effective date range
  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return { start: customStart || null, end: customEnd || null };
    }
    return getDateRange(datePreset);
  }, [datePreset, customStart, customEnd]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = {};
      if (dateRange.start) params.start_date = dateRange.start;
      if (dateRange.end) params.end_date = dateRange.end;

      // Load all data in parallel
      const [summaryData, productsData, trendsData, customersData] = await Promise.all([
        getAnalyticsSummary(params),
        getAnalyticsProducts({ ...params, sort_by: productSort, limit: 50 }),
        getAnalyticsTrends({ ...params, granularity }),
        getAnalyticsCustomers(params),
      ]);

      setSummary(summaryData);
      setProducts(productsData.products || []);
      setTrends(trendsData.trends || []);
      setCustomers(customersData);
    } catch (err) {
      console.error('Analytics load error:', err);
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [dateRange, productSort, granularity]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle export
  const handleExport = async (type) => {
    setExporting(true);
    try {
      const params = { type };
      if (dateRange.start) params.start_date = dateRange.start;
      if (dateRange.end) params.end_date = dateRange.end;

      const blob = await exportAnalytics(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics_${type}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  // Get products for display (top or bottom)
  const displayProducts = useMemo(() => {
    if (productView === 'bottom') {
      return [...products].reverse().slice(0, 10);
    }
    return products.slice(0, 10);
  }, [products, productView]);

  // Calculate trend comparison (this period vs previous)
  const periodComparison = useMemo(() => {
    if (!trends || trends.length < 2) return null;

    const mid = Math.floor(trends.length / 2);
    const firstHalf = trends.slice(0, mid);
    const secondHalf = trends.slice(mid);

    const firstRevenue = firstHalf.reduce((sum, t) => sum + t.revenue, 0);
    const secondRevenue = secondHalf.reduce((sum, t) => sum + t.revenue, 0);

    if (firstRevenue === 0) return null;

    const change = ((secondRevenue - firstRevenue) / firstRevenue * 100).toFixed(1);
    return { change: parseFloat(change), trend: secondRevenue >= firstRevenue ? 'up' : 'down' };
  }, [trends]);

  const tabs = [
    { id: 'overview', content: 'Overview' },
    { id: 'products', content: 'Products' },
    { id: 'trends', content: 'Trends' },
    { id: 'customers', content: 'Customers' },
  ];

  if (loading && !summary) {
    return (
      <Page title="Profitability">
        <InvictaLoading message="Loading analytics..." />
      </Page>
    );
  }

  return (
    <Page
      title="Profitability & Analytics"
      subtitle={summary ? `${formatCompact(summary.total_orders)} orders · ${formatPrice(summary.total_revenue)} revenue` : ''}
      secondaryActions={[
        { content: 'Refresh', onAction: loadData, disabled: loading },
        {
          content: 'Export Orders',
          onAction: () => handleExport('orders'),
          disabled: exporting,
        },
        {
          content: 'Export Products',
          onAction: () => handleExport('products'),
          disabled: exporting,
        },
      ]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Date Range Selector */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="400" blockAlign="center" wrap>
              <Text variant="bodyMd" fontWeight="semibold">Period:</Text>
              <Select
                label="Date range"
                labelHidden
                options={DATE_PRESETS}
                value={datePreset}
                onChange={setDatePreset}
              />
              {datePreset === 'custom' && (
                <>
                  <TextField
                    label="Start date"
                    labelHidden
                    type="date"
                    value={customStart}
                    onChange={setCustomStart}
                    autoComplete="off"
                  />
                  <Text variant="bodySm">to</Text>
                  <TextField
                    label="End date"
                    labelHidden
                    type="date"
                    value={customEnd}
                    onChange={setCustomEnd}
                    autoComplete="off"
                  />
                </>
              )}
              {loading && <Spinner size="small" />}
            </InlineStack>
          </BlockStack>
        </Card>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
          {/* Overview Tab */}
          {selectedTab === 0 && summary && (
            <BlockStack gap="400">
              {/* Key Metrics */}
              <Layout>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Total Revenue"
                    value={formatPrice(summary.total_revenue)}
                    subtitle={`${formatPrice(summary.revenue_today)} today`}
                    large
                  />
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Gross Profit"
                    value={formatPrice(summary.total_profit)}
                    subtitle={`${summary.gross_margin_pct}% margin`}
                    changeTone={parseFloat(summary.gross_margin_pct) >= 30 ? 'success' : 'warning'}
                    large
                  />
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Total COGS"
                    value={formatPrice(summary.total_cogs)}
                    subtitle="Cost of goods sold"
                    large
                  />
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Avg Order Value"
                    value={formatPrice(summary.avg_order_value)}
                    subtitle={`${summary.total_orders} orders`}
                    large
                  />
                </Layout.Section>
              </Layout>

              {/* Secondary Metrics */}
              <Layout>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Orders This Period</Text>
                      <InlineStack gap="600">
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Today</Text>
                          <Text variant="headingLg">{summary.orders_today}</Text>
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">This Week</Text>
                          <Text variant="headingLg">{summary.orders_this_week}</Text>
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">This Month</Text>
                          <Text variant="headingLg">{summary.orders_this_month}</Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Performance</Text>
                      <InlineStack gap="600">
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Fulfillment Rate</Text>
                          <Text variant="headingLg" tone="success">{summary.fulfillment_rate}%</Text>
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Cancel Rate</Text>
                          <Text variant="headingLg" tone={parseFloat(summary.cancellation_rate) > 5 ? 'critical' : undefined}>
                            {summary.cancellation_rate}%
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Diversity</Text>
                      <InlineStack gap="600">
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Unique Products</Text>
                          <Text variant="headingLg">{summary.unique_products}</Text>
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Unique Customers</Text>
                          <Text variant="headingLg">{summary.unique_customers}</Text>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>

              {/* Trend Mini Chart */}
              {trends.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">Revenue Trend</Text>
                      {periodComparison && (
                        <Badge tone={periodComparison.change >= 0 ? 'success' : 'critical'}>
                          {periodComparison.change >= 0 ? '+' : ''}{periodComparison.change}% vs prev
                        </Badge>
                      )}
                    </InlineStack>
                    <MiniChart data={trends} valueKey="revenue" color="#2c6ecb" />
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued">{trends[0]?.period}</Text>
                      <Text variant="bodySm" tone="subdued">{trends[trends.length - 1]?.period}</Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              {/* Status Breakdown */}
              <Layout>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Orders by Status</Text>
                      <DataTable
                        columnContentTypes={['text', 'numeric', 'numeric']}
                        headings={['Status', 'Orders', 'Revenue']}
                        rows={Object.entries(summary.orders_by_status || {}).map(([status, count]) => [
                          <Badge
                            key={status}
                            tone={
                              status === 'DISPATCHED' ? 'success' :
                              status === 'CANCELLED' ? 'critical' :
                              status === 'NEEDS_REVIEW' ? 'warning' : 'info'
                            }
                          >
                            {status}
                          </Badge>,
                          count,
                          formatPrice(summary.revenue_by_status?.[status] || 0),
                        ])}
                      />
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm">Daily Snapshot (Last 7 Days)</Text>
                      <DataTable
                        columnContentTypes={['text', 'numeric', 'numeric', 'numeric']}
                        headings={['Date', 'Orders', 'Revenue', 'Profit']}
                        rows={Object.entries(summary.daily_trend || {}).slice(-7).map(([date, data]) => [
                          new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
                          data.orders,
                          formatPrice(data.revenue),
                          formatPrice(data.profit),
                        ])}
                      />
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </BlockStack>
          )}

          {/* Products Tab */}
          {selectedTab === 1 && (
            <BlockStack gap="400">
              <Card>
                <InlineStack gap="400" blockAlign="center">
                  <Text variant="bodyMd">Sort by:</Text>
                  <Select
                    label="Sort"
                    labelHidden
                    options={[
                      { label: 'Revenue', value: 'revenue' },
                      { label: 'Quantity', value: 'quantity' },
                      { label: 'Profit', value: 'profit' },
                      { label: 'Margin %', value: 'margin' },
                    ]}
                    value={productSort}
                    onChange={(v) => {
                      setProductSort(v);
                      // Reload with new sort
                    }}
                  />
                  <Text variant="bodyMd">View:</Text>
                  <Select
                    label="View"
                    labelHidden
                    options={[
                      { label: 'Top performers', value: 'top' },
                      { label: 'Bottom performers', value: 'bottom' },
                    ]}
                    value={productView}
                    onChange={setProductView}
                  />
                </InlineStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">
                    {productView === 'top' ? 'Top' : 'Bottom'} Products by {productSort}
                  </Text>
                  {displayProducts.length === 0 ? (
                    <Text tone="subdued">No product data available for this period.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                      headings={['Product', 'Qty Sold', 'Revenue', 'COGS', 'Profit', 'Margin']}
                      rows={displayProducts.map((p) => [
                        <button
                          key={p.key}
                          onClick={() => openProductModal(p)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="semibold">
                              <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                {(p.title || p.bom_description || p.asin || p.sku || 'Unknown').substring(0, 50)}
                                {(p.title || '').length > 50 ? '...' : ''}
                              </span>
                            </Text>
                            {p.bom_sku && <Text variant="bodySm" tone="subdued">SKU: {p.bom_sku}</Text>}
                          </BlockStack>
                        </button>,
                        p.quantity_sold,
                        formatPrice(p.gross_revenue),
                        formatPrice(p.cogs),
                        <Text
                          key="profit"
                          tone={p.gross_profit > 0 ? 'success' : p.gross_profit < 0 ? 'critical' : undefined}
                        >
                          {formatPrice(p.gross_profit)}
                        </Text>,
                        <Badge
                          key="margin"
                          tone={
                            parseFloat(p.gross_margin_pct) >= 40 ? 'success' :
                            parseFloat(p.gross_margin_pct) >= 20 ? 'info' :
                            parseFloat(p.gross_margin_pct) >= 0 ? 'warning' : 'critical'
                          }
                        >
                          {p.gross_margin_pct}%
                        </Badge>,
                      ])}
                      footerContent={`Showing ${displayProducts.length} of ${products.length} products`}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Product Summary Cards */}
              {products.length > 0 && (
                <Layout>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued">Highest Margin Product</Text>
                        {(() => {
                          const highest = [...products].sort((a, b) =>
                            parseFloat(b.gross_margin_pct) - parseFloat(a.gross_margin_pct)
                          )[0];
                          return (
                            <>
                              <Text variant="headingMd">{highest?.title?.substring(0, 30) || 'N/A'}</Text>
                              <Badge tone="success">{highest?.gross_margin_pct}% margin</Badge>
                            </>
                          );
                        })()}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued">Top Seller</Text>
                        {(() => {
                          const top = [...products].sort((a, b) => b.quantity_sold - a.quantity_sold)[0];
                          return (
                            <>
                              <Text variant="headingMd">{top?.title?.substring(0, 30) || 'N/A'}</Text>
                              <Badge tone="info">{top?.quantity_sold} units</Badge>
                            </>
                          );
                        })()}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued">Lowest Margin Product</Text>
                        {(() => {
                          const lowest = [...products]
                            .filter(p => p.quantity_sold > 0)
                            .sort((a, b) => parseFloat(a.gross_margin_pct) - parseFloat(b.gross_margin_pct)
                          )[0];
                          return (
                            <>
                              <Text variant="headingMd">{lowest?.title?.substring(0, 30) || 'N/A'}</Text>
                              <Badge tone={parseFloat(lowest?.gross_margin_pct) < 10 ? 'critical' : 'warning'}>
                                {lowest?.gross_margin_pct}% margin
                              </Badge>
                            </>
                          );
                        })()}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                </Layout>
              )}
            </BlockStack>
          )}

          {/* Trends Tab */}
          {selectedTab === 2 && (
            <BlockStack gap="400">
              <Card>
                <InlineStack gap="400" blockAlign="center">
                  <Text variant="bodyMd">Granularity:</Text>
                  <Select
                    label="Granularity"
                    labelHidden
                    options={[
                      { label: 'Daily', value: 'daily' },
                      { label: 'Weekly', value: 'weekly' },
                      { label: 'Monthly', value: 'monthly' },
                    ]}
                    value={granularity}
                    onChange={setGranularity}
                  />
                </InlineStack>
              </Card>

              {/* Revenue Trend */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Revenue Over Time</Text>
                  {trends.length === 0 ? (
                    <Text tone="subdued">No trend data available for this period.</Text>
                  ) : (
                    <>
                      <div style={{ height: '120px', position: 'relative' }}>
                        <MiniChart data={trends} valueKey="revenue" color="#2c6ecb" />
                      </div>
                      <DataTable
                        columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                        headings={['Period', 'Orders', 'Units', 'Revenue', 'COGS', 'Profit', 'Margin']}
                        rows={trends.map((t) => [
                          t.period,
                          t.order_count,
                          t.units_sold,
                          formatPrice(t.revenue),
                          formatPrice(t.cogs),
                          <Text key="profit" tone={t.profit > 0 ? 'success' : t.profit < 0 ? 'critical' : undefined}>
                            {formatPrice(t.profit)}
                          </Text>,
                          `${t.margin_pct}%`,
                        ])}
                      />
                    </>
                  )}
                </BlockStack>
              </Card>

              {/* Profit Trend */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Profit Over Time</Text>
                  <div style={{ height: '80px' }}>
                    <MiniChart data={trends} valueKey="profit" color="#008060" />
                  </div>
                </BlockStack>
              </Card>

              {/* Summary Stats */}
              {trends.length > 0 && (
                <Layout>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued">Average Daily Revenue</Text>
                        <Text variant="headingLg">
                          {formatPrice(trends.reduce((s, t) => s + t.revenue, 0) / (trends.length || 1))}
                        </Text>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued">Best Day/Period</Text>
                        {(() => {
                          const best = [...trends].sort((a, b) => b.revenue - a.revenue)[0];
                          return (
                            <>
                              <Text variant="headingMd">{best?.period}</Text>
                              <Text variant="bodyMd">{formatPrice(best?.revenue)}</Text>
                            </>
                          );
                        })()}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <Card>
                      <BlockStack gap="200">
                        <Text variant="bodySm" tone="subdued">Average Margin</Text>
                        <Text variant="headingLg">
                          {(trends.reduce((s, t) => s + parseFloat(t.margin_pct || 0), 0) / (trends.length || 1)).toFixed(1)}%
                        </Text>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                </Layout>
              )}
            </BlockStack>
          )}

          {/* Customers Tab */}
          {selectedTab === 3 && customers && (
            <BlockStack gap="400">
              {/* Customer Summary */}
              <Layout>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Total Customers"
                    value={customers.summary?.total_customers || 0}
                    large
                  />
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Repeat Customers"
                    value={customers.summary?.repeat_customers || 0}
                    subtitle={`${customers.summary?.repeat_rate_pct || 0}% repeat rate`}
                    large
                  />
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Avg Customer Value"
                    value={formatPrice(customers.summary?.avg_customer_value || 0)}
                    large
                  />
                </Layout.Section>
                <Layout.Section variant="oneQuarter">
                  <StatCard
                    title="Avg Orders/Customer"
                    value={customers.summary?.avg_orders_per_customer || '0'}
                    large
                  />
                </Layout.Section>
              </Layout>

              {/* Top Customers */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Top Customers by Spend</Text>
                  {!customers.top_customers || customers.top_customers.length === 0 ? (
                    <Text tone="subdued">No customer data available for this period.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text', 'text']}
                      headings={['Customer', 'Email', 'Orders', 'Total Spent', 'Avg Order', 'Last Order']}
                      rows={customers.top_customers.slice(0, 15).map((c) => [
                        c.name || '-',
                        c.email?.substring(0, 30) || '-',
                        c.order_count,
                        formatPrice(c.total_spent),
                        formatPrice(c.avg_order_value),
                        c.last_order ? new Date(c.last_order).toLocaleDateString('en-GB') : '-',
                      ])}
                      footerContent={`Top ${Math.min(15, customers.top_customers.length)} customers`}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Customer Insights */}
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Customer Insights</Text>
                  <InlineStack gap="800">
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Repeat Rate</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ width: '100px' }}>
                          <ProgressBar
                            progress={parseFloat(customers.summary?.repeat_rate_pct) || 0}
                            tone={parseFloat(customers.summary?.repeat_rate_pct) >= 30 ? 'success' : 'primary'}
                          />
                        </div>
                        <Text variant="bodyMd" fontWeight="semibold">{customers.summary?.repeat_rate_pct}%</Text>
                      </InlineStack>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">One-time Buyers</Text>
                      <Text variant="headingMd">
                        {(customers.summary?.total_customers || 0) - (customers.summary?.repeat_customers || 0)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">High-Value Customers (3+ orders)</Text>
                      <Text variant="headingMd">
                        {customers.top_customers?.filter(c => c.order_count >= 3).length || 0}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          )}
        </Tabs>

        {/* Info Banner */}
        <Banner tone="info">
          <p>
            <strong>Profitability Analytics:</strong> Revenue shows gross order values. Profit calculations
            use COGS from BOM component costs. Actual profitability may vary based on shipping, fees, and
            overhead not captured here.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
