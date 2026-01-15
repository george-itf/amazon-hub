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
  DataTable,
  Tabs,
  Modal,
  Thumbnail,
  EmptyState,
  ProgressBar,
  Tooltip,
  Icon,
  Autocomplete,
} from '@shopify/polaris';
import {
  SearchIcon,
  ChartVerticalFilledIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@shopify/polaris-icons';
import {
  analyzeAsins,
  reverseSearchComponent,
  getComponents,
} from '../utils/api.jsx';
import ScoreBadge, { ScoreCard } from '../components/ScoreBadge.jsx';
import BomSuggestionPopover from '../components/BomSuggestionPopover.jsx';
import { useProductModal } from '../context/ProductModalContext.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Format percentage
 */
function formatPercent(value) {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

/**
 * ASIN Analyzer Page
 * Multi-ASIN analysis with scoring, BOM suggestions, and reverse search
 */
export default function AsinAnalyzerPage() {
  const { openProductModal } = useProductModal();

  // Tab state
  const [selectedTab, setSelectedTab] = useState(0);

  // Analyze tab state
  const [asinInput, setAsinInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [analyzeError, setAnalyzeError] = useState(null);

  // Scoring options
  const [minMargin, setMinMargin] = useState('10');
  const [targetMargin, setTargetMargin] = useState('15');
  const [horizonDays, setHorizonDays] = useState('14');

  // Detail drawer state
  const [selectedResult, setSelectedResult] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reverse search state
  const [components, setComponents] = useState([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [componentSearchText, setComponentSearchText] = useState('');
  const [reverseResults, setReverseResults] = useState([]);
  const [reverseSearching, setReverseSearching] = useState(false);
  const [reverseError, setReverseError] = useState(null);

  // Load components for reverse search
  useEffect(() => {
    if (selectedTab === 1 && components.length === 0) {
      loadComponents();
    }
  }, [selectedTab]);

  const loadComponents = async () => {
    setComponentsLoading(true);
    try {
      const data = await getComponents({ limit: 99999 });
      setComponents(data.components || []);
    } catch (err) {
      console.error('Failed to load components:', err);
    } finally {
      setComponentsLoading(false);
    }
  };

  // Parse ASINs from input
  const parsedAsins = useMemo(() => {
    if (!asinInput.trim()) return [];
    return [...new Set(
      asinInput
        .split(/[\n,;\s]+/)
        .map(a => {
          // Extract ASIN from Amazon URLs
          const urlMatch = a.match(/\/dp\/([A-Z0-9]{10})/i) ||
            a.match(/\/product\/([A-Z0-9]{10})/i) ||
            a.match(/asin=([A-Z0-9]{10})/i);
          if (urlMatch) return urlMatch[1].toUpperCase();
          return a.trim().toUpperCase();
        })
        .filter(a => /^[A-Z0-9]{10}$/.test(a))
    )];
  }, [asinInput]);

  // Run analysis
  const handleAnalyze = async () => {
    if (parsedAsins.length === 0) return;

    setAnalyzing(true);
    setAnalyzeError(null);
    setResults([]);
    setMeta(null);

    try {
      const data = await analyzeAsins({
        asins: parsedAsins,
        scoring: {
          min_margin: parseInt(minMargin) || 10,
          target_margin: parseInt(targetMargin) || 15,
          horizon_days: parseInt(horizonDays) || 14,
        },
      });

      setResults(data.results || []);
      setMeta(data.meta || null);
    } catch (err) {
      setAnalyzeError(err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  // Handle BOM selection change
  const handleBomChange = (resultIndex, bomId, bomSku) => {
    setResults(prev => {
      const updated = [...prev];
      updated[resultIndex] = {
        ...updated[resultIndex],
        bom_suggestion: {
          ...updated[resultIndex].bom_suggestion,
          suggested_bom_id: bomId,
          suggested_bom_name: bomSku,
        },
      };
      return updated;
    });
  };

  // Open detail drawer
  const openDrawer = (result) => {
    setSelectedResult(result);
    setDrawerOpen(true);
  };

  // Reverse search
  const handleReverseSearch = async () => {
    if (!selectedComponent) return;

    setReverseSearching(true);
    setReverseError(null);
    setReverseResults([]);

    try {
      const data = await reverseSearchComponent({
        component_id: selectedComponent.id,
        horizon_days: parseInt(horizonDays) || 14,
      });
      setReverseResults(data.opportunities || []);
    } catch (err) {
      setReverseError(err.message || 'Reverse search failed');
    } finally {
      setReverseSearching(false);
    }
  };

  // Component autocomplete options
  const componentOptions = useMemo(() => {
    if (!componentSearchText) return [];
    const query = componentSearchText.toLowerCase();
    return components
      .filter(c =>
        c.internal_sku?.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
      )
      .slice(0, 10)
      .map(c => ({
        value: c.id,
        label: `${c.internal_sku} - ${c.description || 'No description'}`,
        component: c,
      }));
  }, [componentSearchText, components]);

  // Clear analysis
  const handleClear = () => {
    setAsinInput('');
    setResults([]);
    setMeta(null);
    setAnalyzeError(null);
  };

  const tabs = [
    { id: 'analyze', content: 'Analyze ASINs' },
    { id: 'reverse', content: 'Reverse Search' },
  ];

  // Action badge helper
  const getActionBadge = (action) => {
    const badges = {
      LIST_TEST: { tone: 'success', text: 'List & Test' },
      MAP_BOM: { tone: 'warning', text: 'Map BOM' },
      BUY_STOCK: { tone: 'info', text: 'Buy Stock' },
      DO_NOT_LIST: { tone: 'critical', text: 'Do Not List' },
      INVESTIGATE: { tone: undefined, text: 'Investigate' },
    };
    const b = badges[action] || badges.INVESTIGATE;
    return <Badge tone={b.tone}>{b.text}</Badge>;
  };

  return (
    <Page
      title="ASIN Analyzer"
      subtitle="Analyze ASINs for listing opportunities with explainable scoring"
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        {/* Analyze ASINs Tab */}
        {selectedTab === 0 && (
          <BlockStack gap="400">
            {/* Input Section */}
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">ASINs to Analyze</Text>
                    <TextField
                      label="Paste ASINs"
                      labelHidden
                      multiline={6}
                      value={asinInput}
                      onChange={setAsinInput}
                      placeholder="Paste ASINs (one per line) or Amazon URLs..."
                      autoComplete="off"
                      helpText={`${parsedAsins.length} valid ASINs detected`}
                    />

                    <Divider />

                    <Text variant="headingSm">Scoring Options</Text>
                    <InlineStack gap="200">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Min Margin %"
                          type="number"
                          value={minMargin}
                          onChange={setMinMargin}
                          min="0"
                          max="100"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Target Margin %"
                          type="number"
                          value={targetMargin}
                          onChange={setTargetMargin}
                          min="0"
                          max="100"
                        />
                      </div>
                    </InlineStack>
                    <TextField
                      label="Forecast Horizon (days)"
                      type="number"
                      value={horizonDays}
                      onChange={setHorizonDays}
                      min="1"
                      max="90"
                    />

                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        onClick={handleAnalyze}
                        loading={analyzing}
                        disabled={parsedAsins.length === 0}
                      >
                        Analyze {parsedAsins.length > 0 ? `(${parsedAsins.length})` : ''}
                      </Button>
                      <Button onClick={handleClear} disabled={analyzing}>
                        Clear
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Data Quality Warnings */}
                {meta && (meta.invalid_asins?.length > 0 || meta.unresolved_asins?.length > 0 || meta.keepa_warning || !meta.has_demand_model) && (
                  <Card>
                    <BlockStack gap="200">
                      <Text variant="headingSm">Warnings</Text>
                      {meta.keepa_warning && (
                        <Banner tone="critical">
                          <strong>Keepa API Error:</strong> {meta.keepa_warning}
                          {meta.keepa_warning.includes('not configured') && (
                            <Text variant="bodySm">
                              Set KEEPA_API_KEY environment variable to enable product data.
                            </Text>
                          )}
                        </Banner>
                      )}
                      {meta.invalid_asins?.length > 0 && (
                        <Banner tone="warning">
                          {meta.invalid_asins.length} invalid ASINs skipped
                        </Banner>
                      )}
                      {meta.unresolved_asins?.length > 0 && (
                        <Banner tone="info">
                          {meta.unresolved_asins.length} ASINs missing Keepa data
                        </Banner>
                      )}
                      {!meta.has_demand_model && (
                        <Banner tone="warning">
                          No demand model active - forecasts unavailable
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>
                )}
              </Layout.Section>

              {/* Results Section */}
              <Layout.Section>
                {analyzeError && (
                  <Banner tone="critical" onDismiss={() => setAnalyzeError(null)}>
                    {analyzeError}
                  </Banner>
                )}

                {analyzing && (
                  <Card>
                    <BlockStack gap="400" inlineAlign="center">
                      <Spinner size="large" />
                      <Text>Analyzing {parsedAsins.length} ASINs...</Text>
                    </BlockStack>
                  </Card>
                )}

                {!analyzing && results.length > 0 && (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text variant="headingMd">
                          Results ({results.length} ASINs)
                        </Text>
                        <InlineStack gap="200">
                          <Badge tone="success">{results.filter(r => r.score?.band === 'GREEN').length} Green</Badge>
                          <Badge tone="warning">{results.filter(r => r.score?.band === 'AMBER').length} Amber</Badge>
                          <Badge tone="critical">{results.filter(r => r.score?.band === 'RED').length} Red</Badge>
                        </InlineStack>
                      </InlineStack>

                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text', 'numeric', 'text']}
                        headings={['Score', 'ASIN', 'Title', 'Price', 'Margin', 'Forecast', 'BOM', 'Buildable', 'Action']}
                        rows={results.map((r, idx) => [
                          <ScoreBadge key="score" score={r.score} />,
                          <button
                            key="asin"
                            onClick={() => openProductModal({ asin: r.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              color: 'var(--p-color-text-emphasis)',
                            }}
                          >
                            {r.asin}
                          </button>,
                          <Tooltip key="title" content={r.title || 'Unknown'}>
                            <Text variant="bodySm">
                              {r.title ? (r.title.length > 30 ? r.title.substring(0, 30) + '...' : r.title) : '-'}
                            </Text>
                          </Tooltip>,
                          formatPrice(r.finance?.price_pence),
                          <Badge
                            key="margin"
                            tone={
                              r.finance?.margin_percent >= 15 ? 'success' :
                              r.finance?.margin_percent >= 10 ? 'info' :
                              r.finance?.margin_percent !== null ? 'critical' : undefined
                            }
                          >
                            {formatPercent(r.finance?.margin_percent)}
                          </Badge>,
                          r.demand?.forecast_units_horizon?.toFixed(1) || '-',
                          <BomSuggestionPopover
                            key="bom"
                            asin={r.asin}
                            title={r.title}
                            currentBomId={r.bom_suggestion?.suggested_bom_id}
                            currentBomName={r.bom_suggestion?.suggested_bom_name}
                            confidence={r.bom_suggestion?.confidence}
                            onSelect={(bomId, bomSku) => handleBomChange(idx, bomId, bomSku)}
                          />,
                          r.feasibility?.buildable_units ?? '-',
                          <InlineStack key="action" gap="100">
                            {getActionBadge(r.actions?.suggested_next_step)}
                            <Button size="slim" onClick={() => openDrawer(r)}>
                              Details
                            </Button>
                          </InlineStack>,
                        ])}
                        footerContent={`Analyzed ${results.length} ASINs`}
                      />
                    </BlockStack>
                  </Card>
                )}

                {!analyzing && results.length === 0 && !analyzeError && (
                  <Card>
                    <EmptyState
                      heading="Ready to Analyze"
                      image=""
                    >
                      <p>
                        Paste ASINs or Amazon URLs in the input field and click "Analyze"
                        to see profitability scores, BOM suggestions, and stock feasibility.
                      </p>
                    </EmptyState>
                  </Card>
                )}
              </Layout.Section>
            </Layout>
          </BlockStack>
        )}

        {/* Reverse Search Tab */}
        {selectedTab === 1 && (
          <BlockStack gap="400">
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd">Reverse Search</Text>
                    <Text variant="bodySm" tone="subdued">
                      Select a component to find all ASINs/listings that use it,
                      ranked by profit opportunity.
                    </Text>

                    {componentsLoading ? (
                      <InlineStack gap="200" blockAlign="center">
                        <Spinner size="small" />
                        <Text tone="subdued">Loading components...</Text>
                      </InlineStack>
                    ) : (
                      <Autocomplete
                        options={componentOptions}
                        selected={selectedComponent ? [selectedComponent.id] : []}
                        onSelect={(selected) => {
                          const opt = componentOptions.find(o => o.value === selected[0]);
                          setSelectedComponent(opt?.component || null);
                          setComponentSearchText(opt?.component?.internal_sku || '');
                        }}
                        textField={
                          <Autocomplete.TextField
                            onChange={setComponentSearchText}
                            value={componentSearchText}
                            label="Component"
                            placeholder="Search components..."
                            autoComplete="off"
                          />
                        }
                      />
                    )}

                    {selectedComponent && (
                      <Banner tone="info">
                        Selected: <strong>{selectedComponent.internal_sku}</strong>
                        <br />
                        {selectedComponent.description}
                      </Banner>
                    )}

                    <TextField
                      label="Forecast Horizon (days)"
                      type="number"
                      value={horizonDays}
                      onChange={setHorizonDays}
                      min="1"
                      max="90"
                    />

                    <Button
                      variant="primary"
                      onClick={handleReverseSearch}
                      loading={reverseSearching}
                      disabled={!selectedComponent}
                    >
                      Search Opportunities
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section>
                {reverseError && (
                  <Banner tone="critical" onDismiss={() => setReverseError(null)}>
                    {reverseError}
                  </Banner>
                )}

                {reverseSearching && (
                  <Card>
                    <BlockStack gap="400" inlineAlign="center">
                      <Spinner size="large" />
                      <Text>Searching opportunities...</Text>
                    </BlockStack>
                  </Card>
                )}

                {!reverseSearching && reverseResults.length > 0 && (
                  <Card>
                    <BlockStack gap="400">
                      <Text variant="headingMd">
                        Opportunities ({reverseResults.length})
                      </Text>

                      <DataTable
                        columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric']}
                        headings={['ASIN', 'BOM', 'Price', 'Margin', 'Forecast', 'Expected Profit', 'Buildable', 'Days Cover']}
                        rows={reverseResults.map((r) => [
                          <button
                            key="asin"
                            onClick={() => openProductModal({ asin: r.asin })}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              color: 'var(--p-color-text-emphasis)',
                            }}
                          >
                            {r.asin}
                          </button>,
                          r.bom_sku || '-',
                          formatPrice(r.price_pence),
                          <Badge
                            key="margin"
                            tone={
                              r.margin_percent >= 15 ? 'success' :
                              r.margin_percent >= 10 ? 'info' :
                              r.margin_percent !== null ? 'critical' : undefined
                            }
                          >
                            {formatPercent(r.margin_percent)}
                          </Badge>,
                          r.forecast_units?.toFixed(1) || '-',
                          formatPrice(r.expected_profit_pence),
                          r.buildable_units ?? '-',
                          r.days_of_cover ?? '-',
                        ])}
                        footerContent={`${reverseResults.length} opportunities found`}
                      />
                    </BlockStack>
                  </Card>
                )}

                {!reverseSearching && reverseResults.length === 0 && selectedComponent && !reverseError && (
                  <Card>
                    <EmptyState heading="No Results" image="">
                      <p>Click "Search Opportunities" to find listings using this component.</p>
                    </EmptyState>
                  </Card>
                )}

                {!reverseSearching && !selectedComponent && (
                  <Card>
                    <EmptyState heading="Select a Component" image="">
                      <p>
                        Choose a component from your inventory to see which ASINs/listings
                        use it, ranked by expected profit opportunity.
                      </p>
                    </EmptyState>
                  </Card>
                )}
              </Layout.Section>
            </Layout>
          </BlockStack>
        )}
      </Tabs>

      {/* Detail Drawer Modal */}
      <Modal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`Analysis: ${selectedResult?.asin || ''}`}
        large
      >
        <Modal.Section>
          {selectedResult && (
            <BlockStack gap="400">
              {/* Product Info */}
              <InlineStack gap="400" blockAlign="start">
                {selectedResult.image_url && (
                  <Thumbnail
                    source={selectedResult.image_url}
                    alt={selectedResult.title || 'Product'}
                    size="large"
                  />
                )}
                <BlockStack gap="200">
                  <Text variant="headingMd">{selectedResult.title || 'Unknown Product'}</Text>
                  <Text variant="bodySm" tone="subdued">ASIN: {selectedResult.asin}</Text>
                  {selectedResult.brand && (
                    <Text variant="bodySm" tone="subdued">Brand: {selectedResult.brand}</Text>
                  )}
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Score Card */}
              <ScoreCard score={selectedResult.score} />

              <Divider />

              {/* Finance Section */}
              <Text variant="headingSm">Financial Analysis</Text>
              <InlineStack gap="600" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Buy Box Price</Text>
                  <Text variant="headingMd">{formatPrice(selectedResult.finance?.price_pence)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">COGS</Text>
                  <Text variant="headingMd">{formatPrice(selectedResult.finance?.cogs_pence)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Fees ({(selectedResult.finance?.fee_rate * 100).toFixed(0)}%)</Text>
                  <Text variant="headingMd">{formatPrice(selectedResult.finance?.fees_pence)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Profit/Unit</Text>
                  <Text
                    variant="headingMd"
                    tone={selectedResult.finance?.profit_pence > 0 ? 'success' : 'critical'}
                  >
                    {formatPrice(selectedResult.finance?.profit_pence)}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Margin</Text>
                  <Text
                    variant="headingMd"
                    tone={
                      selectedResult.finance?.margin_percent >= 15 ? 'success' :
                      selectedResult.finance?.margin_percent >= 10 ? undefined : 'critical'
                    }
                  >
                    {formatPercent(selectedResult.finance?.margin_percent)}
                  </Text>
                </BlockStack>
              </InlineStack>

              {/* Minimum Prices */}
              <InlineStack gap="400">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Min Price for 10% Margin</Text>
                  <Text variant="bodyMd">{formatPrice(selectedResult.finance?.min_price_for_10_margin_pence)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Min Price for 15% Margin</Text>
                  <Text variant="bodyMd">{formatPrice(selectedResult.finance?.min_price_for_15_margin_pence)}</Text>
                </BlockStack>
              </InlineStack>

              {selectedResult.finance?.fees_estimated && (
                <Banner tone="warning">
                  Fee rate estimated at {(selectedResult.finance.fee_rate * 100).toFixed(0)}% - actual may vary by category.
                </Banner>
              )}

              <Divider />

              {/* Demand Section */}
              <Text variant="headingSm">Demand Forecast</Text>
              <InlineStack gap="600" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Units/Day</Text>
                  <Text variant="headingMd">
                    {selectedResult.demand?.units_per_day_pred?.toFixed(2) || '-'}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Forecast ({selectedResult.demand?.horizon_days}d)</Text>
                  <Text variant="headingMd">
                    {selectedResult.demand?.forecast_units_horizon?.toFixed(1) || '-'} units
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Source</Text>
                  <Badge>{selectedResult.demand?.source || 'N/A'}</Badge>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Feasibility Section */}
              <Text variant="headingSm">Stock Feasibility</Text>
              <InlineStack gap="600" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Buildable Units</Text>
                  <Text variant="headingMd">
                    {selectedResult.feasibility?.buildable_units ?? '-'}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Days of Cover</Text>
                  <Text variant="headingMd">
                    {selectedResult.feasibility?.days_of_cover ?? '-'}
                  </Text>
                </BlockStack>
              </InlineStack>

              {selectedResult.feasibility?.notes?.length > 0 && (
                <BlockStack gap="100">
                  {selectedResult.feasibility.notes.map((note, i) => (
                    <Banner key={i} tone="info">{note}</Banner>
                  ))}
                </BlockStack>
              )}

              <Divider />

              {/* What Would Make This Green */}
              <Text variant="headingSm">What Would Make This Green?</Text>
              <BlockStack gap="200">
                {selectedResult.score?.band === 'GREEN' ? (
                  <Banner tone="success">
                    <Icon source={CheckCircleIcon} /> This ASIN already scores GREEN!
                  </Banner>
                ) : (
                  <>
                    {selectedResult.finance?.margin_percent < 10 && (
                      <Banner>
                        <Text variant="bodySm">
                          <strong>Improve Margin:</strong> Current {formatPercent(selectedResult.finance.margin_percent)}.
                          Need price ≥ {formatPrice(selectedResult.finance.min_price_for_10_margin_pence)} for 10% margin,
                          or reduce COGS by {formatPrice((selectedResult.finance.cogs_pence || 0) - (selectedResult.finance.price_pence * 0.75 - selectedResult.finance.fees_pence))}.
                        </Text>
                      </Banner>
                    )}
                    {!selectedResult.bom_suggestion?.suggested_bom_id && (
                      <Banner>
                        <Text variant="bodySm">
                          <strong>Map a BOM:</strong> COGS cannot be calculated without a BOM mapping.
                        </Text>
                      </Banner>
                    )}
                    {selectedResult.feasibility?.buildable_units < 10 && (
                      <Banner>
                        <Text variant="bodySm">
                          <strong>Increase Stock:</strong> Only {selectedResult.feasibility.buildable_units} buildable units.
                          Consider ordering more components.
                        </Text>
                      </Banner>
                    )}
                    {selectedResult.keepa?.price_volatility_pct > 8 && (
                      <Banner>
                        <Text variant="bodySm">
                          <strong>Price Stability:</strong> High volatility ({formatPercent(selectedResult.keepa.price_volatility_pct)}).
                          Wait for buy box to stabilize.
                        </Text>
                      </Banner>
                    )}
                  </>
                )}
              </BlockStack>

              <Divider />

              {/* Actions */}
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  disabled={!selectedResult.actions?.can_create_listing_memory}
                >
                  Create Listing Mapping
                </Button>
                <Button>Add to Review Queue</Button>
              </InlineStack>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
