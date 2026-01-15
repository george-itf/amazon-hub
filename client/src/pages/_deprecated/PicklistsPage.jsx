import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Page,
  Card,
  DataTable,
  Spinner,
  Banner,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  TextField,
  Select,
  Button,
  Modal,
  Divider,
  ButtonGroup,
  Layout,
} from '@shopify/polaris';
import {
  getPickBatches,
  getPickBatch,
  reservePickBatch,
  confirmPickBatch,
  cancelPickBatch,
  generateIdempotencyKey,
} from '../utils/api.jsx';

/**
 * PicklistsPage displays pick batches generated from orders.
 * Each batch groups orders for efficient warehouse picking.
 */
export default function PicklistsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [batches, setBatches] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Detail modal
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [loadingBatchDetail, setLoadingBatchDetail] = useState(false);
  const [batchDetail, setBatchDetail] = useState(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(null);

  async function loadBatches() {
    setLoading(true);
    setError(null);
    try {
      const data = await getPickBatches();
      setBatches(data.pick_batches || []);
    } catch (err) {
      console.error(err);
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to load pick batches');
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
  }, []);

  // Load batch detail when selected
  useEffect(() => {
    async function loadDetail() {
      if (!selectedBatch) {
        setBatchDetail(null);
        return;
      }
      setLoadingBatchDetail(true);
      try {
        const data = await getPickBatch(selectedBatch.id);
        setBatchDetail(data.pick_batch || data);
      } catch (err) {
        console.error(err);
        // Still show the basic batch info
        setBatchDetail(selectedBatch);
      } finally {
        setLoadingBatchDetail(false);
      }
    }
    loadDetail();
  }, [selectedBatch]);

  // Filter batches
  const filteredBatches = useMemo(() => {
    return batches.filter((batch) => {
      // Status filter
      if (statusFilter !== 'all' && batch.status !== statusFilter) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesBatchNumber = (batch.batch_number || batch.id || '').toLowerCase().includes(query);
        if (!matchesBatchNumber) return false;
      }

      return true;
    });
  }, [batches, statusFilter, searchQuery]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  const hasFilters = searchQuery || statusFilter !== 'all';

  function getStatusBadge(status) {
    const statusMap = {
      DRAFT: { tone: 'info', label: 'Draft' },
      RESERVED: { tone: 'warning', label: 'Reserved' },
      PICKING: { tone: 'attention', label: 'Picking' },
      COMPLETED: { tone: 'success', label: 'Completed' },
      CANCELLED: { tone: 'critical', label: 'Cancelled' },
    };
    const config = statusMap[status] || { tone: 'default', label: status || 'Unknown' };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Action handlers
  async function handleReserve(batch) {
    setActionLoading('reserve');
    setError(null);
    try {
      await reservePickBatch(batch.id, generateIdempotencyKey());
      setSuccessMessage(`Batch ${batch.batch_number || batch.id.substring(0, 8)} reserved for picking`);
      setSelectedBatch(null);
      await loadBatches();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to reserve batch');
      setError(errorMsg);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleConfirm(batch) {
    setActionLoading('confirm');
    setError(null);
    try {
      await confirmPickBatch(batch.id, generateIdempotencyKey());
      setSuccessMessage(`Batch ${batch.batch_number || batch.id.substring(0, 8)} confirmed as picked`);
      setSelectedBatch(null);
      await loadBatches();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to confirm batch');
      setError(errorMsg);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancel(batch) {
    if (!confirm('Are you sure you want to cancel this batch? This will release all reserved stock.')) {
      return;
    }
    setActionLoading('cancel');
    setError(null);
    try {
      await cancelPickBatch(batch.id, 'User cancelled', generateIdempotencyKey());
      setSuccessMessage(`Batch ${batch.batch_number || batch.id.substring(0, 8)} cancelled`);
      setSelectedBatch(null);
      await loadBatches();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to cancel batch');
      setError(errorMsg);
    } finally {
      setActionLoading(null);
    }
  }

  const rows = filteredBatches.map((batch) => [
    <Text variant="bodyMd" fontWeight="semibold" key={`batch-${batch.id}`}>
      {batch.batch_number || batch.id?.substring(0, 8)}
    </Text>,
    getStatusBadge(batch.status),
    batch.pick_batch_lines?.length || 0,
    batch.order_count || '-',
    formatDate(batch.created_at),
  ]);

  // Calculate stats
  const stats = useMemo(() => {
    const draft = batches.filter((b) => b.status === 'DRAFT').length;
    const reserved = batches.filter((b) => b.status === 'RESERVED').length;
    const picking = batches.filter((b) => b.status === 'PICKING').length;
    const completed = batches.filter((b) => b.status === 'COMPLETED').length;
    return { draft, reserved, picking, completed };
  }, [batches]);

  // Get available actions for a batch
  function getAvailableActions(batch) {
    const actions = [];
    if (batch.status === 'DRAFT') {
      actions.push({ label: 'Reserve Stock', action: 'reserve', variant: 'primary' });
      actions.push({ label: 'Cancel', action: 'cancel', variant: 'plain', tone: 'critical' });
    } else if (batch.status === 'RESERVED') {
      actions.push({ label: 'Confirm Picked', action: 'confirm', variant: 'primary' });
      actions.push({ label: 'Cancel', action: 'cancel', variant: 'plain', tone: 'critical' });
    }
    return actions;
  }

  return (
    <Page
      title="Pick Batches"
      subtitle={`${batches.length} batches · ${stats.draft} draft · ${stats.reserved + stats.picking} active`}
      secondaryActions={[{ content: 'Refresh', onAction: loadBatches }]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {successMessage && (
          <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
            <p>{successMessage}</p>
          </Banner>
        )}

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Draft</Text>
                <Text variant="headingLg" fontWeight="bold">{stats.draft}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Reserved</Text>
                <Text variant="headingLg" fontWeight="bold" tone={stats.reserved > 0 ? 'warning' : undefined}>
                  {stats.reserved}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Picking</Text>
                <Text variant="headingLg" fontWeight="bold" tone={stats.picking > 0 ? 'success' : undefined}>
                  {stats.picking}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Completed</Text>
                <Text variant="headingLg" fontWeight="bold">{stats.completed}</Text>
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
                placeholder="Search by batch number..."
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
                { label: 'All statuses', value: 'all' },
                { label: 'Draft', value: 'DRAFT' },
                { label: 'Reserved', value: 'RESERVED' },
                { label: 'Picking', value: 'PICKING' },
                { label: 'Completed', value: 'COMPLETED' },
                { label: 'Cancelled', value: 'CANCELLED' },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            {hasFilters && (
              <Button onClick={handleClearFilters}>Clear</Button>
            )}
          </InlineStack>
        </Card>

        <Card>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Spinner accessibilityLabel="Loading pick batches" size="large" />
            </div>
          ) : batches.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No pick batches yet</Text>
                <Text tone="subdued">
                  Pick batches are created when you batch orders for picking. Go to the Orders page to create a new batch.
                </Text>
              </BlockStack>
            </div>
          ) : filteredBatches.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No matching batches</Text>
                <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                <Button onClick={handleClearFilters}>Clear filters</Button>
              </BlockStack>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text']}
              headings={['Batch #', 'Status', 'Lines', 'Orders', 'Created']}
              rows={rows}
              hoverable
              onRowClick={(row, index) => setSelectedBatch(filteredBatches[index])}
              footerContent={`${filteredBatches.length} of ${batches.length} pick batch(es)`}
            />
          )}
        </Card>

        {/* Info Banner */}
        <Banner tone="info">
          <p>
            <strong>Workflow:</strong> Create batches from Orders → Reserve stock → Pick items → Confirm picked.
            Click on a batch to view details and take actions.
          </p>
        </Banner>
      </BlockStack>

      {/* Batch Detail Modal */}
      {selectedBatch && (
        <Modal
          open={!!selectedBatch}
          onClose={() => setSelectedBatch(null)}
          title={`Batch ${selectedBatch.batch_number || selectedBatch.id?.substring(0, 8)}`}
          large
          primaryAction={
            getAvailableActions(selectedBatch)[0]?.action === 'reserve'
              ? {
                  content: 'Reserve Stock',
                  onAction: () => handleReserve(selectedBatch),
                  loading: actionLoading === 'reserve',
                }
              : getAvailableActions(selectedBatch)[0]?.action === 'confirm'
              ? {
                  content: 'Confirm Picked',
                  onAction: () => handleConfirm(selectedBatch),
                  loading: actionLoading === 'confirm',
                }
              : undefined
          }
          secondaryActions={[
            ...(selectedBatch.status === 'DRAFT' || selectedBatch.status === 'RESERVED'
              ? [
                  {
                    content: 'Cancel Batch',
                    destructive: true,
                    onAction: () => handleCancel(selectedBatch),
                    loading: actionLoading === 'cancel',
                  },
                ]
              : []),
            { content: 'Close', onAction: () => setSelectedBatch(null) },
          ]}
        >
          <Modal.Section>
            {loadingBatchDetail ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <Spinner accessibilityLabel="Loading batch details" size="large" />
              </div>
            ) : (
              <BlockStack gap="400">
                {/* Batch Info */}
                <InlineStack gap="800">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Status</Text>
                    {getStatusBadge(selectedBatch.status)}
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Orders</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {batchDetail?.order_count || selectedBatch.order_count || '-'}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Lines</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {batchDetail?.pick_batch_lines?.length || selectedBatch.pick_batch_lines?.length || 0}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Created</Text>
                    <Text variant="bodyMd">{formatDate(selectedBatch.created_at)}</Text>
                  </BlockStack>
                </InlineStack>

                <Divider />

                {/* Pick Lines */}
                <BlockStack gap="200">
                  <Text variant="headingSm">
                    Pick Items ({batchDetail?.pick_batch_lines?.length || selectedBatch.pick_batch_lines?.length || 0})
                  </Text>
                  {(batchDetail?.pick_batch_lines || selectedBatch.pick_batch_lines)?.length > 0 ? (
                    <DataTable
                      columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                      headings={['Component', 'Location', 'Qty Required', 'Qty Picked']}
                      rows={(batchDetail?.pick_batch_lines || selectedBatch.pick_batch_lines).map((line) => [
                        <Text variant="bodyMd" fontWeight="semibold" key={line.id}>
                          {line.components?.internal_sku || line.component_id?.substring(0, 8) || 'Unknown'}
                        </Text>,
                        line.location || 'DEFAULT',
                        line.qty_required,
                        line.qty_picked !== null ? (
                          <Badge tone={line.qty_picked >= line.qty_required ? 'success' : 'warning'}>
                            {line.qty_picked}
                          </Badge>
                        ) : (
                          '-'
                        ),
                      ])}
                    />
                  ) : (
                    <Text tone="subdued">No pick lines in this batch.</Text>
                  )}
                </BlockStack>

                {/* Action hints based on status */}
                {selectedBatch.status === 'DRAFT' && (
                  <Banner tone="info">
                    <p>
                      This batch is in draft status. Click <strong>Reserve Stock</strong> to reserve the
                      required components from inventory before picking.
                    </p>
                  </Banner>
                )}
                {selectedBatch.status === 'RESERVED' && (
                  <Banner tone="info">
                    <p>
                      Stock has been reserved. Pick the items from the warehouse, then click{' '}
                      <strong>Confirm Picked</strong> to complete the batch.
                    </p>
                  </Banner>
                )}
                {selectedBatch.status === 'COMPLETED' && (
                  <Banner tone="success">
                    <p>This batch has been completed. All items were picked and the orders are ready for dispatch.</p>
                  </Banner>
                )}
                {selectedBatch.status === 'CANCELLED' && (
                  <Banner tone="critical">
                    <p>This batch was cancelled. Any reserved stock has been released back to inventory.</p>
                  </Banner>
                )}
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
