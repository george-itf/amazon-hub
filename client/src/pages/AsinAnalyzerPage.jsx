import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  Select,
  Spinner,
  ProgressBar,
} from '@shopify/polaris';
import { getComponents, analyzeProfitability } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * ASIN Profit Analyzer Page
 * Analyze profitability of an Amazon product by selecting components
 */
export default function AsinAnalyzerPage() {
  // Data state
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form state
  const [asin, setAsin] = useState('');
  const [selectedComponents, setSelectedComponents] = useState({});
  const [componentSearch, setComponentSearch] = useState('');
  const [sizeTier, setSizeTier] = useState('standard');
  const [targetMargin, setTargetMargin] = useState('10');

  // Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);

  // Load components
  useEffect(() => {
    async function loadComponents() {
      setLoading(true);
      try {
        const data = await getComponents({ limit: 99999 });
        setComponents(data.components || []);
      } catch (err) {
        setError(err.message || 'Failed to load components');
      } finally {
        setLoading(false);
      }
    }
    loadComponents();
  }, []);

  // Filter components by search
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
  const selectedCount = Object.values(selectedComponents).filter(
    (qty) => parseInt(qty) > 0
  ).length;

  // Calculate total cost preview
  const totalCostPreview = useMemo(() => {
    let total = 0;
    for (const [compId, qty] of Object.entries(selectedComponents)) {
      const parsedQty = parseInt(qty);
      if (isNaN(parsedQty) || parsedQty <= 0) continue;
      const comp = components.find((c) => c.id === compId);
      if (comp?.cost_ex_vat_pence) {
        total += comp.cost_ex_vat_pence * parsedQty;
      }
    }
    return total;
  }, [selectedComponents, components]);

  // Handle quantity change
  const handleQuantityChange = useCallback((componentId) => {
    return (value) =>
      setSelectedComponents((prev) => ({
        ...prev,
        [componentId]: value,
      }));
  }, []);

  // Handle ASIN paste - extract ASIN from URL if needed
  const handleAsinChange = useCallback((value) => {
    // Check if it's an Amazon URL
    const asinMatch = value.match(/\/dp\/([A-Z0-9]{10})/i) ||
      value.match(/\/product\/([A-Z0-9]{10})/i) ||
      value.match(/asin=([A-Z0-9]{10})/i);

    if (asinMatch) {
      setAsin(asinMatch[1].toUpperCase());
    } else {
      // Clean up the input - remove whitespace and convert to uppercase
      setAsin(value.trim().toUpperCase());
    }
  }, []);

  // Clear form
  const handleClear = useCallback(() => {
    setAsin('');
    setSelectedComponents({});
    setComponentSearch('');
    setSizeTier('standard');
    setTargetMargin('10');
    setAnalysisResult(null);
    setAnalysisError(null);
  }, []);

  // Run analysis
  async function handleAnalyze() {
    if (!asin || selectedCount === 0) return;

    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      const componentsList = Object.entries(selectedComponents)
        .filter(([, qty]) => {
          const parsed = parseInt(qty);
          return !isNaN(parsed) && parsed > 0;
        })
        .map(([component_id, qty_required]) => ({
          component_id,
          qty_required: parseInt(qty_required),
        }));

      const result = await analyzeProfitability({
        asin,
        components: componentsList,
        sizeTier,
        targetMarginPercent: parseInt(targetMargin) || 10,
      });

      setAnalysisResult(result);
    } catch (err) {
      setAnalysisError(err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  // Get recommendation badge
  const getRecommendationBadge = (action) => {
    switch (action) {
      case 'highly_profitable':
        return <Badge tone="success">Highly Profitable</Badge>;
      case 'profitable':
        return <Badge tone="success">Profitable</Badge>;
      case 'marginal':
        return <Badge tone="warning">Marginal</Badge>;
      case 'unprofitable':
        return <Badge tone="critical">Unprofitable</Badge>;
      default:
        return <Badge>Review Needed</Badge>;
    }
  };

  // Get sales velocity badge
  const getSalesVelocityBadge = (indicator) => {
    switch (indicator) {
      case 'excellent':
        return <Badge tone="success">Excellent Sales</Badge>;
      case 'good':
        return <Badge tone="success">Good Sales</Badge>;
      case 'moderate':
        return <Badge tone="info">Moderate Sales</Badge>;
      case 'low':
        return <Badge tone="warning">Low Sales</Badge>;
      case 'very_low':
        return <Badge tone="critical">Very Low Sales</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  if (loading) {
    return (
      <Page title="ASIN Profit Analyzer">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <Spinner accessibilityLabel="Loading" size="large" />
        </div>
      </Page>
    );
  }

  return (
    <Page
      title="ASIN Profit Analyzer"
      subtitle="Analyze profitability for any Amazon product"
      secondaryActions={[{ content: 'Clear', onAction: handleClear }]}
    >
      <Layout>
        {/* Input Section */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            {/* ASIN Input */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Product ASIN</Text>
                <TextField
                  label="ASIN or Amazon URL"
                  value={asin}
                  onChange={handleAsinChange}
                  placeholder="B07XYZ1234 or paste Amazon URL"
                  autoComplete="off"
                  helpText="Paste an ASIN or full Amazon product URL"
                />

                <Select
                  label="Size Tier"
                  options={[
                    { label: 'Small (envelope)', value: 'small' },
                    { label: 'Standard', value: 'standard' },
                    { label: 'Large', value: 'large' },
                    { label: 'Oversize', value: 'oversize' },
                  ]}
                  value={sizeTier}
                  onChange={setSizeTier}
                  helpText="Affects FBA fulfillment fee"
                />

                <TextField
                  label="Target Margin %"
                  type="number"
                  value={targetMargin}
                  onChange={setTargetMargin}
                  min="0"
                  max="100"
                  helpText="We'll calculate the price needed for this margin"
                />
              </BlockStack>
            </Card>

            {/* Component Selector */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd">Components ({selectedCount} selected)</Text>
                  {totalCostPreview > 0 && (
                    <Text variant="bodySm" tone="subdued">
                      Cost: {formatPrice(totalCostPreview)}
                    </Text>
                  )}
                </InlineStack>

                <TextField
                  label="Search components"
                  labelHidden
                  placeholder="Search components..."
                  value={componentSearch}
                  onChange={setComponentSearch}
                  clearButton
                  onClearButtonClick={() => setComponentSearch('')}
                  autoComplete="off"
                />

                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <BlockStack gap="200">
                    {filteredComponents.length === 0 ? (
                      <Text tone="subdued">No components match "{componentSearch}"</Text>
                    ) : (
                      filteredComponents.slice(0, 50).map((c) => {
                        const currentQty = selectedComponents[c.id] || '';
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
                                <Text variant="bodySm" tone="subdued">
                                  {formatPrice(c.cost_ex_vat_pence)} each
                                </Text>
                              </div>
                              <div style={{ width: '70px' }}>
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
                    {filteredComponents.length > 50 && (
                      <Text tone="subdued">
                        Showing 50 of {filteredComponents.length}. Use search to narrow down.
                      </Text>
                    )}
                  </BlockStack>
                </div>

                {selectedCount > 0 && (
                  <>
                    <Divider />
                    <Text variant="headingSm">Selected:</Text>
                    <InlineStack gap="200" wrap>
                      {Object.entries(selectedComponents)
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

                <Button
                  variant="primary"
                  onClick={handleAnalyze}
                  loading={analyzing}
                  disabled={!asin || selectedCount === 0}
                  fullWidth
                >
                  Analyze Profitability
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Results Section */}
        <Layout.Section>
          <BlockStack gap="400">
            {analysisError && (
              <Banner tone="critical" onDismiss={() => setAnalysisError(null)}>
                <p>{analysisError}</p>
              </Banner>
            )}

            {analyzing && (
              <Card>
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner accessibilityLabel="Analyzing" size="large" />
                  <Text variant="bodyMd" tone="subdued">
                    Fetching Keepa data and calculating profits...
                  </Text>
                </div>
              </Card>
            )}

            {analysisResult && !analyzing && (
              <>
                {/* Product Info */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200">
                          <Text variant="headingLg">{analysisResult.product?.title || 'Unknown Product'}</Text>
                          {getRecommendationBadge(analysisResult.recommendation?.action)}
                        </InlineStack>
                        <Text variant="bodySm" tone="subdued">ASIN: {analysisResult.product?.asin}</Text>
                        <Text variant="bodySm" tone="subdued">Category: {analysisResult.product?.category}</Text>
                      </BlockStack>
                      {analysisResult.product?.imageUrl && (
                        <img
                          src={analysisResult.product.imageUrl}
                          alt={analysisResult.product.title}
                          style={{ width: '80px', height: '80px', objectFit: 'contain' }}
                        />
                      )}
                    </InlineStack>

                    <Banner tone={analysisResult.recommendation?.action === 'unprofitable' ? 'warning' : 'info'}>
                      <p>{analysisResult.recommendation?.summary}</p>
                    </Banner>
                  </BlockStack>
                </Card>

                {/* Key Metrics */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Key Metrics</Text>
                    <InlineStack gap="800" wrap>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Current Price</Text>
                        <Text variant="headingLg" fontWeight="bold">
                          {formatPrice(analysisResult.product?.currentPricePence)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Your Cost</Text>
                        <Text variant="headingLg">
                          {formatPrice(analysisResult.costs?.totalCostPence)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Amazon Fees</Text>
                        <Text variant="headingLg">
                          {formatPrice(analysisResult.profitAtCurrentPrice?.fees)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Net Profit</Text>
                        <Text
                          variant="headingLg"
                          fontWeight="bold"
                          tone={analysisResult.profitAtCurrentPrice?.netProfit >= 0 ? 'success' : 'critical'}
                        >
                          {formatPrice(analysisResult.profitAtCurrentPrice?.netProfit)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Net Margin</Text>
                        <Text
                          variant="headingLg"
                          fontWeight="bold"
                          tone={analysisResult.profitAtCurrentPrice?.netMarginPercent >= 10 ? 'success' :
                            analysisResult.profitAtCurrentPrice?.netMarginPercent >= 0 ? 'warning' : 'critical'}
                        >
                          {analysisResult.profitAtCurrentPrice?.netMarginPercent || 0}%
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">ROI</Text>
                        <Text variant="headingLg">
                          {analysisResult.profitAtCurrentPrice?.roi || 0}%
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Price Targets */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Price Targets</Text>
                    <InlineStack gap="800" wrap>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Break-Even Price</Text>
                        <Text variant="headingMd">
                          £{analysisResult.breakEvenPricePounds}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Price for {analysisResult.targetPriceAnalysis?.targetMarginPercent}% Margin</Text>
                        <Text variant="headingMd" fontWeight="bold">
                          £{analysisResult.targetPriceAnalysis?.targetPricePounds || '-'}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Current Price</Text>
                        <Text variant="headingMd">
                          {formatPrice(analysisResult.product?.currentPricePence)}
                        </Text>
                      </BlockStack>
                    </InlineStack>

                    {analysisResult.product?.currentPricePence && analysisResult.targetPriceAnalysis?.targetPricePence && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">
                          Price vs Target ({analysisResult.targetPriceAnalysis?.targetMarginPercent}% margin)
                        </Text>
                        <ProgressBar
                          progress={Math.min(100, (analysisResult.product.currentPricePence / analysisResult.targetPriceAnalysis.targetPricePence) * 100)}
                          tone={analysisResult.product.currentPricePence >= analysisResult.targetPriceAnalysis.targetPricePence ? 'success' : 'warning'}
                        />
                        <Text variant="bodySm">
                          {analysisResult.product.currentPricePence >= analysisResult.targetPriceAnalysis.targetPricePence
                            ? 'Current price meets target margin'
                            : `Need £${((analysisResult.targetPriceAnalysis.targetPricePence - analysisResult.product.currentPricePence) / 100).toFixed(2)} more to hit target`}
                        </Text>
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>

                {/* Sales Velocity */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="headingMd">Sales Velocity</Text>
                      {getSalesVelocityBadge(analysisResult.salesVelocity?.indicator)}
                    </InlineStack>

                    <InlineStack gap="800" wrap>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Sales Rank</Text>
                        <Text variant="headingMd">
                          #{analysisResult.product?.salesRank?.toLocaleString() || '-'}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Est. Monthly Sales</Text>
                        <Text variant="headingMd">
                          {analysisResult.salesVelocity?.estimatedMonthlySales || '-'}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Competitors</Text>
                        <Text variant="headingMd">
                          {analysisResult.product?.offerCount || '-'}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Rating</Text>
                        <Text variant="headingMd">
                          {analysisResult.product?.rating ? `${analysisResult.product.rating}/5` : '-'}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Reviews</Text>
                        <Text variant="headingMd">
                          {analysisResult.product?.reviewCount?.toLocaleString() || '-'}
                        </Text>
                      </BlockStack>
                    </InlineStack>

                    <Text variant="bodySm" tone="subdued">
                      {analysisResult.salesVelocity?.description}
                    </Text>
                  </BlockStack>
                </Card>

                {/* Fee Breakdown */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Fee Breakdown</Text>
                    <InlineStack gap="800" wrap>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Referral Fee ({analysisResult.feeConfig?.referralFeePercent}%)</Text>
                        <Text variant="headingMd">
                          {formatPrice(analysisResult.profitAtCurrentPrice?.feeBreakdown?.referralFeeAmount)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">FBA Fee ({analysisResult.feeConfig?.sizeTier})</Text>
                        <Text variant="headingMd">
                          {formatPrice(analysisResult.feeConfig?.fbaFeePence)}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Total Fees</Text>
                        <Text variant="headingMd" fontWeight="bold">
                          {formatPrice(analysisResult.profitAtCurrentPrice?.fees)}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Component Cost Breakdown */}
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Component Cost Breakdown</Text>
                    {analysisResult.costs?.componentBreakdown?.map((comp) => (
                      <InlineStack key={comp.component_id} align="space-between">
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold">{comp.internal_sku}</Text>
                          <Text variant="bodySm" tone="subdued">{comp.description}</Text>
                        </BlockStack>
                        <InlineStack gap="400">
                          <Text variant="bodySm" tone="subdued">
                            {comp.qty_required} × {formatPrice(comp.unit_cost_pence)}
                          </Text>
                          <Text variant="bodyMd" fontWeight="semibold">
                            {formatPrice(comp.line_cost_pence)}
                          </Text>
                        </InlineStack>
                      </InlineStack>
                    ))}
                    <Divider />
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" fontWeight="bold">Total Cost</Text>
                      <Text variant="bodyMd" fontWeight="bold">
                        {formatPrice(analysisResult.costs?.totalCostPence)}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </>
            )}

            {!analysisResult && !analyzing && (
              <Card>
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">Ready to Analyze</Text>
                    <Text tone="subdued">
                      Enter an ASIN, select the components that make up this product,
                      and click "Analyze Profitability" to see detailed profit calculations.
                    </Text>
                    <Text tone="subdued">
                      We'll fetch current pricing from Keepa, calculate Amazon fees,
                      and show you the profit at current price plus what price you'd need for your target margin.
                    </Text>
                  </BlockStack>
                </div>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
