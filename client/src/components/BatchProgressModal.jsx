import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  ProgressBar,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  Banner,
  Button,
  Card,
  Divider,
  Spinner,
} from '@shopify/polaris';
import { createShippingBatch } from '../utils/api.jsx';

/**
 * BatchProgressModal - Shows real-time progress of batch label creation
 */
export default function BatchProgressModal({
  open,
  orderIds,
  dryRun = false,
  serviceCode,
  onClose,
  onComplete,
}) {
  const [status, setStatus] = useState('idle'); // idle, running, complete, error
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [batchId, setBatchId] = useState(null);

  const runBatch = useCallback(async () => {
    if (!orderIds || orderIds.length === 0) return;

    setStatus('running');
    setError(null);
    setResults([]);
    setSummary(null);

    try {
      const response = await createShippingBatch(orderIds, {
        dryRun,
        serviceCode,
      });

      setBatchId(response.batch_id);
      setResults(response.results || []);
      setSummary(response.summary);
      setStatus('complete');

      if (onComplete) {
        onComplete(response);
      }
    } catch (err) {
      setError(err.message || 'Batch operation failed');
      setStatus('error');
    }
  }, [orderIds, dryRun, serviceCode, onComplete]);

  // Run batch when modal opens with orders
  useEffect(() => {
    if (open && orderIds?.length > 0 && status === 'idle') {
      runBatch();
    }
  }, [open, orderIds, status, runBatch]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setResults([]);
      setSummary(null);
      setError(null);
      setBatchId(null);
    }
  }, [open]);

  const getStatusBadge = (itemStatus) => {
    switch (itemStatus) {
      case 'success':
        return <Badge tone="success">Success</Badge>;
      case 'simulated':
        return <Badge tone="info">Simulated</Badge>;
      case 'failed':
        return <Badge tone="critical">Failed</Badge>;
      case 'skipped':
        return <Badge tone="warning">Skipped</Badge>;
      default:
        return <Badge>{itemStatus}</Badge>;
    }
  };

  const formatCost = (pence) => {
    if (!pence) return '-';
    return `£${(pence / 100).toFixed(2)}`;
  };

  // Build table rows
  const rows = results.map((item) => [
    item.order_number || item.order_id?.substring(0, 8) || '-',
    getStatusBadge(item.status),
    item.tracking_number || '-',
    item.service_code || '-',
    formatCost(item.price_pence),
    item.error || item.reason || '-',
  ]);

  // Only show actual progress (0% or 100%), not fake intermediate values
  const progress = status === 'complete' ? 100 : 0;

  return (
    <Modal
      open={open}
      onClose={status !== 'running' ? onClose : undefined}
      title={dryRun ? 'Dry Run - Cost Simulation' : 'Creating Shipping Labels'}
      large
      primaryAction={
        status === 'complete'
          ? {
              content: 'Done',
              onAction: onClose,
            }
          : undefined
      }
      secondaryActions={
        status === 'error'
          ? [
              {
                content: 'Retry',
                onAction: () => {
                  setStatus('idle');
                  runBatch();
                },
              },
              {
                content: 'Close',
                onAction: onClose,
              },
            ]
          : undefined
      }
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Progress Indicator */}
          <BlockStack gap="200">
            <Text variant="bodyMd" fontWeight="semibold">
              {status === 'running'
                ? `Processing ${orderIds?.length || 0} orders...`
                : status === 'complete'
                  ? 'Batch Complete'
                  : status === 'error'
                    ? 'Batch Failed'
                    : 'Preparing...'}
            </Text>
            {status === 'running' ? (
              /* Show spinner during actual processing - no fake progress values */
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text variant="bodySm" tone="subdued">
                  Creating labels with Royal Mail... This may take a moment.
                </Text>
              </InlineStack>
            ) : (
              /* Show progress bar only when we have real progress (0% or 100%) */
              <ProgressBar
                progress={progress}
                tone={status === 'error' ? 'critical' : status === 'complete' ? 'success' : 'highlight'}
                size="small"
              />
            )}
          </BlockStack>

          {/* Error Banner */}
          {error && (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          )}

          {/* Dry Run Notice */}
          {dryRun && status === 'complete' && (
            <Banner tone="info">
              <p>
                This was a dry run. No labels were actually created. The costs shown are estimates.
              </p>
            </Banner>
          )}

          {/* Summary Cards */}
          {summary && (
            <>
              <Divider />
              <InlineStack gap="400" wrap>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Total Orders</Text>
                    <Text variant="headingLg" fontWeight="bold">{summary.total}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Success</Text>
                    <Text variant="headingLg" fontWeight="bold" tone="success">
                      {summary.success}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Failed</Text>
                    <Text
                      variant="headingLg"
                      fontWeight="bold"
                      tone={summary.failed > 0 ? 'critical' : undefined}
                    >
                      {summary.failed}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Skipped</Text>
                    <Text variant="headingLg" fontWeight="bold">{summary.skipped}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Total Cost</Text>
                    <Text variant="headingLg" fontWeight="bold">
                      {formatCost(summary.total_cost_pence)}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Avg Cost</Text>
                    <Text variant="headingLg" fontWeight="bold">
                      {formatCost(summary.avg_cost_pence)}
                    </Text>
                  </BlockStack>
                </Card>
              </InlineStack>
              {batchId && (
                <Text variant="bodySm" tone="subdued">
                  Batch ID: {batchId} | Duration: {summary.duration_ms}ms
                </Text>
              )}
            </>
          )}

          {/* Results Table */}
          {results.length > 0 && (
            <>
              <Divider />
              <BlockStack gap="200">
                <Text variant="headingSm">Results</Text>
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'numeric', 'text']}
                    headings={['Order', 'Status', 'Tracking', 'Service', 'Cost', 'Notes']}
                    rows={rows}
                  />
                </div>
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
