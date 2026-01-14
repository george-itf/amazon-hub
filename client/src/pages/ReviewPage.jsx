import React, { useEffect, useState } from 'react';
import {
  Page,
  Card,
  DataTable,
  Spinner,
  Select,
  TextField,
  Button,
  Modal,
  BlockStack,
  Banner,
  Text,
  Badge,
  Checkbox,
} from '@shopify/polaris';
import { getReviewQueue, getBoms, resolveReview, skipReview } from '../utils/api.jsx';

/**
 * ReviewPage displays the current items in the review queue and lets
 * the user resolve each one by selecting a BOM and optionally
 * overriding the ASIN/SKU/Title. When resolved the item is removed
 * from the queue and a listing memory entry is created.
 */
export default function ReviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState([]);
  const [boms, setBoms] = useState([]);
  const [resolveState, setResolveState] = useState({
    open: false,
    item: null,
    bom_id: '',
    asin: '',
    sku: '',
    title: '',
    saveAsRule: true,
    resolving: false,
    error: null,
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [queueData, bomData] = await Promise.all([getReviewQueue(), getBoms()]);
      setQueue(queueData.items || []);
      setBoms(bomData.boms || []);
    } catch (err) {
      console.error(err);
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to load review queue');
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openResolve(item) {
    setResolveState({
      open: true,
      item,
      bom_id: '',
      asin: item.asin || '',
      sku: item.sku || '',
      title: item.title || '',
      saveAsRule: true,
      resolving: false,
      error: null,
    });
  }

  function closeResolve() {
    setResolveState({
      open: false,
      item: null,
      bom_id: '',
      asin: '',
      sku: '',
      title: '',
      saveAsRule: true,
      resolving: false,
      error: null,
    });
  }

  const bomOptions = [
    { label: '— Select BOM —', value: '' },
    ...boms.map((b) => ({ label: `${b.bundle_sku} - ${b.description || 'No description'}`, value: b.id })),
  ];

  async function handleResolve() {
    setResolveState((prev) => ({ ...prev, resolving: true, error: null }));
    try {
      await resolveReview(resolveState.item.id, {
        bom_id: resolveState.bom_id,
        save_as_rule: resolveState.saveAsRule,
        identity_overrides: {
          asin: resolveState.asin || null,
          sku: resolveState.sku || null,
          title: resolveState.title || null,
        },
      });
      closeResolve();
      await load();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to resolve');
      setResolveState((prev) => ({ ...prev, resolving: false, error: errorMsg }));
    }
  }

  async function handleSkip(item) {
    try {
      await skipReview(item.id, 'Skipped by user');
      await load();
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Unknown error');
      setError(`Failed to skip: ${errorMsg}`);
    }
  }

  function getReasonBadge(reason) {
    const reasonMap = {
      UNKNOWN_LISTING: { tone: 'warning', label: 'Unknown Listing' },
      BOM_NOT_SET: { tone: 'attention', label: 'BOM Not Set' },
      AMBIGUOUS: { tone: 'info', label: 'Ambiguous' },
    };
    const config = reasonMap[reason] || { tone: 'default', label: reason || 'Unknown' };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  const rows = queue.map((item) => [
    <Text variant="bodyMd" fontWeight="semibold" key={`asin-${item.id}`}>
      {item.asin || '-'}
    </Text>,
    item.sku || '-',
    <Text variant="bodySm" key={`title-${item.id}`}>
      {item.title ? (item.title.length > 50 ? item.title.substring(0, 50) + '...' : item.title) : '-'}
    </Text>,
    getReasonBadge(item.reason),
    <BlockStack gap="200" key={`actions-${item.id}`}>
      <Button size="slim" variant="primary" onClick={() => openResolve(item)}>
        Resolve
      </Button>
      <Button size="slim" variant="tertiary" onClick={() => handleSkip(item)}>
        Skip
      </Button>
    </BlockStack>,
  ]);

  return (
    <Page
      title="Review Queue"
      subtitle={queue.length > 0 ? `${queue.length} item(s) need review` : undefined}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
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
              <Spinner accessibilityLabel="Loading review queue" size="large" />
            </div>
          ) : queue.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <BlockStack gap="200" inlineAlign="center">
                <Text variant="headingMd">All caught up!</Text>
                <Text tone="subdued">No items in review queue. Orders with unknown listings will appear here.</Text>
              </BlockStack>
            </div>
          ) : (
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text']}
              headings={['ASIN', 'SKU', 'Title', 'Reason', 'Actions']}
              rows={rows}
            />
          )}
        </Card>
      </BlockStack>

      {/* Resolve Modal */}
      <Modal
        open={resolveState.open}
        onClose={closeResolve}
        title="Resolve Listing"
        primaryAction={{
          content: 'Resolve',
          onAction: handleResolve,
          disabled: !resolveState.bom_id,
          loading: resolveState.resolving,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: closeResolve }]}
      >
        {resolveState.item && (
          <Modal.Section>
            <BlockStack gap="400">
              {resolveState.error && (
                <Banner tone="critical">
                  <p>{resolveState.error}</p>
                </Banner>
              )}

              <Banner tone="info">
                <p>
                  Select a BOM to map this listing. The mapping will be saved and used automatically for future orders.
                </p>
              </Banner>

              <Select
                label="BOM (Bill of Materials)"
                options={bomOptions}
                value={resolveState.bom_id}
                onChange={(value) => setResolveState((prev) => ({ ...prev, bom_id: value }))}
                helpText="Select the product/bundle this listing should map to"
              />

              <Checkbox
                label="Save as rule for future orders"
                checked={resolveState.saveAsRule}
                onChange={(checked) => setResolveState((prev) => ({ ...prev, saveAsRule: checked }))}
                helpText="When enabled, similar listings will be automatically resolved"
              />

              <Text variant="headingSm">Identity Overrides (optional)</Text>
              <Text variant="bodySm" tone="subdued">
                Override the ASIN, SKU, or title used for matching future orders.
              </Text>

              <TextField
                label="ASIN"
                value={resolveState.asin}
                onChange={(value) => setResolveState((prev) => ({ ...prev, asin: value }))}
                placeholder="e.g., B08N5WRWNW"
              />
              <TextField
                label="SKU"
                value={resolveState.sku}
                onChange={(value) => setResolveState((prev) => ({ ...prev, sku: value }))}
                placeholder="e.g., INV-TOOL-001"
              />
              <TextField
                label="Title"
                value={resolveState.title}
                onChange={(value) => setResolveState((prev) => ({ ...prev, title: value }))}
                placeholder="Product title for fingerprinting"
                multiline={2}
              />
            </BlockStack>
          </Modal.Section>
        )}
      </Modal>
    </Page>
  );
}
