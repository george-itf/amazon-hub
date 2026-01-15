import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Spinner,
  Banner,
  TextField,
  Button,
  Divider,
  Card,
  Select,
} from '@shopify/polaris';
import { useProductModal } from '../context/ProductModalContext.jsx';
import {
  getBom,
  getBomAvailability,
  getComponents,
  adjustStock,
  generateIdempotencyKey,
} from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Global Product Detail Modal
 * Shows BOM details, component stock, and allows stock adjustments
 */
export default function ProductDetailModal() {
  const { selectedProduct, isOpen, closeProductModal } = useProductModal();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Full BOM data
  const [bom, setBom] = useState(null);
  const [availability, setAvailability] = useState(null);

  // Stock adjustment form
  const [adjustingComponent, setAdjustingComponent] = useState(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('RECOUNT');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  // Load BOM details when modal opens
  useEffect(() => {
    if (!isOpen || !selectedProduct) {
      setBom(null);
      setAvailability(null);
      return;
    }

    async function loadProduct() {
      setLoading(true);
      setError(null);

      try {
        // Try to get BOM by ID or SKU
        const bomId = selectedProduct.bom_id;
        const bomSku = selectedProduct.bom_sku || selectedProduct.bundle_sku;

        if (bomId) {
          const [bomData, availData] = await Promise.all([
            getBom(bomId),
            getBomAvailability(bomId, 'Warehouse').catch(() => null),
          ]);
          setBom(bomData);
          setAvailability(availData);
        } else if (bomSku) {
          // If we only have SKU, we need to search for the BOM
          // For now, just display what we have
          setBom({
            bundle_sku: bomSku,
            description: selectedProduct.title || selectedProduct.bom_description,
          });
        } else {
          // No BOM info available
          setBom(null);
        }
      } catch (err) {
        console.error('Product detail load error:', err);
        setError(err.message || 'Failed to load product details');
      } finally {
        setLoading(false);
      }
    }

    loadProduct();
  }, [isOpen, selectedProduct]);

  // Handle stock adjustment
  const handleAdjustStock = useCallback(async () => {
    if (!adjustingComponent || !adjustDelta) return;

    setAdjusting(true);
    setError(null);

    try {
      const delta = parseInt(adjustDelta);
      if (isNaN(delta) || delta === 0) {
        throw new Error('Please enter a valid non-zero quantity');
      }

      await adjustStock(
        adjustingComponent.component_id || adjustingComponent.id,
        'Warehouse',
        delta,
        adjustReason,
        adjustNote || undefined,
        generateIdempotencyKey()
      );

      setSuccessMessage(
        `Stock adjusted: ${delta > 0 ? '+' : ''}${delta} for ${adjustingComponent.internal_sku}`
      );

      // Reset form and refresh availability
      setAdjustingComponent(null);
      setAdjustDelta('');
      setAdjustNote('');

      // Refresh availability
      if (bom?.id) {
        const availData = await getBomAvailability(bom.id, 'Warehouse');
        setAvailability(availData);
      }
    } catch (err) {
      setError(err.message || 'Failed to adjust stock');
    } finally {
      setAdjusting(false);
    }
  }, [adjustingComponent, adjustDelta, adjustReason, adjustNote, bom]);

  // Get product title for display
  const productTitle = selectedProduct?.title
    || selectedProduct?.bom_description
    || bom?.description
    || bom?.bundle_sku
    || selectedProduct?.bom_sku
    || selectedProduct?.asin
    || 'Product Details';

  // Calculate total BOM cost
  const totalCost = bom?.bom_components?.reduce((sum, bc) => {
    const cost = bc.components?.cost_ex_vat_pence || 0;
    return sum + (cost * bc.qty_required);
  }, 0) || 0;

  return (
    <Modal
      open={isOpen}
      onClose={closeProductModal}
      title={productTitle.length > 60 ? productTitle.substring(0, 60) + '...' : productTitle}
      large
    >
      <Modal.Section>
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

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Spinner accessibilityLabel="Loading product details" size="large" />
            </div>
          ) : (
            <>
              {/* Product Info Header */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="800" wrap>
                    {(bom?.bundle_sku || selectedProduct?.bom_sku) && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Bundle SKU</Text>
                        <Text variant="bodyMd" fontWeight="bold">
                          {bom?.bundle_sku || selectedProduct?.bom_sku}
                        </Text>
                      </BlockStack>
                    )}
                    {selectedProduct?.asin && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">ASIN</Text>
                        <Badge tone="info">{selectedProduct.asin}</Badge>
                      </BlockStack>
                    )}
                    {selectedProduct?.sku && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">SKU</Text>
                        <Text variant="bodyMd">{selectedProduct.sku}</Text>
                      </BlockStack>
                    )}
                    {availability && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Can Build</Text>
                        <Badge tone={availability.buildable > 0 ? 'success' : 'critical'}>
                          {availability.buildable} units
                        </Badge>
                      </BlockStack>
                    )}
                    {totalCost > 0 && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">BOM Cost</Text>
                        <Text variant="bodyMd" fontWeight="bold">
                          {formatPrice(totalCost)}
                        </Text>
                      </BlockStack>
                    )}
                  </InlineStack>

                  {(bom?.description || selectedProduct?.title) && (
                    <>
                      <Divider />
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Description</Text>
                        <Text variant="bodyMd">
                          {bom?.description || selectedProduct?.title}
                        </Text>
                      </BlockStack>
                    </>
                  )}
                </BlockStack>
              </Card>

              {/* Components & Stock */}
              {bom?.bom_components && bom.bom_components.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">
                        Components ({bom.bom_components.length})
                      </Text>
                      {availability && (
                        <Text variant="bodySm" tone="subdued">
                          Buildable: {availability.buildable} units
                        </Text>
                      )}
                    </InlineStack>

                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      <BlockStack gap="200">
                        {bom.bom_components.map((bc) => {
                          const comp = bc.components;
                          const availComp = availability?.components?.find(
                            (c) => c.component_id === bc.component_id
                          );
                          const isConstraint = availComp?.is_constraint;
                          const isAdjusting = adjustingComponent?.component_id === bc.component_id
                            || adjustingComponent?.id === bc.component_id;

                          return (
                            <div
                              key={bc.id || bc.component_id}
                              style={{
                                padding: '12px',
                                borderRadius: '8px',
                                backgroundColor: isConstraint
                                  ? 'var(--p-color-bg-surface-critical)'
                                  : 'var(--p-color-bg-surface-secondary)',
                              }}
                            >
                              <BlockStack gap="200">
                                <InlineStack gap="200" align="space-between" wrap={false}>
                                  <BlockStack gap="100">
                                    <InlineStack gap="200" blockAlign="center">
                                      <Text variant="bodyMd" fontWeight="semibold">
                                        {comp?.internal_sku || 'Unknown'}
                                      </Text>
                                      <Badge tone="info">×{bc.qty_required}</Badge>
                                      {isConstraint && (
                                        <Badge tone="critical">Constraint</Badge>
                                      )}
                                    </InlineStack>
                                    <Text variant="bodySm" tone="subdued">
                                      {comp?.description || 'No description'}
                                    </Text>
                                  </BlockStack>

                                  <BlockStack gap="100">
                                    <InlineStack gap="300" blockAlign="center">
                                      <BlockStack gap="050">
                                        <Text variant="bodySm" tone="subdued">Stock</Text>
                                        <Text
                                          variant="bodyMd"
                                          fontWeight="semibold"
                                          tone={
                                            (availComp?.available || comp?.total_available || 0) <= 0
                                              ? 'critical'
                                              : undefined
                                          }
                                        >
                                          {availComp?.available ?? comp?.total_available ?? '-'}
                                        </Text>
                                      </BlockStack>
                                      {comp?.cost_ex_vat_pence && (
                                        <BlockStack gap="050">
                                          <Text variant="bodySm" tone="subdued">Cost</Text>
                                          <Text variant="bodyMd">
                                            {formatPrice(comp.cost_ex_vat_pence)}
                                          </Text>
                                        </BlockStack>
                                      )}
                                      <Button
                                        size="slim"
                                        onClick={() => {
                                          if (isAdjusting) {
                                            setAdjustingComponent(null);
                                          } else {
                                            setAdjustingComponent({
                                              ...comp,
                                              component_id: bc.component_id,
                                            });
                                            setAdjustDelta('');
                                            setAdjustNote('');
                                          }
                                        }}
                                      >
                                        {isAdjusting ? 'Cancel' : 'Adjust'}
                                      </Button>
                                    </InlineStack>
                                  </BlockStack>
                                </InlineStack>

                                {/* Stock Adjustment Form */}
                                {isAdjusting && (
                                  <>
                                    <Divider />
                                    <BlockStack gap="200">
                                      <Text variant="bodySm" fontWeight="semibold">
                                        Adjust stock for {comp?.internal_sku}
                                      </Text>
                                      <InlineStack gap="200" wrap>
                                        <div style={{ width: '100px' }}>
                                          <TextField
                                            label="Quantity"
                                            labelHidden
                                            type="number"
                                            value={adjustDelta}
                                            onChange={setAdjustDelta}
                                            placeholder="+/- qty"
                                            autoComplete="off"
                                            helpText="Use negative for removal"
                                          />
                                        </div>
                                        <div style={{ width: '140px' }}>
                                          <Select
                                            label="Reason"
                                            labelHidden
                                            value={adjustReason}
                                            onChange={setAdjustReason}
                                            options={[
                                              { label: 'Recount', value: 'RECOUNT' },
                                              { label: 'Damaged', value: 'DAMAGED' },
                                              { label: 'Lost', value: 'LOST' },
                                              { label: 'Found', value: 'FOUND' },
                                              { label: 'Transfer', value: 'TRANSFER' },
                                              { label: 'Other', value: 'OTHER' },
                                            ]}
                                          />
                                        </div>
                                        <div style={{ flex: 1, minWidth: '150px' }}>
                                          <TextField
                                            label="Note"
                                            labelHidden
                                            value={adjustNote}
                                            onChange={setAdjustNote}
                                            placeholder="Optional note..."
                                            autoComplete="off"
                                          />
                                        </div>
                                        <Button
                                          variant="primary"
                                          onClick={handleAdjustStock}
                                          loading={adjusting}
                                          disabled={!adjustDelta || adjustDelta === '0'}
                                        >
                                          Apply
                                        </Button>
                                      </InlineStack>
                                    </BlockStack>
                                  </>
                                )}
                              </BlockStack>
                            </div>
                          );
                        })}
                      </BlockStack>
                    </div>
                  </BlockStack>
                </Card>
              )}

              {/* No BOM Found */}
              {!bom?.bom_components?.length && !loading && (
                <Banner tone="warning">
                  <p>
                    No BOM found for this product. The product may not have a bill of materials
                    configured yet, or the listing hasn't been mapped to a BOM.
                  </p>
                </Banner>
              )}

              {/* Analytics Info (if available from selected product) */}
              {(selectedProduct?.quantity_sold || selectedProduct?.gross_revenue) && (
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm">Sales Performance</Text>
                    <InlineStack gap="600" wrap>
                      {selectedProduct.quantity_sold !== undefined && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Qty Sold</Text>
                          <Text variant="bodyMd" fontWeight="bold">
                            {selectedProduct.quantity_sold}
                          </Text>
                        </BlockStack>
                      )}
                      {selectedProduct.gross_revenue !== undefined && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Revenue</Text>
                          <Text variant="bodyMd" fontWeight="bold">
                            {formatPrice(selectedProduct.gross_revenue)}
                          </Text>
                        </BlockStack>
                      )}
                      {selectedProduct.cogs !== undefined && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">COGS</Text>
                          <Text variant="bodyMd">
                            {formatPrice(selectedProduct.cogs)}
                          </Text>
                        </BlockStack>
                      )}
                      {selectedProduct.gross_profit !== undefined && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Profit</Text>
                          <Text
                            variant="bodyMd"
                            fontWeight="bold"
                            tone={selectedProduct.gross_profit > 0 ? 'success' : 'critical'}
                          >
                            {formatPrice(selectedProduct.gross_profit)}
                          </Text>
                        </BlockStack>
                      )}
                      {selectedProduct.gross_margin_pct !== undefined && (
                        <BlockStack gap="100">
                          <Text variant="bodySm" tone="subdued">Margin</Text>
                          <Badge
                            tone={
                              parseFloat(selectedProduct.gross_margin_pct) >= 30
                                ? 'success'
                                : parseFloat(selectedProduct.gross_margin_pct) >= 15
                                ? 'info'
                                : 'warning'
                            }
                          >
                            {selectedProduct.gross_margin_pct}%
                          </Badge>
                        </BlockStack>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
