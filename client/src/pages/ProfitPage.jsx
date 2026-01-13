import React, { useEffect, useState, useMemo } from 'react';
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
} from '@shopify/polaris';
import { getOrders } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (!pence && pence !== 0) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100);
}

/**
 * ProfitPage - Order analytics and revenue overview
 *
 * Shows key metrics about orders and revenue to help track
 * business performance. This is a read-only analytics view
 * that doesn't affect operational logic.
 */
export default function ProfitPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [dateRange, setDateRange] = useState('30');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getOrders({ limit: 500 });
      setOrders(data.orders || []);
    } catch (err) {
      console.error(err);
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to load orders');
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Filter orders by date range
  const filteredOrders = useMemo(() => {
    const days = parseInt(dateRange);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return orders.filter((order) => {
      if (dateRange === 'all') return true;
      const orderDate = new Date(order.order_date || order.created_at);
      return orderDate >= cutoff;
    });
  }, [orders, dateRange]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalOrders = filteredOrders.length;
    const totalRevenue = filteredOrders.reduce((sum, o) => sum + (o.total_price_pence || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Status breakdown
    const statusCounts = {};
    filteredOrders.forEach((o) => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    });

    // Revenue by status
    const revenueByStatus = {};
    filteredOrders.forEach((o) => {
      revenueByStatus[o.status] = (revenueByStatus[o.status] || 0) + (o.total_price_pence || 0);
    });

    // Orders by day (last 7 days)
    const ordersByDay = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      ordersByDay[key] = { count: 0, revenue: 0 };
    }
    filteredOrders.forEach((o) => {
      const dateKey = (o.order_date || o.created_at || '').split('T')[0];
      if (ordersByDay[dateKey]) {
        ordersByDay[dateKey].count += 1;
        ordersByDay[dateKey].revenue += o.total_price_pence || 0;
      }
    });

    // Top items by quantity
    const itemCounts = {};
    filteredOrders.forEach((o) => {
      o.order_lines?.forEach((line) => {
        const key = line.title || line.sku || line.asin || 'Unknown';
        if (!itemCounts[key]) {
          itemCounts[key] = { title: key, quantity: 0, revenue: 0 };
        }
        itemCounts[key].quantity += line.quantity || 1;
        itemCounts[key].revenue += (line.unit_price_pence || 0) * (line.quantity || 1);
      });
    });
    const topItems = Object.values(itemCounts)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // Calculate daily averages
    const days = parseInt(dateRange) || 30;
    const dailyAvgOrders = totalOrders / days;
    const dailyAvgRevenue = totalRevenue / days;

    return {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      statusCounts,
      revenueByStatus,
      ordersByDay,
      topItems,
      dailyAvgOrders,
      dailyAvgRevenue,
    };
  }, [filteredOrders, dateRange]);

  const statusLabels = {
    IMPORTED: 'Imported',
    NEEDS_REVIEW: 'Needs Review',
    READY_TO_PICK: 'Ready to Pick',
    IN_BATCH: 'In Batch',
    PICKED: 'Picked',
    DISPATCHED: 'Dispatched',
    CANCELLED: 'Cancelled',
  };

  const statusOrder = ['DISPATCHED', 'PICKED', 'IN_BATCH', 'READY_TO_PICK', 'NEEDS_REVIEW', 'IMPORTED', 'CANCELLED'];

  if (loading) {
    return (
      <Page title="Analytics">
        <Card>
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <Spinner accessibilityLabel="Loading analytics" size="large" />
            <br /><br />
            <Text tone="subdued">Crunching the numbers...</Text>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Analytics & Revenue"
      subtitle="Order performance and revenue metrics"
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Date Range Selector */}
        <Card>
          <InlineStack gap="400" blockAlign="center">
            <Text variant="bodyMd">Time Period:</Text>
            <Select
              label="Date Range"
              labelHidden
              options={[
                { label: 'Last 7 days', value: '7' },
                { label: 'Last 30 days', value: '30' },
                { label: 'Last 90 days', value: '90' },
                { label: 'All time', value: 'all' },
              ]}
              value={dateRange}
              onChange={setDateRange}
            />
          </InlineStack>
        </Card>

        {/* Key Metrics */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Total Orders</Text>
                <Text variant="heading2xl" fontWeight="bold">
                  {metrics.totalOrders}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  ~{metrics.dailyAvgOrders.toFixed(1)} per day
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Total Revenue</Text>
                <Text variant="heading2xl" fontWeight="bold">
                  {formatPrice(metrics.totalRevenue)}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  ~{formatPrice(metrics.dailyAvgRevenue)} per day
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Avg Order Value</Text>
                <Text variant="heading2xl" fontWeight="bold">
                  {formatPrice(metrics.avgOrderValue)}
                </Text>
                <Text variant="bodySm" tone="subdued">
                  Per order
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          {/* Order Status Breakdown */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Orders by Status</Text>
                <DataTable
                  columnContentTypes={['text', 'numeric', 'numeric']}
                  headings={['Status', 'Orders', 'Revenue']}
                  rows={statusOrder
                    .filter((s) => metrics.statusCounts[s])
                    .map((status) => [
                      <Badge key={status} tone={status === 'CANCELLED' ? 'critical' : status === 'DISPATCHED' ? 'success' : 'default'}>
                        {statusLabels[status] || status}
                      </Badge>,
                      metrics.statusCounts[status] || 0,
                      formatPrice(metrics.revenueByStatus[status] || 0),
                    ])}
                  footerContent={`${metrics.totalOrders} total orders`}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Top Products */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Top Products (by quantity)</Text>
                {metrics.topItems.length === 0 ? (
                  <Text tone="subdued">No product data available</Text>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'numeric', 'numeric']}
                    headings={['Product', 'Qty Sold', 'Revenue']}
                    rows={metrics.topItems.map((item) => [
                      <Text variant="bodySm" key={item.title}>
                        {item.title.length > 40 ? item.title.substring(0, 40) + '...' : item.title}
                      </Text>,
                      item.quantity,
                      formatPrice(item.revenue),
                    ])}
                    footerContent={`Top ${metrics.topItems.length} products`}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Daily Trend */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd">Last 7 Days</Text>
            <DataTable
              columnContentTypes={['text', 'numeric', 'numeric']}
              headings={['Date', 'Orders', 'Revenue']}
              rows={Object.entries(metrics.ordersByDay).map(([date, data]) => {
                const displayDate = new Date(date).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                });
                return [
                  displayDate,
                  data.count,
                  formatPrice(data.revenue),
                ];
              })}
            />
          </BlockStack>
        </Card>

        {/* Info Banner */}
        <Banner tone="info">
          <p>
            <strong>Note:</strong> These analytics are based on order data imported from Shopify.
            Revenue figures show gross order values before fees and costs.
            Full profit calculation including fees and COGS will be available in a future update.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
