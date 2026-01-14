import React, { useEffect, useState, useMemo } from 'react';
import {
  Page,
  Card,
  DataTable,
  Spinner,
  Badge,
  Text,
  Modal,
  BlockStack,
  InlineStack,
  Divider,
  Banner,
  TextField,
  Select,
  Filters,
  ChoiceList,
  Button,
} from '@shopify/polaris';
import { importOrders, getOrders } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence, currency = 'GBP') {
  if (!pence) return '-';
  const pounds = pence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency,
  }).format(pounds);
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Get badge tone based on order status
 */
function getStatusBadge(status) {
  const statusMap = {
    IMPORTED: { tone: 'info', label: 'Imported' },
    NEEDS_REVIEW: { tone: 'warning', label: 'Needs Review' },
    READY_TO_PICK: { tone: 'success', label: 'Ready to Pick' },
    IN_BATCH: { tone: 'attention', label: 'In Batch' },
    PICKED: { tone: 'success', label: 'Picked' },
    DISPATCHED: { tone: 'success', label: 'Dispatched' },
    CANCELLED: { tone: 'critical', label: 'Cancelled' },
  };
  const config = statusMap[status] || { tone: 'default', label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

/**
 * OrdersPage - View and manage orders imported from Shopify
 */
export default function OrdersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [importing, setImporting] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState([]);

  async function loadOrders() {
    setLoading(true);
    setError(null);
    try {
      const data = await getOrders();
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
    loadOrders();
  }, []);

  async function handleImport() {
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const result = await importOrders();
      setImportResult(result);
      await loadOrders();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Import failed');
      setImportError(errorMsg);
    } finally {
      setImporting(false);
    }
  }

  // Filter and search orders
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter
      if (statusFilter.length > 0 && !statusFilter.includes(order.status)) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesOrder = order.external_order_id?.toLowerCase().includes(query);
        const matchesCustomer = (order.customer_name || order.customer_email || '').toLowerCase().includes(query);
        const matchesItem = order.order_lines?.some(
          (line) =>
            line.title?.toLowerCase().includes(query) ||
            line.asin?.toLowerCase().includes(query) ||
            line.sku?.toLowerCase().includes(query)
        );
        if (!matchesOrder && !matchesCustomer && !matchesItem) {
          return false;
        }
      }

      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter([]);
  };

  const hasFilters = searchQuery || statusFilter.length > 0;

  const rows = filteredOrders.map((order) => [
    // Order Number (clickable)
    <Text variant="bodyMd" fontWeight="semibold" key={order.id}>
      #{order.external_order_id}
    </Text>,
    // Customer
    order.customer_name || order.customer_email || '-',
    // Date
    formatDate(order.order_date),
    // Status
    getStatusBadge(order.status),
    // Items
    order.order_lines?.length || 0,
    // Total
    formatPrice(order.total_price_pence, order.currency),
  ]);

  const statusOptions = [
    { label: 'Imported', value: 'IMPORTED' },
    { label: 'Needs Review', value: 'NEEDS_REVIEW' },
    { label: 'Ready to Pick', value: 'READY_TO_PICK' },
    { label: 'In Batch', value: 'IN_BATCH' },
    { label: 'Picked', value: 'PICKED' },
    { label: 'Dispatched', value: 'DISPATCHED' },
    { label: 'Cancelled', value: 'CANCELLED' },
  ];

  return (
    <Page
      title="Orders"
      primaryAction={{
        content: 'Import from Shopify',
        loading: importing,
        onAction: handleImport,
      }}
      secondaryActions={[
        { content: 'Refresh', onAction: loadOrders },
      ]}
    >
      <BlockStack gap="400">
        {/* Error banners */}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {importError && (
          <Banner title="Import Failed" tone="critical" onDismiss={() => setImportError(null)}>
            <p>{importError}</p>
          </Banner>
        )}

        {importResult && (
          <Banner
            title="Import Complete"
            tone="success"
            onDismiss={() => setImportResult(null)}
          >
            <p>
              Imported: {importResult.imported} | Updated: {importResult.updated} | Skipped: {importResult.skipped}
            </p>
          </Banner>
        )}

        {/* Search and Filter */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Search orders"
                  labelHidden
                  placeholder="Search by order #, customer, item..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                  clearButton
                  onClearButtonClick={() => setSearchQuery('')}
                  autoComplete="off"
                />
              </div>
              <Select
                label="Status"
                labelHidden
                options={[
                  { label: 'All statuses', value: '' },
                  ...statusOptions,
                ]}
                value={statusFilter.length === 1 ? statusFilter[0] : ''}
                onChange={(value) => setStatusFilter(value ? [value] : [])}
              />
              {hasFilters && (
                <Button onClick={handleClearFilters}>Clear filters</Button>
              )}
            </InlineStack>
            {hasFilters && (
              <Text variant="bodySm" tone="subdued">
                Showing {filteredOrders.length} of {orders.length} orders
              </Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Spinner accessibilityLabel="Loading orders" size="large" />
            </div>
          ) : orders.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No orders yet</Text>
                <Text tone="subdued">Click "Import from Shopify" to fetch your unfulfilled orders.</Text>
              </BlockStack>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No matching orders</Text>
                <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                <Button onClick={handleClearFilters}>Clear filters</Button>
              </BlockStack>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'numeric']}
              headings={['Order #', 'Customer', 'Date', 'Status', 'Items', 'Total']}
              rows={rows}
              hoverable
              onRowClick={(row, index) => setSelectedOrder(filteredOrders[index])}
              footerContent={`${filteredOrders.length} order(s)`}
            />
          )}
        </Card>
      </BlockStack>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <Modal
          open={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          title={`Order #${selectedOrder.external_order_id}`}
          large
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* Order Info */}
              <InlineStack gap="800">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Customer</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {selectedOrder.customer_name || 'N/A'}
                  </Text>
                  <Text variant="bodySm">{selectedOrder.customer_email || ''}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Date</Text>
                  <Text variant="bodyMd">{formatDate(selectedOrder.order_date)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Status</Text>
                  {getStatusBadge(selectedOrder.status)}
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Total</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {formatPrice(selectedOrder.total_price_pence, selectedOrder.currency)}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Order Lines */}
              <BlockStack gap="200">
                <Text variant="headingSm">Order Items</Text>
                {selectedOrder.order_lines?.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'text']}
                    headings={['Item', 'SKU/ASIN', 'Qty', 'Status']}
                    rows={selectedOrder.order_lines.map((line) => [
                      <BlockStack gap="100" key={line.id}>
                        <Text variant="bodyMd">{line.title || 'Unknown item'}</Text>
                        {line.boms && (
                          <Text variant="bodySm" tone="subdued">
                            → {line.boms.bundle_sku}: {line.boms.description}
                          </Text>
                        )}
                      </BlockStack>,
                      line.asin || line.sku || '-',
                      line.quantity,
                      line.is_resolved ? (
                        <Badge tone="success">Resolved</Badge>
                      ) : (
                        <Badge tone="warning">Needs Review</Badge>
                      ),
                    ])}
                  />
                ) : (
                  <Text tone="subdued">No line items</Text>
                )}
              </BlockStack>

              {/* Shipping Address */}
              {selectedOrder.shipping_address && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <Text variant="headingSm">Shipping Address</Text>
                    <Text variant="bodyMd">
                      {selectedOrder.shipping_address.name}<br />
                      {selectedOrder.shipping_address.address1}<br />
                      {selectedOrder.shipping_address.address2 && <>{selectedOrder.shipping_address.address2}<br /></>}
                      {selectedOrder.shipping_address.city}, {selectedOrder.shipping_address.province_code} {selectedOrder.shipping_address.zip}<br />
                      {selectedOrder.shipping_address.country}
                    </Text>
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
