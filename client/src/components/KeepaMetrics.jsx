import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Spinner,
  Button,
  Tooltip,
  Divider,
  ProgressBar,
} from '@shopify/polaris';
import { getKeepaProduct, getKeepaMetrics } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined || pence < 0) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Format large numbers with K/M suffix
 */
function formatNumber(num) {
  if (num === null || num === undefined || num < 0) return '-';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
}

/**
 * Calculate trend from historical data
 */
function calculateTrend(current, historical) {
  if (!current || !historical || historical.length < 2) return null;

  // Get average from first half vs second half
  const midpoint = Math.floor(historical.length / 2);
  const firstHalf = historical.slice(0, midpoint);
  const secondHalf = historical.slice(midpoint);

  const firstAvg = firstHalf.reduce((a, b) => a + (b || 0), 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + (b || 0), 0) / secondHalf.length;

  if (firstAvg === 0) return null;
  const change = ((secondAvg - firstAvg) / firstAvg) * 100;

  return {
    direction: change > 5 ? 'up' : change < -5 ? 'down' : 'stable',
    percent: Math.abs(change).toFixed(1),
  };
}

/**
 * Mini sparkline chart component
 */
function Sparkline({ data, color = '#2563EB', height = 40, label }) {
  if (!data || data.length === 0) return null;

  // Filter out invalid values
  const validData = data.filter(v => v !== null && v !== undefined && v >= 0);
  if (validData.length < 2) return null;

  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const range = max - min || 1;

  const width = 120;
  const points = validData.map((value, i) => {
    const x = (i / (validData.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <Text variant="bodySm" tone="subdued">{label}</Text>}
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Highlight current value */}
        <circle
          cx={width}
          cy={height - ((validData[validData.length - 1] - min) / range) * (height - 4)}
          r="3"
          fill={color}
        />
      </svg>
    </div>
  );
}

/**
 * Trend indicator component
 */
function TrendIndicator({ trend, inverted = false }) {
  if (!trend) return null;

  // For sales rank, lower is better (inverted)
  const isGood = inverted
    ? trend.direction === 'down'
    : trend.direction === 'up';

  const color = trend.direction === 'stable'
    ? 'subdued'
    : isGood ? 'success' : 'critical';

  const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';

  return (
    <Text variant="bodySm" tone={color}>
      {arrow} {trend.percent}%
    </Text>
  );
}

/**
 * Sales Rank Badge with context
 */
function SalesRankBadge({ rank, category }) {
  if (!rank || rank < 0) return <Badge>No rank</Badge>;

  // Determine rank quality
  let tone = 'info';
  let label = 'Good';

  if (rank <= 1000) {
    tone = 'success';
    label = 'Excellent';
  } else if (rank <= 10000) {
    tone = 'success';
    label = 'Very Good';
  } else if (rank <= 50000) {
    tone = 'info';
    label = 'Good';
  } else if (rank <= 100000) {
    tone = 'attention';
    label = 'Average';
  } else {
    tone = 'warning';
    label = 'Low';
  }

  return (
    <Tooltip content={`${label} sales velocity${category ? ` in ${category}` : ''}`}>
      <Badge tone={tone}>#{formatNumber(rank)}</Badge>
    </Tooltip>
  );
}

/**
 * Competition indicator based on offer count
 */
function CompetitionIndicator({ offerCount }) {
  if (offerCount === null || offerCount === undefined || offerCount < 0) {
    return <Text variant="bodySm" tone="subdued">-</Text>;
  }

  let tone = 'success';
  let label = 'Low';

  if (offerCount <= 3) {
    tone = 'success';
    label = 'Low';
  } else if (offerCount <= 10) {
    tone = 'info';
    label = 'Medium';
  } else if (offerCount <= 25) {
    tone = 'attention';
    label = 'High';
  } else {
    tone = 'warning';
    label = 'Very High';
  }

  return (
    <Tooltip content={`${offerCount} sellers competing on this listing`}>
      <Badge tone={tone}>{offerCount} sellers</Badge>
    </Tooltip>
  );
}

/**
 * Rating display with stars approximation
 */
function RatingDisplay({ rating, reviewCount }) {
  if (!rating || rating < 0) return <Text variant="bodySm" tone="subdued">No ratings</Text>;

  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;

  let tone = 'info';
  if (rating >= 4.5) tone = 'success';
  else if (rating >= 4.0) tone = 'info';
  else if (rating >= 3.5) tone = 'attention';
  else tone = 'warning';

  return (
    <InlineStack gap="100" blockAlign="center">
      <Badge tone={tone}>{rating.toFixed(1)}</Badge>
      {reviewCount !== undefined && reviewCount >= 0 && (
        <Text variant="bodySm" tone="subdued">({formatNumber(reviewCount)} reviews)</Text>
      )}
    </InlineStack>
  );
}

/**
 * Compact Keepa metrics display for tables/lists
 */
export function KeepaMetricsCompact({ asin, showPrice = true, showRank = true, showRating = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!asin) return;

    let mounted = true;

    async function loadData() {
      setLoading(true);
      try {
        const result = await getKeepaProduct(asin, false);
        if (mounted) setData(result);
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();
    return () => { mounted = false; };
  }, [asin]);

  if (loading) return <Spinner size="small" />;
  if (error || !data) return <Text variant="bodySm" tone="subdued">-</Text>;

  const payload = data.payload;
  if (!payload) return <Text variant="bodySm" tone="subdued">-</Text>;

  return (
    <InlineStack gap="200" wrap blockAlign="center">
      {showPrice && payload.buybox_price_pence && (
        <Tooltip content="Current Buy Box price">
          <Text variant="bodySm" fontWeight="semibold">
            {formatPrice(payload.buybox_price_pence)}
          </Text>
        </Tooltip>
      )}
      {showRank && payload.sales_rank && (
        <SalesRankBadge rank={payload.sales_rank} />
      )}
      {showRating && payload.rating && (
        <Badge tone={payload.rating >= 4.0 ? 'success' : 'info'}>
          {payload.rating.toFixed(1)}★
        </Badge>
      )}
    </InlineStack>
  );
}

/**
 * Full Keepa metrics panel with charts and detailed data
 */
export default function KeepaMetrics({ asin, showCharts = true, compact = false }) {
  const [product, setProduct] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!asin) return;

    setLoading(true);
    setError(null);

    try {
      const [productData, metricsData] = await Promise.all([
        getKeepaProduct(asin, forceRefresh),
        showCharts ? getKeepaMetrics(asin, 30).catch(() => null) : Promise.resolve(null),
      ]);

      setProduct(productData);
      setMetrics(metricsData);
    } catch (err) {
      setError(err.message || 'Failed to load Keepa data');
    } finally {
      setLoading(false);
    }
  }, [asin, showCharts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text variant="bodySm" tone="subdued">Loading market data...</Text>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text variant="headingSm">Market Data</Text>
            <Button size="slim" onClick={handleRefresh} loading={refreshing}>
              Retry
            </Button>
          </InlineStack>
          <Text variant="bodySm" tone="critical">{error}</Text>
        </BlockStack>
      </Card>
    );
  }

  if (!product?.payload) {
    return (
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text variant="headingSm">Market Data</Text>
            <Button size="slim" onClick={handleRefresh} loading={refreshing}>
              Fetch Data
            </Button>
          </InlineStack>
          <Text variant="bodySm" tone="subdued">
            No Keepa data available for this ASIN. Click to fetch.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const payload = product.payload;
  const fromCache = product.from_cache;
  const fetchedAt = product.fetched_at ? new Date(product.fetched_at) : null;

  // Extract historical data for charts
  const priceHistory = metrics?.map(m => m.buybox_price_pence).filter(p => p > 0) || [];
  const rankHistory = metrics?.map(m => m.sales_rank).filter(r => r > 0) || [];

  // Calculate trends
  const priceTrend = calculateTrend(payload.buybox_price_pence, priceHistory);
  const rankTrend = calculateTrend(payload.sales_rank, rankHistory);

  if (compact) {
    return (
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text variant="headingSm">Market Data</Text>
            <InlineStack gap="100" blockAlign="center">
              {fromCache && (
                <Badge tone="info" size="small">Cached</Badge>
              )}
              <Button size="slim" onClick={handleRefresh} loading={refreshing}>
                Refresh
              </Button>
            </InlineStack>
          </InlineStack>

          <InlineStack gap="600" wrap>
            {/* Price */}
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Buy Box</Text>
              <InlineStack gap="100" blockAlign="center">
                <Text variant="bodyMd" fontWeight="bold">
                  {formatPrice(payload.buybox_price_pence)}
                </Text>
                <TrendIndicator trend={priceTrend} />
              </InlineStack>
            </BlockStack>

            {/* Sales Rank */}
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Sales Rank</Text>
              <InlineStack gap="100" blockAlign="center">
                <SalesRankBadge rank={payload.sales_rank} category={payload.category} />
                <TrendIndicator trend={rankTrend} inverted />
              </InlineStack>
            </BlockStack>

            {/* Competition */}
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Competition</Text>
              <CompetitionIndicator offerCount={payload.offer_count} />
            </BlockStack>

            {/* Rating */}
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Rating</Text>
              <RatingDisplay rating={payload.rating} reviewCount={payload.review_count} />
            </BlockStack>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <InlineStack align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingSm">Market Data</Text>
            {fromCache && (
              <Tooltip content={fetchedAt ? `Last updated: ${fetchedAt.toLocaleString()}` : 'Cached data'}>
                <Badge tone="info">Cached</Badge>
              </Tooltip>
            )}
          </InlineStack>
          <Button size="slim" onClick={handleRefresh} loading={refreshing}>
            Refresh
          </Button>
        </InlineStack>

        <Divider />

        {/* Key Metrics Row */}
        <InlineStack gap="600" wrap>
          {/* Current Price */}
          <BlockStack gap="200">
            <Text variant="bodySm" tone="subdued">Buy Box Price</Text>
            <InlineStack gap="100" blockAlign="center">
              <Text variant="headingLg" fontWeight="bold">
                {formatPrice(payload.buybox_price_pence)}
              </Text>
              <TrendIndicator trend={priceTrend} />
            </InlineStack>
            {payload.amazon_price_pence && payload.amazon_price_pence !== payload.buybox_price_pence && (
              <Text variant="bodySm" tone="subdued">
                Amazon: {formatPrice(payload.amazon_price_pence)}
              </Text>
            )}
          </BlockStack>

          {/* Sales Rank */}
          <BlockStack gap="200">
            <Text variant="bodySm" tone="subdued">Sales Rank</Text>
            <InlineStack gap="100" blockAlign="center">
              <SalesRankBadge rank={payload.sales_rank} category={payload.category} />
              <TrendIndicator trend={rankTrend} inverted />
            </InlineStack>
            {payload.category && (
              <Text variant="bodySm" tone="subdued" truncate>
                in {payload.category}
              </Text>
            )}
          </BlockStack>

          {/* Competition */}
          <BlockStack gap="200">
            <Text variant="bodySm" tone="subdued">Competition</Text>
            <CompetitionIndicator offerCount={payload.offer_count} />
            {payload.new_offer_count !== undefined && (
              <Text variant="bodySm" tone="subdued">
                {payload.new_offer_count} new offers
              </Text>
            )}
          </BlockStack>

          {/* Rating & Reviews */}
          <BlockStack gap="200">
            <Text variant="bodySm" tone="subdued">Customer Rating</Text>
            <RatingDisplay rating={payload.rating} reviewCount={payload.review_count} />
          </BlockStack>
        </InlineStack>

        {/* Charts */}
        {showCharts && metrics && metrics.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="300">
              <Text variant="headingSm">30-Day Trends</Text>
              <InlineStack gap="600" wrap>
                {priceHistory.length > 1 && (
                  <Sparkline
                    data={priceHistory}
                    color="#2563EB"
                    label="Price"
                    height={50}
                  />
                )}
                {rankHistory.length > 1 && (
                  <Sparkline
                    data={rankHistory.map(r => -r)} // Invert for display (lower is better)
                    color="#16A34A"
                    label="Rank (inverted)"
                    height={50}
                  />
                )}
              </InlineStack>
            </BlockStack>
          </>
        )}

        {/* Additional Info */}
        {(payload.title || payload.brand) && (
          <>
            <Divider />
            <BlockStack gap="200">
              {payload.title && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Product Title</Text>
                  <Text variant="bodySm">{payload.title}</Text>
                </BlockStack>
              )}
              {payload.brand && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Brand</Text>
                  <Text variant="bodySm">{payload.brand}</Text>
                </BlockStack>
              )}
            </BlockStack>
          </>
        )}

        {/* Timestamps */}
        {fetchedAt && (
          <Text variant="bodySm" tone="subdued">
            Data from {fetchedAt.toLocaleDateString()} at {fetchedAt.toLocaleTimeString()}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Keepa status card for dashboards
 */
export function KeepaStatusCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStatus() {
      try {
        const { getKeepaStatus } = await import('../utils/api.jsx');
        const data = await getKeepaStatus();
        setStatus(data);
      } catch (err) {
        console.error('Failed to load Keepa status:', err);
      } finally {
        setLoading(false);
      }
    }
    loadStatus();
  }, []);

  if (loading) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm">Keepa API</Text>
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  if (!status?.configured) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm">Keepa API</Text>
          <Badge tone="critical">Not Configured</Badge>
          <Text variant="bodySm" tone="subdued">
            Set KEEPA_API_KEY to enable market data
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const hourlyUsed = status.budget?.tokens_spent_hour || 0;
  const hourlyMax = status.budget?.max_tokens_per_hour || 800;
  const dailyUsed = status.budget?.tokens_spent_day || 0;
  const dailyMax = status.budget?.max_tokens_per_day || 6000;

  const hourlyPercent = (hourlyUsed / hourlyMax) * 100;
  const dailyPercent = (dailyUsed / dailyMax) * 100;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text variant="headingSm">Keepa API</Text>
          <Badge tone="success">Connected</Badge>
        </InlineStack>

        <Divider />

        {/* Hourly Budget */}
        <BlockStack gap="100">
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued">Hourly Budget</Text>
            <Text variant="bodySm">{hourlyUsed} / {hourlyMax}</Text>
          </InlineStack>
          <ProgressBar
            progress={hourlyPercent}
            tone={hourlyPercent > 80 ? 'critical' : hourlyPercent > 50 ? 'warning' : 'primary'}
            size="small"
          />
        </BlockStack>

        {/* Daily Budget */}
        <BlockStack gap="100">
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued">Daily Budget</Text>
            <Text variant="bodySm">{dailyUsed} / {dailyMax}</Text>
          </InlineStack>
          <ProgressBar
            progress={dailyPercent}
            tone={dailyPercent > 80 ? 'critical' : dailyPercent > 50 ? 'warning' : 'primary'}
            size="small"
          />
        </BlockStack>

        {/* Cache Stats */}
        {status.cache && (
          <InlineStack gap="300">
            <BlockStack gap="050">
              <Text variant="bodySm" tone="subdued">Cached</Text>
              <Text variant="bodyMd" fontWeight="semibold">{status.cache.total || 0}</Text>
            </BlockStack>
            <BlockStack gap="050">
              <Text variant="bodySm" tone="subdued">Fresh</Text>
              <Text variant="bodyMd" fontWeight="semibold">{status.cache.fresh || 0}</Text>
            </BlockStack>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
