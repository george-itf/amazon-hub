import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Divider,
  TextField,
  Select,
  DataTable,
  Modal,
  Tabs,
  ProgressBar,
  Checkbox,
  EmptyState,
  Tooltip,
  Icon,
  Collapsible,
  List,
} from '@shopify/polaris';
import {
  ChartVerticalFilledIcon,
  PackageIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  RefreshIcon,
} from '@shopify/polaris-icons';
import { InvictaLoading, InvictaButton } from '../components/ui/index.jsx';
import { useProductModal } from '../context/ProductModalContext.jsx';
import * as api from '../utils/api.jsx';

/**
 * Staleness threshold in minutes
 */
const STALENESS_THRESHOLD_MINUTES = 5;

/**
 * Threshold for typed confirmation (units)
 */
const TYPED_CONFIRMATION_THRESHOLD = 100;

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

/**
 * Format percentage
 */
function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(decimals)}%`;
}

/**
 * KPI Card Component - Memoized
 */
const KPICard = memo(function KPICard({ title, value, subtitle, tone, icon }) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="bodySm" tone="subdued">{title}</Text>
          {icon && <Icon source={icon} tone="subdued" />}
        </InlineStack>
        <Text variant="heading2xl" fontWeight="bold" tone={tone}>
          {value}
        </Text>
        {subtitle && (
          <Text variant="bodySm" tone="subdued">{subtitle}</Text>
        )}
      </BlockStack>
    </Card>
  );
});

/**
 * Pool Selection Card Component - Uses design system - Memoized
 */
const PoolCard = memo(function PoolCard({ pool, selected, onSelect }) {
  const isLowStock = pool.available < 10;
  const isOutOfStock = pool.available === 0;

  const statusClass = isOutOfStock
    ? 'hub-stat-card--critical'
    : isLowStock
      ? 'hub-stat-card--warning'
      : '';

  return (
    <div
      onClick={() => onSelect(pool)}
      className={`hub-stat-card hub-stat-card--clickable ${selected ? 'hub-stat-card--highlighted' : ''} ${statusClass}`}
      style={{ marginBottom: 'var(--hub-space-sm)' }}
    >
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="bodyMd" fontWeight="semibold">{pool.internal_sku}</Text>
          <Badge tone={isOutOfStock ? 'critical' : isLowStock ? 'warning' : 'success'}>
            {pool.available} available
          </Badge>
        </InlineStack>
        {pool.description && (
          <Text variant="bodySm" tone="subdued">
            {pool.description.substring(0, 60)}{pool.description.length > 60 ? '...' : ''}
          </Text>
        )}
        <InlineStack gap="200">
          <Badge tone="info">{pool.bom_count} BOMs</Badge>
          <Text variant="bodySm" tone="subdued">
            {pool.boms?.slice(0, 3).map(b => b.bundle_sku).join(', ')}
            {pool.boms?.length > 3 ? ` +${pool.boms.length - 3} more` : ''}
          </Text>
        </InlineStack>
      </BlockStack>
    </div>
  );
});

/**
 * Demand Source Badge - Memoized
 */
const DemandSourceBadge = memo(function DemandSourceBadge({ source }) {
  const tones = {
    INTERNAL: 'success',
    BLENDED: 'info',
    KEEPA_MODEL: 'attention',
    FALLBACK: 'warning',
  };

  const labels = {
    INTERNAL: 'Internal Data',
    BLENDED: 'Blended',
    KEEPA_MODEL: 'Keepa Model',
    FALLBACK: 'Fallback',
  };

  return (
    <Badge tone={tones[source] || 'default'}>
      {labels[source] || source}
    </Badge>
  );
});

/**
 * AllocationPage - Intelligent stock allocation across Amazon listings
 *
 * When multiple listings share a common component (like tool cores, batteries, etc.),
 * this page helps optimize how to distribute limited inventory across those listings
 * to maximize revenue while respecting margin constraints.
 */
export default function AllocationPage() {
  const { openProductModal } = useProductModal();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Pool selection state
  const [pools, setPools] = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [selectedPool, setSelectedPool] = useState(null);
  const [poolSearch, setPoolSearch] = useState('');

  // Allocation parameters
  const [minMargin, setMinMargin] = useState('10');
  const [targetMargin, setTargetMargin] = useState('15');
  const [bufferUnits, setBufferUnits] = useState('1');

  // Preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Apply state
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [forceApply, setForceApply] = useState(false);

  // Explain panel state
  const [explainPanelOpen, setExplainPanelOpen] = useState(false);

  // Rollback guidance state
  const [showRollbackGuidance, setShowRollbackGuidance] = useState(false);
  const [rollbackInfo, setRollbackInfo] = useState(null);

  // Amazon status
  const [amazonConnected, setAmazonConnected] = useState(false);

  // Load pools on mount
  const loadPools = useCallback(async () => {
    try {
      setPoolsLoading(true);
      const [poolsResult, statusResult] = await Promise.all([
        api.getAllocationPools({ location: 'Warehouse', min_boms: 2 }),
        api.getAmazonStatus().catch(() => ({ connected: false })),
      ]);
      setPools(poolsResult.pools || []);
      setAmazonConnected(statusResult.connected || false);
    } catch (err) {
      console.error('Failed to load allocation pools:', err);
      setError(err.message || 'Failed to load allocation pools');
    } finally {
      setPoolsLoading(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  // Filter pools by search
  const filteredPools = useMemo(() => {
    if (!poolSearch) return pools;
    const search = poolSearch.toLowerCase();
    return pools.filter(p =>
      p.internal_sku?.toLowerCase().includes(search) ||
      p.description?.toLowerCase().includes(search) ||
      p.boms?.some(b => b.bundle_sku?.toLowerCase().includes(search))
    );
  }, [pools, poolSearch]);

  // Handle pool selection
  const handlePoolSelect = (pool) => {
    setSelectedPool(pool);
    setPreview(null);
    setApplyResult(null);
  };

  // Handle preview generation
  const handlePreview = async () => {
    if (!selectedPool) return;

    try {
      setPreviewLoading(true);
      setPreview(null);
      setApplyResult(null);

      const result = await api.getAllocationPreview({
        pool_component_id: selectedPool.component_id,
        location: 'Warehouse',
        min_margin: minMargin,
        target_margin: targetMargin,
        buffer_units: bufferUnits,
      });

      setPreview(result);
    } catch (err) {
      console.error('Allocation preview error:', err);
      setError(err.message || 'Failed to generate allocation preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Handle apply allocation
  const handleApply = async () => {
    if (!selectedPool || !preview) return;

    try {
      setApplying(true);
      setApplyResult(null);

      const idempotencyKey = dryRun ? undefined : api.generateIdempotencyKey();
      const result = await api.applyAllocation({
        pool_component_id: selectedPool.component_id,
        location: 'Warehouse',
        min_margin: parseFloat(minMargin),
        target_margin: parseFloat(targetMargin),
        buffer_units: parseInt(bufferUnits, 10),
        dry_run: dryRun,
        preview_generated_at: preview.generated_at,
        force_apply: forceApply,
      }, idempotencyKey);

      // Check if we got a staleness warning instead of results
      if (result.warning === 'STALE_PREVIEW') {
        setError(`Preview is stale: ${result.message}. Please refresh the preview before applying.`);
        setApplyModalOpen(false);
        return;
      }

      setApplyResult(result);

      if (!dryRun && result.summary?.success_count > 0) {
        setSuccessMessage(`Successfully updated ${result.summary.success_count} Amazon listings`);

        // Show rollback guidance
        if (result.rollback_guidance) {
          setRollbackInfo(result.rollback_guidance);
          setShowRollbackGuidance(true);
        }

        // Refresh preview after successful apply
        await handlePreview();
      }

      setApplyModalOpen(false);
      setTypedConfirmation('');
      setForceApply(false);
    } catch (err) {
      console.error('Allocation apply error:', err);
      setError(err.message || 'Failed to apply allocation');
    } finally {
      setApplying(false);
    }
  };

  // Compute summary stats
  const summaryStats = useMemo(() => {
    if (!preview) return null;

    const candidates = preview.candidates || [];
    const allocated = candidates.filter(c => c.recommended_qty > 0);
    const totalUnits = candidates.reduce((sum, c) => sum + c.recommended_qty, 0);
    const expectedRevenue = candidates.reduce((sum, c) => {
      if (c.price_pence && c.recommended_qty > 0) {
        return sum + (c.price_pence * c.recommended_qty);
      }
      return sum;
    }, 0);
    const expectedProfit = candidates.reduce((sum, c) => {
      if (c.profit_pence && c.recommended_qty > 0) {
        return sum + (c.profit_pence * c.recommended_qty);
      }
      return sum;
    }, 0);

    return {
      candidateCount: candidates.length,
      allocatedCount: allocated.length,
      totalUnits,
      expectedRevenue,
      expectedProfit,
      avgMargin: allocated.length > 0
        ? allocated.reduce((sum, c) => sum + (c.margin_percent || 0), 0) / allocated.length
        : 0,
    };
  }, [preview]);

  // Check preview staleness
  const previewStaleness = useMemo(() => {
    if (!preview?.generated_at) {
      return { isStale: false, ageMinutes: 0 };
    }
    return api.checkPreviewStaleness(preview.generated_at, STALENESS_THRESHOLD_MINUTES);
  }, [preview?.generated_at]);

  // Determine if typed confirmation is required
  const requiresTypedConfirmation = useMemo(() => {
    return !dryRun && (summaryStats?.totalUnits || 0) > TYPED_CONFIRMATION_THRESHOLD;
  }, [dryRun, summaryStats?.totalUnits]);

  // Check if apply should be enabled
  const canApply = useMemo(() => {
    if (requiresTypedConfirmation && typedConfirmation !== 'APPLY') {
      return false;
    }
    return true;
  }, [requiresTypedConfirmation, typedConfirmation]);

  if (loading) {
    return (
      <Page title="Allocation Engine">
        <InvictaLoading message="Loading allocation pools..." />
      </Page>
    );
  }

  return (
    <Page
      title="Allocation Engine"
      subtitle="Optimize inventory distribution across Amazon listings"
      secondaryActions={[
        { content: 'Refresh Pools', onAction: loadPools, disabled: poolsLoading },
      ]}
    >
      <BlockStack gap="400">
        {/* Error/Success Banners */}
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

        {/* Info Banner */}
        <Banner tone="info">
          <p>
            <strong>How it works:</strong> Select a shared component (pool) that appears in multiple BOMs.
            The allocation engine calculates the optimal distribution across all listings that use this component,
            prioritizing high-demand, high-margin products.
          </p>
        </Banner>

        {/* Amazon Status */}
        {!amazonConnected && (
          <Banner tone="warning">
            <p>
              Amazon SP-API is not connected. You can preview allocations, but cannot push changes to Amazon.
              Configure your API credentials in Settings.
            </p>
          </Banner>
        )}

        <Layout>
          {/* Left Column: Pool Selection */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm">Pool Components</Text>
                <Text variant="bodySm" tone="subdued">
                  Components that appear in multiple BOMs ({pools.length} found)
                </Text>

                <TextField
                  label="Search pools"
                  labelHidden
                  placeholder="Search by SKU or description..."
                  value={poolSearch}
                  onChange={setPoolSearch}
                  clearButton
                  onClearButtonClick={() => setPoolSearch('')}
                  autoComplete="off"
                />

                {poolsLoading ? (
                  <InvictaLoading message="Loading pools..." />
                ) : filteredPools.length === 0 ? (
                  <EmptyState
                    heading="No pool components found"
                    image=""
                  >
                    <p>
                      {poolSearch
                        ? 'No pools match your search.'
                        : 'Create BOMs that share components to enable allocation.'}
                    </p>
                  </EmptyState>
                ) : (
                  <BlockStack gap="200">
                    {filteredPools.map(pool => (
                      <PoolCard
                        key={pool.component_id}
                        pool={pool}
                        selected={selectedPool?.component_id === pool.component_id}
                        onSelect={handlePoolSelect}
                      />
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Right Column: Allocation Preview */}
          <Layout.Section>
            {!selectedPool ? (
              <Card>
                <EmptyState
                  heading="Select a pool component"
                  image=""
                >
                  <p>Choose a shared component from the list to see allocation recommendations.</p>
                </EmptyState>
              </Card>
            ) : (
              <BlockStack gap="400">
                {/* Selected Pool Info */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text variant="headingMd">{selectedPool.internal_sku}</Text>
                        {selectedPool.description && (
                          <Text variant="bodySm" tone="subdued">{selectedPool.description}</Text>
                        )}
                      </BlockStack>
                      <InlineStack gap="200">
                        <Badge tone="success">{selectedPool.available} available</Badge>
                        <Badge tone="info">{selectedPool.bom_count} BOMs</Badge>
                      </InlineStack>
                    </InlineStack>

                    <Divider />

                    {/* Allocation Parameters */}
                    <BlockStack gap="300">
                      <Text variant="headingSm">Allocation Parameters</Text>
                      <InlineStack gap="400" wrap>
                        <div style={{ width: '150px' }}>
                          <TextField
                            label="Min Margin %"
                            type="number"
                            value={minMargin}
                            onChange={setMinMargin}
                            min={0}
                            max={100}
                            helpText="Listings below this won't receive stock"
                            autoComplete="off"
                          />
                        </div>
                        <div style={{ width: '150px' }}>
                          <TextField
                            label="Target Margin %"
                            type="number"
                            value={targetMargin}
                            onChange={setTargetMargin}
                            min={0}
                            max={100}
                            helpText="Bonus score for higher margins"
                            autoComplete="off"
                          />
                        </div>
                        <div style={{ width: '150px' }}>
                          <TextField
                            label="Buffer Units"
                            type="number"
                            value={bufferUnits}
                            onChange={setBufferUnits}
                            min={0}
                            helpText="Units held back from allocation"
                            autoComplete="off"
                          />
                        </div>
                      </InlineStack>
                    </BlockStack>

                    <InlineStack gap="200">
                      <InvictaButton
                        variant="primary"
                        onClick={handlePreview}
                        loading={previewLoading}
                        disabled={!selectedPool}
                      >
                        Calculate Allocation
                      </InvictaButton>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Preview Results */}
                {previewLoading && (
                  <InvictaLoading message="Calculating optimal allocation..." />
                )}

                {preview && !previewLoading && (
                  <>
                    {/* Staleness Warning */}
                    {previewStaleness.isStale && (
                      <Banner
                        tone="warning"
                        title="Preview may be stale"
                        action={{
                          content: 'Refresh Preview',
                          onAction: handlePreview,
                          loading: previewLoading,
                        }}
                      >
                        <p>
                          This preview was generated {previewStaleness.ageMinutes} minutes ago.
                          Stock levels or prices may have changed. Refresh before applying to ensure accuracy.
                        </p>
                      </Banner>
                    )}

                    {/* Rollback Guidance Banner */}
                    {showRollbackGuidance && rollbackInfo && (
                      <Banner
                        tone="success"
                        title="Allocation applied successfully"
                        onDismiss={() => setShowRollbackGuidance(false)}
                      >
                        <BlockStack gap="200">
                          <Text variant="bodySm">
                            {rollbackInfo.affected_skus?.length || 0} SKUs were updated on Amazon.
                          </Text>
                          <Text variant="bodySm" fontWeight="semibold">To undo this allocation:</Text>
                          <List type="bullet">
                            <List.Item>Re-run allocation with different parameters</List.Item>
                            <List.Item>Manually adjust quantities in Amazon Seller Central</List.Item>
                            <List.Item>Use the listing inventory page to set individual quantities</List.Item>
                          </List>
                          <Text variant="bodySm" tone="subdued">
                            Audit reference: {rollbackInfo.audit_reference}
                          </Text>
                        </BlockStack>
                      </Banner>
                    )}

                    {/* Summary KPIs */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                      <KPICard
                        title="Allocatable Units"
                        value={preview.pool?.allocatable_units || 0}
                        subtitle={`of ${preview.pool?.available || 0} available`}
                        icon={PackageIcon}
                      />
                      <KPICard
                        title="Listings Allocated"
                        value={summaryStats?.allocatedCount || 0}
                        subtitle={`of ${summaryStats?.candidateCount || 0} candidates`}
                        tone={summaryStats?.allocatedCount > 0 ? 'success' : undefined}
                        icon={ChartVerticalFilledIcon}
                      />
                      <KPICard
                        title="Expected Revenue"
                        value={formatPrice(summaryStats?.expectedRevenue || 0)}
                        subtitle={`${summaryStats?.totalUnits || 0} units`}
                      />
                      <KPICard
                        title="Expected Profit"
                        value={formatPrice(summaryStats?.expectedProfit || 0)}
                        subtitle={`${formatPercent(summaryStats?.avgMargin)} avg margin`}
                        tone={summaryStats?.expectedProfit > 0 ? 'success' : undefined}
                      />
                    </div>

                    {/* Explain Panel - Constraints Applied */}
                    {preview.constraints_applied && (
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingSm">Allocation Constraints & Reasoning</Text>
                            <Button
                              plain
                              onClick={() => setExplainPanelOpen(!explainPanelOpen)}
                              ariaExpanded={explainPanelOpen}
                              ariaControls="explain-panel"
                            >
                              {explainPanelOpen ? 'Hide Details' : 'Show Details'}
                            </Button>
                          </InlineStack>

                          <InlineStack gap="400" wrap>
                            <Badge tone="info">Min Margin: {preview.constraints_applied.min_margin_percent}%</Badge>
                            <Badge tone="info">Target Margin: {preview.constraints_applied.target_margin_percent}%</Badge>
                            <Badge tone="info">Buffer: {preview.constraints_applied.buffer_units} units</Badge>
                            <Badge>Priority: Sales velocity + Margin</Badge>
                          </InlineStack>

                          <Collapsible
                            open={explainPanelOpen}
                            id="explain-panel"
                            transition={{ duration: '200ms', timingFunction: 'ease-in-out' }}
                          >
                            <BlockStack gap="300">
                              <Divider />
                              <Text variant="bodyMd" fontWeight="semibold">How allocations are determined:</Text>
                              <List type="number">
                                <List.Item>
                                  <strong>Eligibility:</strong> Only listings with margin above {preview.constraints_applied.min_margin_percent}% receive stock
                                </List.Item>
                                <List.Item>
                                  <strong>Scoring:</strong> Each listing gets a score based on demand (30-day sales + Keepa rank) multiplied by a margin bonus
                                </List.Item>
                                <List.Item>
                                  <strong>Priority:</strong> Listings exceeding {preview.constraints_applied.target_margin_percent}% target margin get up to 20% score bonus
                                </List.Item>
                                <List.Item>
                                  <strong>Allocation:</strong> Units are allocated one-by-one to the highest-scoring feasible listing, with diminishing returns per listing
                                </List.Item>
                                <List.Item>
                                  <strong>Constraints:</strong> Allocation respects all BOM component availability, not just the pool component
                                </List.Item>
                              </List>

                              <Divider />
                              <Text variant="bodyMd" fontWeight="semibold">Why some listings don't receive stock:</Text>
                              <List type="bullet">
                                <List.Item>
                                  <Badge tone="critical" size="small">{preview.summary?.blocked_by_margin_count || 0}</Badge> blocked by margin (below {preview.constraints_applied.min_margin_percent}% minimum)
                                </List.Item>
                                <List.Item>
                                  <Badge tone="warning" size="small">{preview.summary?.blocked_by_stock_count || 0}</Badge> blocked by stock (other BOM components unavailable)
                                </List.Item>
                                <List.Item>
                                  <Badge size="small">{preview.summary?.missing_keepa_count || 0}</Badge> missing Keepa data (demand score may be lower)
                                </List.Item>
                              </List>

                              {preview.generated_at && (
                                <>
                                  <Divider />
                                  <Text variant="bodySm" tone="subdued">
                                    Preview generated: {new Date(preview.generated_at).toLocaleString()}
                                    {previewStaleness.ageMinutes > 0 && ` (${previewStaleness.ageMinutes} minutes ago)`}
                                  </Text>
                                </>
                              )}
                            </BlockStack>
                          </Collapsible>
                        </BlockStack>
                      </Card>
                    )}

                    {/* Demand Model Info */}
                    {preview.demand_model && (
                      <Banner tone="info">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={InfoIcon} />
                          <Text variant="bodySm">
                            Using demand model: <strong>{preview.demand_model.model_name}</strong>
                            {preview.demand_model.trained_at && (
                              <> (trained {new Date(preview.demand_model.trained_at).toLocaleDateString()})</>
                            )}
                          </Text>
                        </InlineStack>
                      </Banner>
                    )}

                    {/* Allocation Progress */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <Text variant="headingSm">Allocation Progress</Text>
                          <Text variant="bodySm" tone="subdued">
                            {preview.summary?.allocated_total || 0} of {preview.pool?.allocatable_units || 0} units allocated
                          </Text>
                        </InlineStack>
                        <ProgressBar
                          progress={preview.pool?.allocatable_units > 0
                            ? Math.min(100, ((preview.summary?.allocated_total || 0) / preview.pool.allocatable_units) * 100)
                            : 0}
                          size="small"
                          tone="highlight"
                        />
                        <InlineStack gap="400">
                          <InlineStack gap="100">
                            <Badge tone="critical">{preview.summary?.blocked_by_margin_count || 0}</Badge>
                            <Text variant="bodySm" tone="subdued">blocked by margin</Text>
                          </InlineStack>
                          <InlineStack gap="100">
                            <Badge tone="warning">{preview.summary?.blocked_by_stock_count || 0}</Badge>
                            <Text variant="bodySm" tone="subdued">blocked by stock</Text>
                          </InlineStack>
                          <InlineStack gap="100">
                            <Badge>{preview.summary?.missing_keepa_count || 0}</Badge>
                            <Text variant="bodySm" tone="subdued">missing Keepa data</Text>
                          </InlineStack>
                        </InlineStack>
                      </BlockStack>
                    </Card>

                    {/* Demand Source Distribution */}
                    {preview.summary?.demand_source_counts && (
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="headingSm">Demand Forecasting Sources</Text>
                          <InlineStack gap="400" wrap>
                            {Object.entries(preview.summary.demand_source_counts).map(([source, count]) => (
                              count > 0 && (
                                <InlineStack key={source} gap="100">
                                  <DemandSourceBadge source={source} />
                                  <Text variant="bodySm">{count} listings</Text>
                                </InlineStack>
                              )
                            ))}
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    )}

                    {/* Candidates Table */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text variant="headingSm">
                            Allocation Preview ({preview.candidates?.length || 0} listings)
                          </Text>
                          <InlineStack gap="200">
                            <Checkbox
                              label="Dry run"
                              checked={dryRun}
                              onChange={setDryRun}
                            />
                            <InvictaButton
                              variant={dryRun ? 'secondary' : 'primary'}
                              onClick={() => {
                                setTypedConfirmation('');
                                setForceApply(false);
                                setApplyModalOpen(true);
                              }}
                              disabled={!amazonConnected || !preview || preview.summary?.allocated_total === 0}
                            >
                              {dryRun ? 'Preview Apply' : 'Apply to Amazon'}
                            </InvictaButton>
                          </InlineStack>
                        </InlineStack>

                        {/* Apply Result */}
                        {applyResult && (
                          <Banner
                            tone={applyResult.results?.failed?.length > 0 ? 'warning' : 'success'}
                            title={applyResult.dry_run
                              ? `Dry run: ${applyResult.summary?.success_count || 0} listings would be updated`
                              : `Applied: ${applyResult.summary?.success_count || 0} listings updated`}
                            onDismiss={() => setApplyResult(null)}
                          >
                            <p>
                              {applyResult.summary?.total_units_allocated || 0} total units allocated
                              {applyResult.summary?.failed_count > 0 && ` (${applyResult.summary.failed_count} failed)`}
                              {applyResult.summary?.skipped_count > 0 && ` (${applyResult.summary.skipped_count} skipped - missing SKU)`}
                            </p>
                          </Banner>
                        )}

                        {preview.candidates && preview.candidates.length > 0 ? (
                          <DataTable
                            columnContentTypes={['text', 'numeric', 'text', 'numeric', 'numeric', 'numeric', 'text']}
                            headings={['Listing', 'Units 30d', 'Demand', 'Score', 'Margin', 'Allocated', 'Price Source']}
                            rows={preview.candidates.map(c => [
                              <BlockStack key={c.listing_memory_id} gap="100">
                                <button
                                  onClick={() => openProductModal({ asin: c.asin })}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                  }}
                                >
                                  <Text variant="bodyMd" fontWeight="semibold">
                                    <span style={{ textDecoration: 'underline', color: 'var(--p-color-text-emphasis)' }}>
                                      {c.bundle_sku || c.sku || c.asin}
                                    </span>
                                  </Text>
                                </button>
                                {c.asin && <Text variant="bodySm" tone="subdued">ASIN: {c.asin}</Text>}
                              </BlockStack>,
                              c.units_30d || 0,
                              <BlockStack key={`demand-${c.listing_memory_id}`} gap="100">
                                <Text variant="bodySm">
                                  {(c.demand_forecast?.units_per_day || 0).toFixed(2)}/day
                                </Text>
                                <DemandSourceBadge source={c.demand_forecast?.source} />
                              </BlockStack>,
                              c.score?.toFixed(2) || '-',
                              <Badge
                                key={`margin-${c.listing_memory_id}`}
                                tone={c.margin_percent < parseFloat(minMargin) ? 'critical' :
                                  c.margin_percent >= parseFloat(targetMargin) ? 'success' : 'warning'}
                              >
                                {formatPercent(c.margin_percent)}
                              </Badge>,
                              <Text
                                key={`qty-${c.listing_memory_id}`}
                                fontWeight="bold"
                                tone={c.recommended_qty > 0 ? 'success' : 'subdued'}
                              >
                                {c.recommended_qty || 0}
                              </Text>,
                              <BlockStack key={`price-${c.listing_memory_id}`} gap="100">
                                <Text variant="bodySm">{formatPrice(c.price_pence)}</Text>
                                <Badge tone="info">{c.price_source || '-'}</Badge>
                              </BlockStack>,
                            ])}
                            footerContent={`${preview.candidates.filter(c => c.recommended_qty > 0).length} listings receiving stock`}
                          />
                        ) : (
                          <EmptyState heading="No candidates found" image="">
                            <p>No active listings found that use this component.</p>
                          </EmptyState>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                )}
              </BlockStack>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Apply Confirmation Modal - Enhanced with typed confirmation */}
      <Modal
        open={applyModalOpen}
        onClose={() => {
          setApplyModalOpen(false);
          setTypedConfirmation('');
          setForceApply(false);
        }}
        title={dryRun ? 'Preview Allocation Apply' : 'Confirm Allocation to Amazon'}
        primaryAction={{
          content: dryRun ? 'Run Dry Preview' : 'Apply to Amazon',
          onAction: handleApply,
          loading: applying,
          destructive: !dryRun,
          disabled: !canApply,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => {
            setApplyModalOpen(false);
            setTypedConfirmation('');
            setForceApply(false);
          }},
        ]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Mode Banner */}
            {dryRun ? (
              <Banner tone="info">
                <p>This is a dry run. No changes will be made to Amazon. You'll see what would happen.</p>
              </Banner>
            ) : (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="bold">This will update Amazon listing quantities.</Text>
                  <Text variant="bodySm">
                    This action will push the allocated quantities to Amazon via SP-API.
                    Changes will be reflected on your Amazon listings within minutes.
                  </Text>
                </BlockStack>
              </Banner>
            )}

            {/* Staleness Warning in Modal */}
            {previewStaleness.isStale && !dryRun && (
              <Banner tone="warning" title="Preview may be stale">
                <BlockStack gap="200">
                  <Text variant="bodySm">
                    This preview was generated {previewStaleness.ageMinutes} minutes ago.
                    Stock levels or prices may have changed.
                  </Text>
                  <Checkbox
                    label="I understand the preview may be stale and want to proceed anyway"
                    checked={forceApply}
                    onChange={setForceApply}
                  />
                </BlockStack>
              </Banner>
            )}

            {/* Scope Summary */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm">Scope Summary</Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Pool Component</Text>
                    <Text variant="bodyMd" fontWeight="semibold">{selectedPool?.internal_sku}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Total Units</Text>
                    <Text variant="bodyMd" fontWeight="semibold">{preview?.summary?.allocated_total || 0}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Listings Affected</Text>
                    <Text variant="bodyMd" fontWeight="semibold">{preview?.candidates?.filter(c => c.recommended_qty > 0).length || 0}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Expected Profit</Text>
                    <Text variant="bodyMd" fontWeight="semibold" tone="success">{formatPrice(summaryStats?.expectedProfit || 0)}</Text>
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>

            {/* Preview of Changes - Top 10 allocations */}
            {preview?.candidates && (
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingSm">Preview of Changes (Top 10)</Text>
                  <DataTable
                    columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                    headings={['Listing', 'SKU', 'Current Qty', 'Proposed Qty']}
                    rows={preview.candidates
                      .filter(c => c.recommended_qty > 0)
                      .slice(0, 10)
                      .map(c => [
                        c.bundle_sku || c.asin || '-',
                        c.sku || '-',
                        <Text key={`current-${c.listing_memory_id}`} tone="subdued">-</Text>,
                        <Text key={`proposed-${c.listing_memory_id}`} fontWeight="bold" tone="success">
                          {c.recommended_qty}
                        </Text>,
                      ])}
                  />
                  {preview.candidates.filter(c => c.recommended_qty > 0).length > 10 && (
                    <Text variant="bodySm" tone="subdued">
                      ... and {preview.candidates.filter(c => c.recommended_qty > 0).length - 10} more listings
                    </Text>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* Constraints Applied */}
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm">Constraints Applied</Text>
                <InlineStack gap="300" wrap>
                  <Badge>Min Margin: {minMargin}%</Badge>
                  <Badge>Target Margin: {targetMargin}%</Badge>
                  <Badge>Buffer: {bufferUnits} units</Badge>
                  <Badge>Location: Warehouse</Badge>
                </InlineStack>
              </BlockStack>
            </Card>

            <Divider />

            {/* Dry Run Toggle */}
            <Checkbox
              label="Dry run mode (preview only, no changes to Amazon)"
              checked={dryRun}
              onChange={(checked) => {
                setDryRun(checked);
                if (checked) {
                  setTypedConfirmation('');
                }
              }}
            />

            {/* Typed Confirmation for Large Allocations */}
            {requiresTypedConfirmation && (
              <Card>
                <BlockStack gap="300">
                  <Banner tone="critical" title="Large Allocation Warning">
                    <Text variant="bodySm">
                      You are about to allocate {summaryStats?.totalUnits || 0} units across {preview?.candidates?.filter(c => c.recommended_qty > 0).length || 0} listings.
                      This exceeds the {TYPED_CONFIRMATION_THRESHOLD} unit threshold for automatic confirmation.
                    </Text>
                  </Banner>
                  <TextField
                    label={`Type "APPLY" to confirm this allocation`}
                    value={typedConfirmation}
                    onChange={setTypedConfirmation}
                    placeholder="Type APPLY to confirm"
                    autoComplete="off"
                    error={typedConfirmation && typedConfirmation !== 'APPLY' ? 'Please type exactly "APPLY" to confirm' : undefined}
                  />
                  {typedConfirmation === 'APPLY' && (
                    <Badge tone="success">Confirmation accepted</Badge>
                  )}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
