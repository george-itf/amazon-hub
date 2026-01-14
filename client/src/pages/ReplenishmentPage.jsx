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
  TextField,
  Select,
  Button,
  ProgressBar,
} from '@shopify/polaris';
import { getComponents, getOrders } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (!pence) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * ReplenishmentPage - Smart inventory replenishment suggestions
 *
 * Shows components that need reordering based on:
 * - Current stock levels vs reorder points
 * - Pending order requirements
 * - Historical usage patterns
 */
export default function ReplenishmentPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [components, setComponents] = useState([]);
  const [orders, setOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [compData, ordersData] = await Promise.all([
        getComponents(),
        getOrders({ status: 'READY_TO_PICK,NEEDS_REVIEW' }),
      ]);
      setComponents(compData.components || []);
      setOrders(ordersData.orders || []);
    } catch (err) {
      console.error(err);
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to load data');
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Calculate required quantities from pending orders
  const componentRequirements = useMemo(() => {
    const requirements = {};

    // This would normally come from order lines with BOM expansion
    // For now, we'll show a simplified view
    orders.forEach((order) => {
      order.order_lines?.forEach((line) => {
        if (line.boms?.bom_components) {
          line.boms.bom_components.forEach((bc) => {
            const compId = bc.components?.id || bc.component_id;
            if (!requirements[compId]) {
              requirements[compId] = { required: 0, orders: 0 };
            }
            requirements[compId].required += (bc.qty_required || 1) * (line.quantity || 1);
            requirements[compId].orders += 1;
          });
        }
      });
    });

    return requirements;
  }, [orders]);

  // Analyze components and determine replenishment needs
  const replenishmentData = useMemo(() => {
    return components
      .map((comp) => {
        const available = comp.total_available ?? 0;
        const required = componentRequirements[comp.id]?.required || 0;
        const pendingOrders = componentRequirements[comp.id]?.orders || 0;
        const reorderPoint = 10; // Could be configurable per component
        const reorderQty = 50; // Could be configurable per component

        // Calculate priority
        let priority = 'ok';
        let priorityScore = 0;

        if (available <= 0) {
          priority = 'critical';
          priorityScore = 100;
        } else if (available < required) {
          priority = 'urgent';
          priorityScore = 80;
        } else if (available < reorderPoint) {
          priority = 'low';
          priorityScore = 50;
        } else if (available - required < reorderPoint) {
          priority = 'soon';
          priorityScore = 30;
        }

        // Calculate suggested order quantity
        const deficit = Math.max(0, required - available);
        const suggestedQty = deficit > 0
          ? Math.ceil(deficit / reorderQty) * reorderQty
          : available < reorderPoint ? reorderQty : 0;

        return {
          ...comp,
          available,
          required,
          pendingOrders,
          reorderPoint,
          deficit,
          suggestedQty,
          priority,
          priorityScore,
          estimatedCost: suggestedQty * (comp.cost_ex_vat_pence || 0),
        };
      })
      .filter((c) => c.priority !== 'ok') // Only show items needing attention
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }, [components, componentRequirements]);

  // Filter data
  const filteredData = useMemo(() => {
    return replenishmentData.filter((item) => {
      if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.internal_sku?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.brand?.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [replenishmentData, searchQuery, priorityFilter]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setPriorityFilter('all');
  };

  const hasFilters = searchQuery || priorityFilter !== 'all';

  // Calculate summary stats
  const criticalCount = replenishmentData.filter((c) => c.priority === 'critical').length;
  const urgentCount = replenishmentData.filter((c) => c.priority === 'urgent').length;
  const lowCount = replenishmentData.filter((c) => c.priority === 'low').length;
  const totalEstimatedCost = replenishmentData.reduce((sum, c) => sum + (c.estimatedCost || 0), 0);

  function getPriorityBadge(priority) {
    const badges = {
      critical: <Badge tone="critical">Critical - Out of Stock</Badge>,
      urgent: <Badge tone="warning">Urgent - Below Required</Badge>,
      low: <Badge tone="attention">Low Stock</Badge>,
      soon: <Badge tone="info">Reorder Soon</Badge>,
      ok: <Badge tone="success">OK</Badge>,
    };
    return badges[priority] || <Badge>{priority}</Badge>;
  }

  const rows = filteredData.map((item) => [
    <Text variant="bodyMd" fontWeight="semibold" key={item.id}>
      {item.internal_sku}
    </Text>,
    item.description || '-',
    <BlockStack gap="100" key={`stock-${item.id}`}>
      <Text variant="bodyMd">
        {item.available} available
        {item.required > 0 && <Text as="span" tone="subdued"> / {item.required} required</Text>}
      </Text>
      {item.available > 0 && item.required > 0 && (
        <ProgressBar
          progress={Math.min(100, (item.available / item.required) * 100)}
          tone={item.available >= item.required ? 'success' : 'critical'}
          size="small"
        />
      )}
    </BlockStack>,
    getPriorityBadge(item.priority),
    item.suggestedQty > 0 ? (
      <BlockStack gap="100" key={`suggest-${item.id}`}>
        <Text variant="bodyMd" fontWeight="semibold">{item.suggestedQty} units</Text>
        <Text variant="bodySm" tone="subdued">{formatPrice(item.estimatedCost)}</Text>
      </BlockStack>
    ) : '-',
  ]);

  if (loading) {
    return (
      <Page title="Replenishment">
        <Card>
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <Spinner accessibilityLabel="Loading replenishment data" size="large" />
            <br /><br />
            <Text tone="subdued">Analyzing inventory levels and order requirements...</Text>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Replenishment Planner"
      subtitle={replenishmentData.length > 0
        ? `${replenishmentData.length} items need attention`
        : 'All stock levels healthy'}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Summary Stats */}
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Critical</Text>
                <Text variant="headingLg" fontWeight="bold" tone={criticalCount > 0 ? 'critical' : undefined}>
                  {criticalCount}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Urgent</Text>
                <Text variant="headingLg" fontWeight="bold" tone={urgentCount > 0 ? 'warning' : undefined}>
                  {urgentCount}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Low Stock</Text>
                <Text variant="headingLg" fontWeight="bold">
                  {lowCount}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Est. Reorder Cost</Text>
                <Text variant="headingLg" fontWeight="bold">
                  {formatPrice(totalEstimatedCost)}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Search and Filter */}
        <Card>
          <InlineStack gap="400" wrap={false}>
            <div style={{ flex: 1 }}>
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by SKU, description..."
                value={searchQuery}
                onChange={setSearchQuery}
                clearButton
                onClearButtonClick={() => setSearchQuery('')}
                autoComplete="off"
              />
            </div>
            <Select
              label="Priority"
              labelHidden
              options={[
                { label: 'All priorities', value: 'all' },
                { label: 'Critical - Out of Stock', value: 'critical' },
                { label: 'Urgent - Below Required', value: 'urgent' },
                { label: 'Low Stock', value: 'low' },
                { label: 'Reorder Soon', value: 'soon' },
              ]}
              value={priorityFilter}
              onChange={setPriorityFilter}
            />
            {hasFilters && (
              <Button onClick={handleClearFilters}>Clear</Button>
            )}
          </InlineStack>
        </Card>

        {/* Replenishment Table */}
        <Card>
          {replenishmentData.length === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">All stock levels are healthy</Text>
                <Text tone="subdued">
                  No components are below their reorder points. Great job keeping inventory stocked!
                </Text>
              </BlockStack>
            </div>
          ) : filteredData.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No matching items</Text>
                <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                <Button onClick={handleClearFilters}>Clear filters</Button>
              </BlockStack>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text']}
              headings={['SKU', 'Description', 'Stock Status', 'Priority', 'Suggested Order']}
              rows={rows}
              footerContent={`${filteredData.length} item(s) need attention`}
            />
          )}
        </Card>

        {/* Info Banner */}
        <Banner tone="info">
          <p>
            <strong>How this works:</strong> Components are flagged based on current stock levels, pending order requirements,
            and reorder points. Suggested quantities are rounded up to standard order quantities.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
