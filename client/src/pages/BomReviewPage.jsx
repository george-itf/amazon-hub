import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  TextField,
  Button,
  Banner,
  Text,
  BlockStack,
  Badge,
  InlineStack,
  Modal,
  Divider,
  EmptyState,
} from '@shopify/polaris';
import { getBomReviewQueue, getBomReviewStats, approveBom, rejectBom, getComponents } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * BomReviewPage - Review and approve/edit auto-created BOMs
 */
export default function BomReviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [boms, setBoms] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [components, setComponents] = useState([]);

  // Selected BOM for review
  const [selectedBom, setSelectedBom] = useState(null);
  const [editForm, setEditForm] = useState({ description: '', componentQuantities: {} });
  const [componentSearch, setComponentSearch] = useState('');

  // Action states
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [reviewData, statsData, compData] = await Promise.all([
        getBomReviewQueue({ status: 'PENDING_REVIEW' }),
        getBomReviewStats(),
        getComponents({ limit: 99999 })
      ]);
      setBoms(reviewData.boms || []);
      setStats(statsData || { pending: 0, approved: 0, rejected: 0 });
      setComponents(compData.components || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load BOM review queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Open review modal with BOM data
  function handleSelectBom(bom) {
    const componentQuantities = {};
    (bom.bom_components || []).forEach((bc) => {
      componentQuantities[bc.component_id] = String(bc.qty_required);
    });

    setEditForm({
      description: bom.description || '',
      componentQuantities,
    });
    setComponentSearch('');
    setSelectedBom(bom);
  }

  // Edit form handlers
  const handleEditFormChange = useCallback((field) => {
    return (value) => setEditForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleQuantityChange = useCallback((componentId) => {
    return (value) =>
      setEditForm((prev) => ({
        ...prev,
        componentQuantities: { ...prev.componentQuantities, [componentId]: value },
      }));
  }, []);

  // Filter components for selector
  const filteredComponents = useMemo(() => {
    if (!componentSearch) return components;
    const query = componentSearch.toLowerCase();
    return components.filter(
      (c) =>
        c.internal_sku?.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
    );
  }, [components, componentSearch]);

  // Count selected components
  const selectedCount = Object.values(editForm.componentQuantities).filter(
    (qty) => parseInt(qty) > 0
  ).length;

  // Calculate cost preview
  const costPreview = useMemo(() => {
    let total = 0;
    for (const [compId, qty] of Object.entries(editForm.componentQuantities)) {
      const parsedQty = parseInt(qty);
      if (isNaN(parsedQty) || parsedQty <= 0) continue;
      const comp = components.find((c) => c.id === compId);
      if (comp?.cost_ex_vat_pence) {
        total += comp.cost_ex_vat_pence * parsedQty;
      }
    }
    return total;
  }, [editForm.componentQuantities, components]);

  // Approve handler
  async function handleApprove() {
    if (!selectedBom) return;

    setApproving(true);
    try {
      const componentsList = Object.entries(editForm.componentQuantities)
        .filter(([, qty]) => parseInt(qty) > 0)
        .map(([component_id, qty_required]) => ({
          component_id,
          qty_required: parseInt(qty_required),
        }));

      await approveBom(selectedBom.id, {
        description: editForm.description,
        components: componentsList,
      });

      setSuccessMessage(`Approved BOM "${selectedBom.bundle_sku}"`);
      setSelectedBom(null);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to approve BOM');
    } finally {
      setApproving(false);
    }
  }

  // Reject handler
  async function handleReject() {
    if (!selectedBom) return;

    setRejecting(true);
    try {
      await rejectBom(selectedBom.id, rejectReason);
      setSuccessMessage(`Rejected BOM "${selectedBom.bundle_sku}"`);
      setSelectedBom(null);
      setShowRejectModal(false);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to reject BOM');
    } finally {
      setRejecting(false);
    }
  }

  // Get linked listings for a BOM
  const getLinkedListings = (bom) => {
    const listings = bom.listing_memory || [];
    return listings.filter(l => l.is_active);
  };

  const rows = boms.map((bom) => {
    const compCount = bom.bom_components?.length || 0;
    const linkedListings = getLinkedListings(bom);

    return [
      <button
        key={bom.id}
        onClick={() => handleSelectBom(bom)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textDecoration: 'underline',
          color: 'var(--p-color-text-emphasis)',
        }}
      >
        <Text variant="bodyMd" fontWeight="semibold">
          {bom.bundle_sku}
        </Text>
      </button>,
      bom.description || '-',
      <Badge key={`comp-${bom.id}`} tone={compCount > 0 ? 'info' : 'warning'}>
        {compCount} component{compCount !== 1 ? 's' : ''}
      </Badge>,
      linkedListings.length > 0 ? (
        <BlockStack gap="100" key={`listings-${bom.id}`}>
          {linkedListings.slice(0, 2).map((l) => (
            <Text variant="bodySm" key={l.id}>
              {l.asin || l.sku || 'fingerprint'}
            </Text>
          ))}
          {linkedListings.length > 2 && (
            <Text variant="bodySm" tone="subdued">
              +{linkedListings.length - 2} more
            </Text>
          )}
        </BlockStack>
      ) : (
        <Text tone="subdued">-</Text>
      ),
      new Date(bom.created_at).toLocaleDateString('en-GB'),
    ];
  });

  return (
    <Page
      title="BOM Review Queue"
      subtitle={`${stats.pending} pending · ${stats.approved} approved · ${stats.rejected} rejected`}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section>
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

            <Card>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner accessibilityLabel="Loading BOM review queue" size="large" />
                </div>
              ) : boms.length === 0 ? (
                <EmptyState
                  heading="No BOMs pending review"
                  image=""
                >
                  <p>All auto-created BOMs have been reviewed. New BOMs will appear here when the system creates them from order imports.</p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['Bundle SKU', 'Description', 'Components', 'Linked Listings', 'Created']}
                  rows={rows}
                  footerContent={`${boms.length} BOM(s) pending review`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Review Modal */}
      {selectedBom && (
        <Modal
          open={!!selectedBom}
          onClose={() => setSelectedBom(null)}
          title={`Review BOM: ${selectedBom.bundle_sku}`}
          large
          primaryAction={{
            content: 'Approve',
            onAction: handleApprove,
            loading: approving,
            disabled: selectedCount === 0,
          }}
          secondaryActions={[
            {
              content: 'Reject',
              onAction: () => setShowRejectModal(true),
              destructive: true,
            },
            { content: 'Cancel', onAction: () => setSelectedBom(null) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* BOM Info */}
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Bundle SKU</Text>
                  <Text variant="bodyMd" fontWeight="bold">{selectedBom.bundle_sku}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Created</Text>
                  <Text variant="bodyMd">
                    {new Date(selectedBom.created_at).toLocaleString('en-GB')}
                  </Text>
                </BlockStack>
                {costPreview > 0 && (
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Est. Cost</Text>
                    <Text variant="bodyMd" fontWeight="bold">{formatPrice(costPreview)}</Text>
                  </BlockStack>
                )}
              </InlineStack>

              {/* Linked Listings */}
              {getLinkedListings(selectedBom).length > 0 && (
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm">Linked Listings</Text>
                    {getLinkedListings(selectedBom).map((l) => (
                      <InlineStack key={l.id} gap="400">
                        {l.asin && <Badge tone="info">ASIN: {l.asin}</Badge>}
                        {l.sku && <Badge>SKU: {l.sku}</Badge>}
                        {l.title_fingerprint && (
                          <Text variant="bodySm" tone="subdued">
                            Title: {l.title_fingerprint.substring(0, 50)}...
                          </Text>
                        )}
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              <Divider />

              {/* Description */}
              <TextField
                label="Description"
                value={editForm.description}
                onChange={handleEditFormChange('description')}
                placeholder="e.g., Makita DHR242 with 2x 6.0Ah batteries"
              />

              <Divider />

              {/* Components Editor */}
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm">Components ({selectedCount} selected)</Text>
                  {costPreview > 0 && (
                    <Text variant="bodySm" tone="subdued">
                      Est. cost: {formatPrice(costPreview)}
                    </Text>
                  )}
                </InlineStack>

                <TextField
                  label="Search components"
                  labelHidden
                  placeholder="Search components by SKU or description..."
                  value={componentSearch}
                  onChange={setComponentSearch}
                  clearButton
                  onClearButtonClick={() => setComponentSearch('')}
                  autoComplete="off"
                />

                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <BlockStack gap="200">
                    {filteredComponents.length === 0 ? (
                      <Text tone="subdued">No components match "{componentSearch}"</Text>
                    ) : (
                      filteredComponents.slice(0, 20).map((c) => {
                        const currentQty = editForm.componentQuantities[c.id] || '';
                        const hasQty = parseInt(currentQty) > 0;
                        return (
                          <div
                            key={c.id}
                            style={{
                              padding: '8px',
                              borderRadius: '4px',
                              backgroundColor: hasQty ? 'var(--p-color-bg-surface-success)' : 'transparent',
                            }}
                          >
                            <InlineStack gap="200" blockAlign="center" wrap={false}>
                              <div style={{ flex: 1 }}>
                                <Text variant="bodySm" fontWeight="semibold">{c.internal_sku}</Text>
                                <Text variant="bodySm" tone="subdued">{c.description || 'No description'}</Text>
                                <InlineStack gap="200">
                                  {c.total_available !== null && (
                                    <Text variant="bodySm" tone={c.total_available <= 0 ? 'critical' : 'subdued'}>
                                      Stock: {c.total_available}
                                    </Text>
                                  )}
                                  {c.cost_ex_vat_pence && (
                                    <Text variant="bodySm" tone="subdued">
                                      {formatPrice(c.cost_ex_vat_pence)}
                                    </Text>
                                  )}
                                </InlineStack>
                              </div>
                              <div style={{ width: '80px' }}>
                                <TextField
                                  label={`Qty for ${c.internal_sku}`}
                                  labelHidden
                                  type="number"
                                  min="0"
                                  value={currentQty}
                                  onChange={handleQuantityChange(c.id)}
                                  placeholder="0"
                                  autoComplete="off"
                                />
                              </div>
                            </InlineStack>
                          </div>
                        );
                      })
                    )}
                    {filteredComponents.length > 20 && (
                      <Text tone="subdued">
                        Showing 20 of {filteredComponents.length} components. Use search to find more.
                      </Text>
                    )}
                  </BlockStack>
                </div>

                {selectedCount > 0 && (
                  <>
                    <Divider />
                    <Text variant="headingSm">Selected Components:</Text>
                    <InlineStack gap="200" wrap>
                      {Object.entries(editForm.componentQuantities)
                        .filter(([, qty]) => parseInt(qty) > 0)
                        .map(([compId, qty]) => {
                          const comp = components.find((c) => c.id === compId);
                          return (
                            <Badge key={compId} tone="success">
                              {comp?.internal_sku || compId} ×{qty}
                            </Badge>
                          );
                        })}
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Reject Confirmation Modal */}
      <Modal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Reject BOM"
        primaryAction={{
          content: 'Reject BOM',
          onAction: handleReject,
          loading: rejecting,
          destructive: true,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setShowRejectModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              <p>
                Rejecting this BOM will deactivate it and any linked listing rules.
                This action can be undone by re-creating the BOM manually.
              </p>
            </Banner>
            <TextField
              label="Reason for rejection (optional)"
              value={rejectReason}
              onChange={setRejectReason}
              placeholder="e.g., Incorrect components, duplicate BOM..."
              multiline={2}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
