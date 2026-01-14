import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Page,
  Layout,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Modal,
  FormLayout,
  TextField,
  Select,
  Card,
  Button,
  Divider,
  Badge,
  DataTable,
} from '@shopify/polaris';
import { useAuth } from '../context/AuthContext.jsx';
import {
  InvictaSectionHeader,
  InvictaPanel,
  InvictaTable,
  InvictaBadge,
  InvictaButton,
  InvictaLoading,
  InvictaConfirmModal,
  useTableState,
} from '../components/ui/index.jsx';
import * as api from '../utils/api.jsx';

const DISPOSITIONS = [
  { label: 'Restock', value: 'RESTOCK' },
  { label: 'Refurbish', value: 'REFURB' },
  { label: 'Scrap', value: 'SCRAP' },
  { label: 'Supplier Return', value: 'SUPPLIER_RETURN' },
];

/**
 * ReturnsPage - Manage returns and quarantine
 */
export default function ReturnsPage() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [returns, setReturns] = useState([]);
  const [quarantine, setQuarantine] = useState(null);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [processModal, setProcessModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const tableState = useTableState(25);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Detail modal
  const [detailModal, setDetailModal] = useState(null);

  const loadReturns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [returnsData, quarantineData] = await Promise.all([
        api.getReturns({ limit: tableState.pageSize, offset: tableState.offset }),
        api.getQuarantineSummary(),
      ]);
      setReturns(returnsData.returns || []);
      setQuarantine(quarantineData);
    } catch (err) {
      console.error('Returns load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tableState.pageSize, tableState.offset]);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  // Filter returns
  const filteredReturns = useMemo(() => {
    return returns.filter((ret) => {
      // Status filter
      if (statusFilter !== 'all' && ret.status !== statusFilter) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesRma = (ret.rma_number || '').toLowerCase().includes(query);
        const matchesOrder = (ret.external_order_id || '').toLowerCase().includes(query);
        if (!matchesRma && !matchesOrder) return false;
      }

      return true;
    });
  }, [returns, statusFilter, searchQuery]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  const hasFilters = searchQuery || statusFilter !== 'all';

  // Calculate stats
  const stats = useMemo(() => {
    const pending = returns.filter((r) => r.status === 'PENDING' || r.status === 'RECEIVED').length;
    const inspecting = returns.filter((r) => r.status === 'INSPECTING').length;
    const processed = returns.filter((r) => r.status === 'PROCESSED').length;
    return { pending, inspecting, processed, total: returns.length };
  }, [returns]);

  const handleProcess = async (idempotencyKey) => {
    if (!selectedReturn) return;

    try {
      setProcessing(true);
      setProcessError(null);
      await api.processReturn(selectedReturn.id, idempotencyKey);
      setProcessModal(false);
      setSelectedReturn(null);
      setSuccessMessage(`Return ${selectedReturn.rma_number} processed successfully`);
      await loadReturns();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Processing failed');
      setProcessError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  function getStatusBadge(status) {
    const statusMap = {
      PENDING: { tone: 'info', label: 'Pending' },
      RECEIVED: { tone: 'warning', label: 'Received' },
      INSPECTING: { tone: 'attention', label: 'Inspecting' },
      PROCESSED: { tone: 'success', label: 'Processed' },
      CANCELLED: { tone: 'critical', label: 'Cancelled' },
    };
    const config = statusMap[status] || { tone: 'default', label: status || 'Unknown' };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  const columns = [
    {
      id: 'rma_number',
      header: 'RMA #',
      accessor: (row) => row.rma_number,
      sortable: true,
      render: (value, row) => (
        <Text
          variant="bodyMd"
          fontWeight="semibold"
          as="button"
          onClick={() => setDetailModal(row)}
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
        >
          {value}
        </Text>
      ),
    },
    {
      id: 'order_id',
      header: 'Order',
      accessor: (row) => row.external_order_id || row.order_id?.substring(0, 8),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      render: (value) => getStatusBadge(value),
    },
    {
      id: 'lines',
      header: 'Lines',
      accessor: (row) => row.return_lines?.length || 0,
    },
    {
      id: 'created_at',
      header: 'Created',
      accessor: (row) => row.created_at,
      render: (value) => value ? new Date(value).toLocaleDateString('en-GB') : '-',
      sortable: true,
    },
    {
      id: 'actions',
      header: '',
      render: (_, row) => (
        <InlineStack gap="200">
          <Button size="slim" onClick={() => setDetailModal(row)}>
            View
          </Button>
          <InvictaButton
            variant="secondary"
            size="slim"
            onClick={() => {
              setSelectedReturn(row);
              setProcessModal(true);
            }}
            disabled={row.status === 'PROCESSED'}
          >
            {row.status === 'PROCESSED' ? 'Done' : 'Process'}
          </InvictaButton>
        </InlineStack>
      ),
    },
  ];

  if (loading) {
    return (
      <Page title="Returns">
        <InvictaLoading message="Loading returns..." />
      </Page>
    );
  }

  return (
    <Page
      title="Returns Management"
      subtitle={`${stats.total} returns · ${stats.pending} pending · ${stats.processed} processed`}
      secondaryActions={[{ content: 'Refresh', onAction: loadReturns }]}
    >
      <BlockStack gap="400">
        {/* Success message */}
        {successMessage && (
          <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
            <p>{successMessage}</p>
          </Banner>
        )}

        {/* Process error */}
        {processError && (
          <Banner title="Processing Failed" tone="critical" onDismiss={() => setProcessError(null)}>
            <p>{processError}</p>
          </Banner>
        )}

        {/* Load error */}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Pending</Text>
                <Text variant="headingLg" fontWeight="bold" tone={stats.pending > 0 ? 'warning' : undefined}>
                  {stats.pending}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Inspecting</Text>
                <Text variant="headingLg" fontWeight="bold">
                  {stats.inspecting}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Processed</Text>
                <Text variant="headingLg" fontWeight="bold" tone="success">
                  {stats.processed}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">In Quarantine</Text>
                <Text variant="headingLg" fontWeight="bold">
                  {quarantine?.total_in_quarantine || 0}
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
                placeholder="Search by RMA #, order..."
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
                { label: 'Pending', value: 'PENDING' },
                { label: 'Received', value: 'RECEIVED' },
                { label: 'Inspecting', value: 'INSPECTING' },
                { label: 'Processed', value: 'PROCESSED' },
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

        {/* Quarantine Summary */}
        {quarantine && quarantine.total_in_quarantine > 0 && (
          <InvictaSectionHeader title="Quarantine Summary" count={quarantine.total_in_quarantine}>
            <InlineStack gap="400">
              {quarantine.by_disposition?.map(d => (
                <InvictaPanel key={d.disposition} padding="tight">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">{d.disposition}</Text>
                    <Text variant="headingLg">{d.count}</Text>
                  </BlockStack>
                </InvictaPanel>
              ))}
            </InlineStack>
          </InvictaSectionHeader>
        )}

        {/* Returns Table */}
        <Card>
          {returns.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No returns yet</Text>
                <Text tone="subdued">Returns will appear here when customers initiate them.</Text>
              </BlockStack>
            </div>
          ) : filteredReturns.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">No matching returns</Text>
                <Text tone="subdued">Try adjusting your search or filter criteria.</Text>
                <Button onClick={handleClearFilters}>Clear filters</Button>
              </BlockStack>
            </div>
          ) : (
            <InvictaTable
              columns={columns}
              data={filteredReturns}
              loading={loading}
              emptyState={{
                heading: 'No returns',
                description: 'Returns will appear here when created.',
              }}
              resourceName={{ singular: 'return', plural: 'returns' }}
            />
          )}
        </Card>

        {/* Process Modal */}
        {selectedReturn && (
          <InvictaConfirmModal
            open={processModal}
            onClose={() => {
              setProcessModal(false);
              setSelectedReturn(null);
            }}
            onConfirm={handleProcess}
            title={`Process Return ${selectedReturn.rma_number}`}
            message={`This will process the return and update stock based on line dispositions.`}
            confirmText="Process Return"
            variant="warning"
            loading={processing}
          />
        )}

        {/* Detail Modal */}
        {detailModal && (
          <Modal
            open={!!detailModal}
            onClose={() => setDetailModal(null)}
            title={`Return ${detailModal.rma_number}`}
            large
            primaryAction={
              detailModal.status !== 'PROCESSED'
                ? {
                    content: 'Process Return',
                    onAction: () => {
                      setSelectedReturn(detailModal);
                      setDetailModal(null);
                      setProcessModal(true);
                    },
                  }
                : undefined
            }
            secondaryActions={[{ content: 'Close', onAction: () => setDetailModal(null) }]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                {/* Return Info */}
                <InlineStack gap="800">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Status</Text>
                    {getStatusBadge(detailModal.status)}
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Order</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {detailModal.external_order_id || detailModal.order_id?.substring(0, 8) || '-'}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Lines</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {detailModal.return_lines?.length || 0}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Created</Text>
                    <Text variant="bodyMd">
                      {detailModal.created_at
                        ? new Date(detailModal.created_at).toLocaleDateString('en-GB')
                        : '-'}
                    </Text>
                  </BlockStack>
                </InlineStack>

                {detailModal.reason && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Return Reason</Text>
                    <Text variant="bodyMd">{detailModal.reason}</Text>
                  </BlockStack>
                )}

                <Divider />

                {/* Return Lines */}
                <BlockStack gap="200">
                  <Text variant="headingSm">Return Lines ({detailModal.return_lines?.length || 0})</Text>
                  {detailModal.return_lines?.length > 0 ? (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'text', 'text']}
                      headings={['Item', 'Qty', 'Disposition', 'Reason']}
                      rows={detailModal.return_lines.map((line) => [
                        <BlockStack gap="100" key={line.id}>
                          <Text variant="bodyMd" fontWeight="semibold">
                            {line.title || line.sku || 'Unknown item'}
                          </Text>
                          {line.asin && (
                            <Text variant="bodySm" tone="subdued">ASIN: {line.asin}</Text>
                          )}
                        </BlockStack>,
                        line.quantity || 1,
                        line.disposition ? (
                          <Badge tone={
                            line.disposition === 'RESTOCK' ? 'success' :
                            line.disposition === 'SCRAP' ? 'critical' : 'info'
                          }>
                            {line.disposition}
                          </Badge>
                        ) : '-',
                        line.return_reason || '-',
                      ])}
                    />
                  ) : (
                    <Text tone="subdued">No return lines.</Text>
                  )}
                </BlockStack>

                {detailModal.notes && (
                  <>
                    <Divider />
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Notes</Text>
                      <Text variant="bodyMd">{detailModal.notes}</Text>
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </BlockStack>
    </Page>
  );
}
