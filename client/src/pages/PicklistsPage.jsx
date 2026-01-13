import React, { useEffect, useState } from 'react';
import {
  Page,
  Card,
  DataTable,
  Spinner,
  Banner,
  Text,
  Badge,
  BlockStack,
} from '@shopify/polaris';
import { getPickBatches } from '../utils/api.jsx';

/**
 * PicklistsPage displays pick batches generated from orders.
 * Each batch groups orders for efficient warehouse picking.
 */
export default function PicklistsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [batches, setBatches] = useState([]);

  async function loadBatches() {
    setLoading(true);
    setError(null);
    try {
      const data = await getPickBatches();
      setBatches(data.pick_batches || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load pick batches');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
  }, []);

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

  const rows = batches.map((batch) => [
    <Text variant="bodyMd" fontWeight="semibold" key={`batch-${batch.id}`}>
      {batch.batch_number || batch.id?.substring(0, 8)}
    </Text>,
    getStatusBadge(batch.status),
    batch.pick_batch_lines?.length || 0,
    batch.order_count || '-',
    formatDate(batch.created_at),
  ]);

  return (
    <Page
      title="Pick Batches"
      subtitle="Batched order picking for warehouse efficiency"
      secondaryActions={[{ content: 'Refresh', onAction: loadBatches }]}
    >
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

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
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text']}
              headings={['Batch #', 'Status', 'Lines', 'Orders', 'Created']}
              rows={rows}
              footerContent={`${batches.length} pick batch(es)`}
            />
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}