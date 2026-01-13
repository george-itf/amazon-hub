import React, { useEffect, useState, useCallback } from 'react';
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
} from '@shopify/polaris';
import { useAuth } from '../context/AuthContext.js';
import {
  InvictaSectionHeader,
  InvictaPanel,
  InvictaTable,
  InvictaBadge,
  InvictaButton,
  InvictaLoading,
  InvictaConfirmModal,
  useTableState,
} from '../components/ui/index.js';
import * as api from '../utils/api.js';

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
  const tableState = useTableState(25);

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

  const handleProcess = async (idempotencyKey) => {
    if (!selectedReturn) return;

    try {
      setProcessing(true);
      await api.processReturn(selectedReturn.id, idempotencyKey);
      setProcessModal(false);
      setSelectedReturn(null);
      await loadReturns();
    } catch (err) {
      alert('Process failed: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    {
      id: 'rma_number',
      header: 'RMA #',
      accessor: (row) => row.rma_number,
      sortable: true,
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
      render: (value) => <InvictaBadge status={value} size="small" />,
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
      render: (value) => new Date(value).toLocaleDateString(),
      sortable: true,
    },
    {
      id: 'actions',
      header: '',
      render: (_, row) => (
        <InvictaButton
          variant="secondary"
          size="slim"
          onClick={() => {
            setSelectedReturn(row);
            setProcessModal(true);
          }}
          disabled={row.status === 'PROCESSED'}
        >
          {row.status === 'PROCESSED' ? 'Processed' : 'Process'}
        </InvictaButton>
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
      primaryAction={isAdmin ? {
        content: 'Create Return',
        onAction: () => alert('Create return modal - implement based on needs'),
      } : undefined}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

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
        <InvictaTable
          columns={columns}
          data={returns}
          loading={loading}
          emptyState={{
            heading: 'No returns',
            description: 'Returns will appear here when created.',
          }}
          resourceName={{ singular: 'return', plural: 'returns' }}
        />

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
      </BlockStack>
    </Page>
  );
}
