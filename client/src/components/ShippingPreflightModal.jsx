import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  Spinner,
  Collapsible,
  Icon,
  DataTable,
} from '@shopify/polaris';
import { ChevronDownIcon, ChevronUpIcon, AlertTriangleIcon } from '@shopify/polaris-icons';
import { validateShippingBatch, createShippingBatch } from '../utils/api.jsx';

/**
 * ShippingPreflightModal - Guardrail pattern for batch shipping
 *
 * Shows preflight validation before batch label creation:
 * 1. Explicit scope summary
 * 2. Preview / dry run option
 * 3. Confirmation with cost estimate
 * 4. Warnings for any issues
 */
export default function ShippingPreflightModal({
  open,
  orderIds,
  orders = [],
  serviceCode,
  serviceName,
  onClose,
  onConfirm,
}) {
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState(null);
  const [ordersExpanded, setOrdersExpanded] = useState(false);
  const [dryRunResults, setDryRunResults] = useState(null);
  const [runningDryRun, setRunningDryRun] = useState(false);

  // Load validation when modal opens
  const loadValidation = useCallback(async () => {
    if (!orderIds || orderIds.length === 0) return;

    setLoading(true);
    setError(null);
    setValidation(null);
    setDryRunResults(null);

    try {
      const result = await validateShippingBatch(orderIds, serviceCode);
      setValidation(result);
    } catch (err) {
      console.error('Validation failed:', err);
      setError(err.message || 'Failed to validate orders');
    } finally {
      setLoading(false);
    }
  }, [orderIds, serviceCode]);

  useEffect(() => {
    if (open && orderIds?.length > 0) {
      loadValidation();
    }
  }, [open, orderIds, loadValidation]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setValidation(null);
      setError(null);
      setDryRunResults(null);
      setOrdersExpanded(false);
      setRunningDryRun(false);
    }
  }, [open]);

  // Run dry run
  const handleDryRun = async () => {
    setRunningDryRun(true);
    setError(null);

    try {
      const result = await createShippingBatch(orderIds, {
        dryRun: true,
        serviceCode,
      });
      setDryRunResults(result);
    } catch (err) {
      console.error('Dry run failed:', err);
      setError(err.message || 'Dry run failed');
    } finally {
      setRunningDryRun(false);
    }
  };

  // Confirm and proceed to actual label creation
  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
  };

  // Format currency
  const formatCost = (pence) => {
    if (pence === null || pence === undefined) return '-';
    return `${(pence / 100).toFixed(2)}`;
  };

  // Build order list for display
  const selectedOrders = orders.filter(o => orderIds?.includes(o.id));

  // Get order number display
  const getOrderNumber = (order) => {
    return order.order_number || order.external_order_id || order.id?.substring(0, 8);
  };

  // Render loading state
  if (loading) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Validating Orders..."
      >
        <Modal.Section>
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <Spinner accessibilityLabel="Validating" size="large" />
            <Text variant="bodyMd" tone="subdued">
              Checking {orderIds?.length || 0} orders...
            </Text>
          </div>
        </Modal.Section>
      </Modal>
    );
  }

  // Render error state
  if (error && !validation) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Validation Error"
        primaryAction={{
          content: 'Retry',
          onAction: loadValidation,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: onClose,
          },
        ]}
      >
        <Modal.Section>
          <Banner tone="critical">
            <p>{error}</p>
          </Banner>
        </Modal.Section>
      </Modal>
    );
  }

  // Build dry run results table if available
  const dryRunRows = dryRunResults?.results?.map(item => [
    item.order_number || item.order_id?.substring(0, 8) || '-',
    item.status === 'simulated' ? (
      <Badge tone="info">Simulated</Badge>
    ) : item.status === 'skipped' ? (
      <Badge tone="warning">Skipped</Badge>
    ) : (
      <Badge tone="critical">Error</Badge>
    ),
    item.service_code || '-',
    `${formatCost(item.price_pence)}`,
    item.reason || item.error || '-',
  ]) || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Shipping Labels"
      large
      primaryAction={{
        content: 'Create Labels',
        onAction: handleConfirm,
        disabled: !validation || validation.eligible_count === 0 || runningDryRun,
      }}
      secondaryActions={[
        {
          content: runningDryRun ? 'Running...' : 'Run Dry Run First',
          onAction: handleDryRun,
          disabled: !validation || validation.eligible_count === 0 || runningDryRun,
          loading: runningDryRun,
        },
        {
          content: 'Cancel',
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Scope Summary Card */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingSm">Scope Summary</Text>
              <div className="hub-grid hub-grid--3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Orders Selected</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {orderIds?.length || 0}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Eligible for Labels</Text>
                  <Text variant="headingLg" fontWeight="bold" tone={validation?.eligible_count === orderIds?.length ? 'success' : 'caution'}>
                    {validation?.eligible_count || 0}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Estimated Total Cost</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {formatCost(validation?.estimated_cost_pence)}
                  </Text>
                </BlockStack>
              </div>
            </BlockStack>
          </Card>

          {/* Service Info */}
          <Card>
            <BlockStack gap="200">
              <Text variant="headingSm">Shipping Service</Text>
              <InlineStack gap="200" align="space-between">
                <InlineStack gap="200">
                  <Badge>{serviceCode || 'TPN'}</Badge>
                  <Text variant="bodyMd">{serviceName || 'Tracked 24'}</Text>
                </InlineStack>
                <Text variant="bodyMd" fontWeight="semibold">
                  ~{formatCost(validation?.cost_per_label_pence)} per label
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Warnings */}
          {validation?.warnings && validation.warnings.length > 0 && (
            <Banner tone="warning" icon={AlertTriangleIcon}>
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="semibold">Warnings</Text>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {validation.warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </BlockStack>
            </Banner>
          )}

          {/* Ineligible Orders */}
          {validation?.ineligible_orders && validation.ineligible_orders.length > 0 && (
            <Banner tone="critical">
              <BlockStack gap="200">
                <Text variant="bodyMd" fontWeight="semibold">
                  {validation.ineligible_orders.length} orders cannot be processed
                </Text>
                <ul style={{ margin: 0, paddingLeft: '20px' }}>
                  {validation.ineligible_orders.slice(0, 5).map((item, idx) => (
                    <li key={idx}>
                      {item.order_number || item.order_id?.substring(0, 8)}: {item.reason}
                    </li>
                  ))}
                  {validation.ineligible_orders.length > 5 && (
                    <li>...and {validation.ineligible_orders.length - 5} more</li>
                  )}
                </ul>
              </BlockStack>
            </Banner>
          )}

          {/* Error banner */}
          {error && (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          )}

          <Divider />

          {/* Collapsible Order List */}
          <BlockStack gap="200">
            <Button
              plain
              fullWidth
              textAlign="left"
              onClick={() => setOrdersExpanded(!ordersExpanded)}
              icon={ordersExpanded ? ChevronUpIcon : ChevronDownIcon}
            >
              {ordersExpanded ? 'Hide' : 'Show'} order list ({selectedOrders.length} orders)
            </Button>
            <Collapsible open={ordersExpanded} transition={{ duration: '150ms' }}>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--p-color-border)', borderRadius: '8px', padding: '8px' }}>
                {selectedOrders.length > 0 ? (
                  <BlockStack gap="100">
                    {selectedOrders.map((order) => (
                      <InlineStack key={order.id} gap="200" align="space-between">
                        <Text variant="bodySm">{getOrderNumber(order)}</Text>
                        <Text variant="bodySm" tone="subdued">
                          {order.customer_name || order.shipping_address?.name || '-'}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : (
                  <Text variant="bodySm" tone="subdued">No orders found</Text>
                )}
              </div>
            </Collapsible>
          </BlockStack>

          {/* Dry Run Results */}
          {dryRunResults && (
            <>
              <Divider />
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingSm">Dry Run Results</Text>
                  <Badge tone="info">Simulation Complete</Badge>
                </InlineStack>

                {/* Dry Run Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                  <Card>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Total</Text>
                      <Text variant="headingMd">{dryRunResults.summary?.total || 0}</Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Would Succeed</Text>
                      <Text variant="headingMd" tone="success">{dryRunResults.summary?.success || 0}</Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Would Skip</Text>
                      <Text variant="headingMd" tone="caution">{dryRunResults.summary?.skipped || 0}</Text>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Estimated Cost</Text>
                      <Text variant="headingMd">{formatCost(dryRunResults.summary?.total_cost_pence)}</Text>
                    </BlockStack>
                  </Card>
                </div>

                {/* Dry Run Details Table */}
                {dryRunRows.length > 0 && (
                  <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
                      headings={['Order', 'Status', 'Service', 'Est. Cost', 'Notes']}
                      rows={dryRunRows}
                    />
                  </div>
                )}

                <Banner tone="info">
                  <p>
                    This was a dry run simulation. No labels have been created yet.
                    Click "Create Labels" to proceed with actual label creation.
                  </p>
                </Banner>
              </BlockStack>
            </>
          )}

          {/* Final Warning */}
          {validation && validation.eligible_count > 0 && !dryRunResults && (
            <Banner tone="info">
              <p>
                Clicking "Create Labels" will generate {validation.eligible_count} shipping labels
                with an estimated cost of {formatCost(validation.estimated_cost_pence)}.
                This action will charge your Royal Mail account.
              </p>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
