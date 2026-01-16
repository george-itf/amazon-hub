import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
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
  Tabs,
  ProgressBar,
  Tooltip,
  Icon,
  EmptyState,
} from '@shopify/polaris';
import {
  AlertCircleIcon,
  ClockIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  InventoryIcon,
  ChartVerticalFilledIcon,
  PackageIcon,
} from '@shopify/polaris-icons';
import {
  getAnalyticsHubSummary,
  getAnalyticsHubDeadStock,
  getAnalyticsHubMovers,
  getAnalyticsHubProfitability,
  getAnalyticsHubStockRisk,
  getAnalyticsHubDataQuality,
} from '../utils/api.jsx';
import { InvictaLoading } from '../components/ui/index.jsx';
import { useProductModal } from '../context/ProductModalContext.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence, showSign = false) {
  if (pence === null || pence === undefined) return '-';
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
  if (num === null || num === undefined) return '-';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Format percentage
 */
function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(decimals)}%`;
}

/**
 * Format days ago
 */
function formatDaysAgo(dateStr) {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/**
 * KPI Card Component - Uses design system
 * Memoized to prevent unnecessary re-renders
 */
const KPICard = memo(function KPICard({ title, value, subtitle, tone, icon, onClick }) {
  const toneToClass = {
    success: 'hub-stat-card--success',
    warning: 'hub-stat-card--warning',
    critical: 'hub-stat-card--critical',
  };

  return (
    <div
      className={`hub-stat-card ${onClick ? 'hub-stat-card--clickable' : ''} ${toneToClass[tone] || ''}`}
      onClick={onClick}
    >
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="bodySm" tone="subdued">{title}</Text>
          {icon && <Icon source={icon} tone="subdued" />}
        </InlineStack>
        <Text variant="heading2xl" fontWeight="bold" tone={tone}>
          {value}
        </Text>
        {subtitle && (
          <Text variant="bodySm" tone="subdued">{subtitle}</Text>
        )}
      </BlockStack>
    </div>
  );
});

/**
 * Data Quality Banner Component - Memoized
 */
const DataQualityBanner = memo(function DataQualityBanner({ warnings, onDismiss }) {
  if (!warnings || warnings.length === 0) return null;

  const criticalWarnings = warnings.filter(w => w.severity === 'critical');
  const otherWarnings = warnings.filter(w => w.severity !== 'critical');

  return (
    <BlockStack gap="200">
      {criticalWarnings.length > 0 && (
        <Banner tone="critical" onDismiss={onDismiss}>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold">Data Quality Issues</Text>
            {criticalWarnings.map((w, i) => (
              <Text key={i} variant="bodySm">
                {w.message} ({w.count} affected)
              </Text>
            ))}
          </BlockStack>
        </Banner>
      )}
      {otherWarnings.length > 0 && (
        <Banner tone="warning" onDismiss={onDismiss}>
          <BlockStack gap="100">
            <Text variant="bodyMd" fontWeight="semibold">Analytics Accuracy Warnings</Text>
            {otherWarnings.slice(0, 3).map((w, i) => (
              <Text key={i} variant="bodySm">
                {w.message} ({w.count} affected)
              </Text>
            ))}
            {otherWarnings.length > 3 && (
              <Text variant="bodySm" tone="subdued">
                +{otherWarnings.length - 3} more warnings
              </Text>
            )}
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
});

/**
 * Change Badge with arrow - Memoized
 */
const ChangeBadge = memo(function ChangeBadge({ change, suffix = '%' }) {
  if (change === null || change === undefined) return <Badge>-</Badge>;
  const isPositive = change > 0;
  const isNegative = change < 0;
  const value = Math.abs(change).toFixed(1);

  return (
    <Badge tone={isPositive ? 'success' : isNegative ? 'critical' : undefined}>
      <InlineStack gap="100" blockAlign="center">
        {isPositive && <Icon source={ArrowUpIcon} />}
        {isNegative && <Icon source={ArrowDownIcon} />}
        <span>{isPositive ? '+' : isNegative ? '-' : ''}{value}{suffix}</span>
      </InlineStack>
    </Badge>
  );
});

/**
 * Days of Cover Badge - Memoized
 */
const DaysOfCoverBadge = memo(function DaysOfCoverBadge({ days }) {
  if (days === null || days === undefined) return <Badge>-</Badge>;
  if (days === Infinity || days > 365) return <Badge tone="success">365+ days</Badge>;
  if (days === 0) return <Badge tone="critical">Out of stock</Badge>;
  if (days <= 7) return <Badge tone="critical">{days} days</Badge>;
  if (days <= 14) return <Badge tone="warning">{days} days</Badge>;
  if (days <= 30) return <Badge tone="info">{days} days</Badge>;
  return <Badge tone="success">{days} days</Badge>;
});

/**
 * Analytics Hub Page
 * Comprehensive analytics dashboard for inventory and profitability insights
 */
export default function AnalyticsHubPage() {
  const { openProductModal } = useProductModal();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);

  // Data state
  const [summary, setSummary] = useState(null);
  const [deadStock, setDeadStock] = useState([]);
  const [movers, setMovers] = useState({ gainers: [], losers: [], new_winners: [] });
  const [profitability, setProfitability] = useState([]);
  const [stockRisk, setStockRisk] = useState([]);
  const [dataQuality, setDataQuality] = useState([]);

  // Filter state
  const [daysBack, setDaysBack] = useState('30');
  const [deadStockDays, setDeadStockDays] = useState('90');
  const [showDataWarnings, setShowDataWarnings] = useState(true);

  // Load all analytics data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        summaryData,
        deadStockData,
        moversData,
        profitData,
        riskData,
        qualityData,
      ] = await Promise.all([
        getAnalyticsHubSummary({ days_back: daysBack }),
        getAnalyticsHubDeadStock({ days_threshold: deadStockDays, limit: 50 }),
        getAnalyticsHubMovers({ limit: 10 }),
        getAnalyticsHubProfitability({ days_back: daysBack, limit: 50 }),
        getAnalyticsHubStockRisk({ days_threshold: 14, limit: 50 }),
        getAnalyticsHubDataQuality(),
      ]);

      setSummary(summaryData);
      setDeadStock(deadStockData.items || []);
      setMovers(moversData);
      setProfitability(profitData.items || []);
      setStockRisk(riskData.items || []);
      setDataQuality(qualityData.warnings || []);
    } catch (err) {
      console.error('Analytics Hub load error:', err);
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [daysBack, deadStockDays]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const tabs = [
    { id: 'dead-stock', content: 'Dead Stock', icon: PackageIcon },
    { id: 'movers', content: 'Movers', icon: ChartVerticalFilledIcon },
    { id: 'profitability', content: 'Profitability', icon: ChartVerticalFilledIcon },
    { id: 'stock-risk', content: 'Stock Risk', icon: AlertCircleIcon },
  ];

  if (loading && !summary) {
    return (
      <Page title="Analytics Hub">
        <InvictaLoading message="Loading analytics..." />
      </Page>
    );
  }

  return (
    <Page
      title="Analytics Hub"
      subtitle="Inventory intelligence and profitability insights"
      secondaryActions={[
        { content: 'Refresh', onAction: loadData, disabled: loading },
      ]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Data Quality Warnings */}
        {showDataWarnings && dataQuality.length > 0 && (
          <DataQualityBanner
            warnings={dataQuality}
            onDismiss={() => setShowDataWarnings(false)}
          />
        )}

        {/* Filters */}
        <Card>
          <InlineStack gap="400" blockAlign="center" wrap>
            <Text variant="bodyMd" fontWeight="semibold">Period:</Text>
            <Select
              label="Days back"
              labelHidden
              options={[
                { label: 'Last 7 days', value: '7' },
                { label: 'Last 30 days', value: '30' },
                { label: 'Last 60 days', value: '60' },
                { label: 'Last 90 days', value: '90' },
              ]}
              value={daysBack}
              onChange={setDaysBack}
            />
            {loading && <Spinner size="small" />}
          </InlineStack>
        </Card>

        {/* KPI Cards Row */}
        {summary && (
          <Layout>
            <Layout.Section variant="oneQuarter">
              <KPICard
                title="Revenue"
                value={formatPrice(summary.revenue_pence)}
                subtitle={`${summary.order_count || 0} orders`}
                icon={ChartVerticalFilledIcon}
              />
            </Layout.Section>
            <Layout.Section variant="oneQuarter">
              <KPICard
                title="Gross Profit"
                value={formatPrice(summary.profit_pence)}
                subtitle={`${formatPercent(summary.margin_percent)} margin`}
                tone={summary.margin_percent >= 25 ? 'success' : summary.margin_percent < 15 ? 'critical' : undefined}
                icon={ChartVerticalFilledIcon}
              />
            </Layout.Section>
            <Layout.Section variant="oneQuarter">
              <KPICard
                title="Dead Stock Value"
                value={formatPrice(summary.dead_stock_value_pence)}
                subtitle={`${summary.dead_stock_count || 0} components`}
                tone="critical"
                icon={PackageIcon}
                onClick={() => setSelectedTab(0)}
              />
            </Layout.Section>
            <Layout.Section variant="oneQuarter">
              <KPICard
                title="Stockout Risk"
                value={summary.stockout_soon_count || 0}
                subtitle="listings at risk (<14 days)"
                tone={summary.stockout_soon_count > 0 ? 'critical' : 'success'}
                icon={AlertCircleIcon}
                onClick={() => setSelectedTab(3)}
              />
            </Layout.Section>
          </Layout>
        )}

        {/* Tabbed Content */}
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
          {/* Dead Stock Tab */}
          {selectedTab === 0 && (
            <BlockStack gap="400">
              <Card>
                <InlineStack gap="400" blockAlign="center">
                  <Text variant="bodyMd">No sales in:</Text>
                  <Select
                    label="Days threshold"
                    labelHidden
                    options={[
                      { label: '30 days', value: '30' },
                      { label: '60 days', value: '60' },
                      { label: '90 days', value: '90' },
                      { label: '180 days', value: '180' },
                    ]}
                    value={deadStockDays}
                    onChange={setDeadStockDays}
                  />
                </InlineStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingSm">Dead Stock Components</Text>
                    <Text variant="bodySm" tone="subdued">
                      Total value: {formatPrice(deadStock.reduce((sum, d) => sum + (d.stock_value_pence || 0), 0))}
                    </Text>
                  </InlineStack>

                  {deadStock.length === 0 ? (
                    <EmptyState
                      heading="No dead stock found"
                      image=""
                    >
                      <p>All components have been sold within the threshold period.</p>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric', 'text', 'text']}
                      headings={['Component', 'On Hand', 'Stock Value', 'Last Sold', 'Days Stale']}
                      rows={deadStock.map((item) => [
                        <BlockStack key={item.id} gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">
                            {item.internal_sku}
                          </Text>
                          {item.description && (
                            <Text variant="bodySm" tone="subdued">
                              {item.description.substring(0, 40)}
                              {item.description.length > 40 ? '...' : ''}
                            </Text>
                          )}
                        </BlockStack>,
                        item.on_hand || 0,
                        formatPrice(item.stock_value_pence),
                        formatDaysAgo(item.last_sold_at),
                        <Badge
                          key="days"
                          tone={item.days_since_sold > 180 ? 'critical' : item.days_since_sold > 90 ? 'warning' : 'info'}
                        >
                          {item.days_since_sold || '∞'} days
                        </Badge>,
                      ])}
                      footerContent={`${deadStock.length} components with no recent sales`}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Dead Stock Actions */}
              {deadStock.length > 0 && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold">Recommendations</Text>
                    <Text variant="bodySm">
                      Consider discounting, bundling, or liquidating dead stock to free up cash.
                      Components not sold in 180+ days may need to be written off.
                    </Text>
                  </BlockStack>
                </Banner>
              )}
            </BlockStack>
          )}

          {/* Movers Tab */}
          {selectedTab === 1 && (
            <BlockStack gap="400">
              {/* Top Gainers */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={ArrowUpIcon} tone="success" />
                    <Text variant="headingSm">Top Gainers</Text>
                    <Text variant="bodySm" tone="subdued">(30d vs previous 30d)</Text>
                  </InlineStack>

                  {movers.gainers?.length === 0 ? (
                    <Text tone="subdued">No significant gainers in this period.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric', 'numeric']}
                      headings={['Listing', 'Units (30d)', 'Units (Prev)', 'Change']}
                      rows={(movers.gainers || []).map((item) => [
                        <BlockStack key={item.listing_memory_id} gap="100">
                          <button
                            onClick={() => openProductModal({ asin: item.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <Text variant="bodyMd" fontWeight="semibold">
                              <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                {item.title?.substring(0, 40) || item.asin}
                                {item.title?.length > 40 ? '...' : ''}
                              </span>
                            </Text>
                          </button>
                          {item.asin && <Text variant="bodySm" tone="subdued">ASIN: {item.asin}</Text>}
                        </BlockStack>,
                        item.units_current || 0,
                        item.units_previous || 0,
                        <ChangeBadge key="change" change={item.change_percent} />,
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Top Losers */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={ArrowDownIcon} tone="critical" />
                    <Text variant="headingSm">Top Losers</Text>
                    <Text variant="bodySm" tone="subdued">(30d vs previous 30d)</Text>
                  </InlineStack>

                  {movers.losers?.length === 0 ? (
                    <Text tone="subdued">No significant losers in this period.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric', 'numeric']}
                      headings={['Listing', 'Units (30d)', 'Units (Prev)', 'Change']}
                      rows={(movers.losers || []).map((item) => [
                        <BlockStack key={item.listing_memory_id} gap="100">
                          <button
                            onClick={() => openProductModal({ asin: item.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <Text variant="bodyMd" fontWeight="semibold">
                              <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                {item.title?.substring(0, 40) || item.asin}
                                {item.title?.length > 40 ? '...' : ''}
                              </span>
                            </Text>
                          </button>
                          {item.asin && <Text variant="bodySm" tone="subdued">ASIN: {item.asin}</Text>}
                        </BlockStack>,
                        item.units_current || 0,
                        item.units_previous || 0,
                        <ChangeBadge key="change" change={item.change_percent} />,
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* New Winners */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingSm">New Winners</Text>
                    <Badge tone="success">New</Badge>
                    <Text variant="bodySm" tone="subdued">(No sales in previous period)</Text>
                  </InlineStack>

                  {movers.new_winners?.length === 0 ? (
                    <Text tone="subdued">No new winners discovered in this period.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric']}
                      headings={['Listing', 'Units (30d)', 'Revenue']}
                      rows={(movers.new_winners || []).map((item) => [
                        <BlockStack key={item.listing_memory_id} gap="100">
                          <button
                            onClick={() => openProductModal({ asin: item.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <Text variant="bodyMd" fontWeight="semibold">
                              <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                {item.title?.substring(0, 40) || item.asin}
                                {item.title?.length > 40 ? '...' : ''}
                              </span>
                            </Text>
                          </button>
                          {item.asin && <Text variant="bodySm" tone="subdued">ASIN: {item.asin}</Text>}
                        </BlockStack>,
                        item.units_current || 0,
                        formatPrice(item.revenue_pence),
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          {/* Profitability Tab */}
          {selectedTab === 2 && (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingSm">Listing Profitability</Text>
                    <Text variant="bodySm" tone="subdued">Last {daysBack} days</Text>
                  </InlineStack>

                  {profitability.length === 0 ? (
                    <EmptyState
                      heading="No profitability data"
                      image=""
                    >
                      <p>No orders found in this period to calculate profitability.</p>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                      headings={['Listing', 'Orders', 'Revenue', 'COGS', 'Profit', 'Margin']}
                      rows={profitability.map((item) => [
                        <BlockStack key={item.listing_memory_id} gap="100">
                          <button
                            onClick={() => openProductModal({ asin: item.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <Text variant="bodyMd" fontWeight="semibold">
                              <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                {item.title?.substring(0, 35) || item.asin}
                                {item.title?.length > 35 ? '...' : ''}
                              </span>
                            </Text>
                          </button>
                          {item.sku && <Text variant="bodySm" tone="subdued">SKU: {item.sku}</Text>}
                        </BlockStack>,
                        item.order_count || 0,
                        formatPrice(item.revenue_pence),
                        formatPrice(item.cogs_pence),
                        <Text
                          key="profit"
                          tone={item.profit_pence > 0 ? 'success' : item.profit_pence < 0 ? 'critical' : undefined}
                        >
                          {formatPrice(item.profit_pence)}
                        </Text>,
                        <Badge
                          key="margin"
                          tone={
                            item.margin_percent >= 30 ? 'success' :
                            item.margin_percent >= 15 ? 'info' :
                            item.margin_percent >= 0 ? 'warning' : 'critical'
                          }
                        >
                          {formatPercent(item.margin_percent)}
                        </Badge>,
                      ])}
                      footerContent={`${profitability.length} listings analyzed`}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Margin Leaks */}
              {profitability.filter(p => p.margin_percent < 15).length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={AlertCircleIcon} tone="warning" />
                      <Text variant="headingSm">Margin Leaks</Text>
                    </InlineStack>
                    <Text variant="bodySm">
                      {profitability.filter(p => p.margin_percent < 15).length} listings have margins below 15%.
                      Review pricing or component costs.
                    </Text>
                    <BlockStack gap="100">
                      {profitability
                        .filter(p => p.margin_percent < 15)
                        .slice(0, 5)
                        .map(p => (
                          <InlineStack key={p.listing_memory_id} gap="200" blockAlign="center">
                            <Text variant="bodySm">{p.title?.substring(0, 30) || p.asin}</Text>
                            <Badge tone="critical">{formatPercent(p.margin_percent)} margin</Badge>
                          </InlineStack>
                        ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          )}

          {/* Stock Risk Tab */}
          {selectedTab === 3 && (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text variant="headingSm">Stock Risk Analysis</Text>
                    <InlineStack gap="200">
                      <Badge tone="critical">{stockRisk.filter(s => s.days_of_cover <= 7).length} critical</Badge>
                      <Badge tone="warning">{stockRisk.filter(s => s.days_of_cover > 7 && s.days_of_cover <= 14).length} warning</Badge>
                    </InlineStack>
                  </InlineStack>

                  {stockRisk.length === 0 ? (
                    <EmptyState
                      heading="No stock risk data"
                      image=""
                    >
                      <p>Unable to calculate stock risk. Check that BOMs and demand data are configured.</p>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'numeric', 'text', 'text']}
                      headings={['Listing', 'Buildable', 'Daily Demand', 'Days of Cover', 'Bottleneck']}
                      rows={stockRisk.map((item) => [
                        <BlockStack key={item.listing_memory_id} gap="100">
                          <button
                            onClick={() => openProductModal({ asin: item.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <Text variant="bodyMd" fontWeight="semibold">
                              <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                {item.title?.substring(0, 35) || item.asin}
                                {item.title?.length > 35 ? '...' : ''}
                              </span>
                            </Text>
                          </button>
                        </BlockStack>,
                        item.buildable_units || 0,
                        (item.predicted_units_per_day || 0).toFixed(2),
                        <DaysOfCoverBadge key="days" days={item.days_of_cover} />,
                        item.bottleneck_component ? (
                          <Tooltip content={`Only ${item.bottleneck_available} available`}>
                            <Badge tone="warning">{item.bottleneck_component}</Badge>
                          </Tooltip>
                        ) : (
                          <Text tone="subdued">-</Text>
                        ),
                      ])}
                      footerContent={`${stockRisk.length} listings analyzed`}
                    />
                  )}
                </BlockStack>
              </Card>

              {/* Stockout Soon Warning */}
              {stockRisk.filter(s => s.days_of_cover <= 7).length > 0 && (
                <Banner tone="critical">
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="semibold">Urgent: Stock Running Low</Text>
                    <Text variant="bodySm">
                      {stockRisk.filter(s => s.days_of_cover <= 7).length} listings have less than 7 days of stock cover.
                      Review replenishment orders immediately.
                    </Text>
                    <BlockStack gap="100">
                      {stockRisk
                        .filter(s => s.days_of_cover <= 7)
                        .slice(0, 3)
                        .map(s => (
                          <InlineStack key={s.listing_memory_id} gap="200">
                            <Text variant="bodySm">{s.title?.substring(0, 25) || s.asin}</Text>
                            <Badge tone="critical">{s.days_of_cover} days left</Badge>
                          </InlineStack>
                        ))}
                    </BlockStack>
                  </BlockStack>
                </Banner>
              )}

              {/* Replenishment Guidance */}
              <Banner tone="info">
                <BlockStack gap="100">
                  <Text variant="bodyMd" fontWeight="semibold">Stock Cover Guidelines</Text>
                  <Text variant="bodySm">
                    <strong>Critical (&lt;7 days):</strong> Immediate replenishment needed.
                    <strong> Warning (7-14 days):</strong> Order soon.
                    <strong> Healthy (&gt;14 days):</strong> Stock levels adequate.
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
          )}
        </Tabs>

        {/* Footer Info */}
        <Banner tone="info">
          <p>
            <strong>Analytics Hub:</strong> Data is calculated based on order history and current stock levels.
            Profitability uses BOM component costs. Demand predictions use historical sales and Keepa market data when available.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
