import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  Select,
  TextField,
  Button,
  Modal,
  BlockStack,
  InlineStack,
  Banner,
  Text,
  Badge,
  Checkbox,
  Tabs,
  Divider,
  KeyboardKey,
  Tooltip,
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
  const [successMessage, setSuccessMessage] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);

  // Selection and navigation
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [bomSearch, setBomSearch] = useState('');
  const searchInputRef = useRef(null);

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

  // Filter queue
  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      // Reason filter
      if (reasonFilter !== 'all' && item.reason !== reasonFilter) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesAsin = (item.asin || '').toLowerCase().includes(query);
        const matchesSku = (item.sku || '').toLowerCase().includes(query);
        const matchesTitle = (item.title || '').toLowerCase().includes(query);
        if (!matchesAsin && !matchesSku && !matchesTitle) return false;
      }

      return true;
    });
  }, [queue, reasonFilter, searchQuery]);

  // Filter BOMs for selection
  const filteredBoms = useMemo(() => {
    if (!bomSearch) return boms;
    const query = bomSearch.toLowerCase();
    return boms.filter(
      (b) =>
        b.bundle_sku?.toLowerCase().includes(query) ||
        b.description?.toLowerCase().includes(query)
    );
  }, [boms, bomSearch]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setReasonFilter('all');
  };

  const hasFilters = searchQuery || reasonFilter !== 'all';

  // Calculate stats
  const stats = useMemo(() => {
    const byReason = {};
    queue.forEach((item) => {
      const reason = item.reason || 'UNKNOWN';
      byReason[reason] = (byReason[reason] || 0) + 1;
    });
    return { total: queue.length, byReason };
  }, [queue]);

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
    setBomSearch('');
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
    setBomSearch('');
  }

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
      setSuccessMessage(`Resolved ${resolveState.item.asin || resolveState.item.sku || 'item'}`);
      closeResolve();
      await load();
      // Reset selection if needed
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, filteredQueue.length - 2)));
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Failed to resolve');
      setResolveState((prev) => ({ ...prev, resolving: false, error: errorMsg }));
    }
  }

  async function handleSkip(item) {
    try {
      await skipReview(item.id, 'Skipped by user');
      setSuccessMessage(`Skipped ${item.asin || item.sku || 'item'}`);
      await load();
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, filteredQueue.length - 2)));
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || 'Unknown error');
      setError(`Failed to skip: ${errorMsg}`);
    }
  }

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    // Don't handle if we're in a text input (except for Escape)
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

    if (e.key === 'Escape') {
      if (resolveState.open) {
        closeResolve();
        e.preventDefault();
        return;
      }
      if (isInput) {
        e.target.blur();
        e.preventDefault();
        return;
      }
    }

    if (isInput) return;

    // Navigation
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredQueue.length - 1));
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'r') {
      e.preventDefault();
      if (filteredQueue[selectedIndex]) {
        openResolve(filteredQueue[selectedIndex]);
      }
    } else if (e.key === 's') {
      e.preventDefault();
      if (filteredQueue[selectedIndex]) {
        handleSkip(filteredQueue[selectedIndex]);
      }
    } else if (e.key === '/') {
      e.preventDefault();
      searchInputRef.current?.focus();
    } else if (e.key === 'g') {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === 'G') {
      e.preventDefault();
      setSelectedIndex(filteredQueue.length - 1);
    } else if (e.key === '?') {
      e.preventDefault();
      setSelectedTab(1);
    }
  }, [filteredQueue, selectedIndex, resolveState.open]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, reasonFilter]);

  function getReasonBadge(reason) {
    const reasonMap = {
      UNKNOWN_LISTING: { tone: 'warning', label: 'Unknown Listing' },
      BOM_NOT_SET: { tone: 'attention', label: 'BOM Not Set' },
      AMBIGUOUS: { tone: 'info', label: 'Ambiguous' },
    };
    const config = reasonMap[reason] || { tone: 'default', label: reason || 'Unknown' };
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  const tabs = [
    { id: 'queue', content: `Queue (${filteredQueue.length})`, accessibilityLabel: 'Review Queue' },
    { id: 'shortcuts', content: 'Keyboard Shortcuts', accessibilityLabel: 'Keyboard Shortcuts' },
  ];

  const rows = filteredQueue.map((item, index) => {
    const isSelected = index === selectedIndex;
    const rowStyle = isSelected ? { backgroundColor: 'var(--p-color-bg-surface-selected)' } : {};

    return [
      <div style={rowStyle} key={`asin-${item.id}`}>
        <Text variant="bodyMd" fontWeight={isSelected ? 'bold' : 'semibold'}>
          {item.asin || '-'}
        </Text>
      </div>,
      <div style={rowStyle} key={`sku-${item.id}`}>{item.sku || '-'}</div>,
      <div style={rowStyle} key={`title-${item.id}`}>
        <Text variant="bodySm">
          {item.title ? (item.title.length > 50 ? item.title.substring(0, 50) + '...' : item.title) : '-'}
        </Text>
      </div>,
      <div style={rowStyle} key={`reason-${item.id}`}>{getReasonBadge(item.reason)}</div>,
      <div style={rowStyle} key={`actions-${item.id}`}>
        <InlineStack gap="200">
          <Button size="slim" variant="primary" onClick={() => openResolve(item)}>
            Resolve
          </Button>
          <Button size="slim" variant="tertiary" onClick={() => handleSkip(item)}>
            Skip
          </Button>
        </InlineStack>
      </div>,
    ];
  });

  const shortcutsContent = (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd">Keyboard Shortcuts</Text>
        <Text tone="subdued">Use these shortcuts to quickly work through the review queue.</Text>
        <Divider />

        <BlockStack gap="300">
          <Text variant="headingSm">Navigation</Text>
          <InlineStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>j</KeyboardKey> / <KeyboardKey>↓</KeyboardKey>
              <Text>Next item</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>k</KeyboardKey> / <KeyboardKey>↑</KeyboardKey>
              <Text>Previous item</Text>
            </InlineStack>
          </InlineStack>
          <InlineStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>g</KeyboardKey>
              <Text>Go to first</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>G</KeyboardKey>
              <Text>Go to last</Text>
            </InlineStack>
          </InlineStack>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <Text variant="headingSm">Actions</Text>
          <InlineStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>Enter</KeyboardKey> / <KeyboardKey>r</KeyboardKey>
              <Text>Resolve selected</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>s</KeyboardKey>
              <Text>Skip selected</Text>
            </InlineStack>
          </InlineStack>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <Text variant="headingSm">Other</Text>
          <InlineStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>/</KeyboardKey>
              <Text>Focus search</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>Esc</KeyboardKey>
              <Text>Close modal / blur input</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <KeyboardKey>?</KeyboardKey>
              <Text>Show shortcuts</Text>
            </InlineStack>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );

  return (
    <Page
      title="Review Queue"
      subtitle={queue.length > 0 ? `${queue.length} item(s) need review · Press ? for shortcuts` : 'All caught up!'}
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <BlockStack gap="400">
        {/* Success message */}
        {successMessage && (
          <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
            <p>{successMessage}</p>
          </Banner>
        )}

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Stats Cards */}
        {queue.length > 0 && (
          <Layout>
            <Layout.Section variant="oneQuarter">
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodySm" tone="subdued">Total Pending</Text>
                  <Text variant="headingLg" fontWeight="bold" tone="warning">
                    {queue.length}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneQuarter">
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodySm" tone="subdued">Unknown Listing</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {stats.byReason.UNKNOWN_LISTING || 0}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneQuarter">
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodySm" tone="subdued">BOM Not Set</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {stats.byReason.BOM_NOT_SET || 0}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneQuarter">
              <Card>
                <BlockStack gap="200">
                  <Text variant="bodySm" tone="subdued">Ambiguous</Text>
                  <Text variant="headingLg" fontWeight="bold">
                    {stats.byReason.AMBIGUOUS || 0}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 ? (
            <BlockStack gap="400">
              {/* Search and Filter */}
              <Card>
                <InlineStack gap="400" wrap={false}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Search"
                      labelHidden
                      placeholder="Search by ASIN, SKU, title... (press /)"
                      value={searchQuery}
                      onChange={setSearchQuery}
                      clearButton
                      onClearButtonClick={() => setSearchQuery('')}
                      autoComplete="off"
                      ref={searchInputRef}
                    />
                  </div>
                  <Select
                    label="Reason"
                    labelHidden
                    options={[
                      { label: 'All reasons', value: 'all' },
                      { label: 'Unknown Listing', value: 'UNKNOWN_LISTING' },
                      { label: 'BOM Not Set', value: 'BOM_NOT_SET' },
                      { label: 'Ambiguous', value: 'AMBIGUOUS' },
                    ]}
                    value={reasonFilter}
                    onChange={setReasonFilter}
                  />
                  {hasFilters && (
                    <Button onClick={handleClearFilters}>Clear</Button>
                  )}
                </InlineStack>
              </Card>

              <Card>
                {loading ? (
                  <div style={{ padding: '40px', textAlign: 'center' }}>
                    <Spinner accessibilityLabel="Loading review queue" size="large" />
                  </div>
                ) : queue.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center' }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <Text variant="headingLg">All caught up!</Text>
                      <Text tone="subdued">No items in review queue. Orders with unknown listings will appear here.</Text>
                    </BlockStack>
                  </div>
                ) : filteredQueue.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center' }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <Text variant="headingMd">No matching items</Text>
                      <Text tone="subdued">Try adjusting your search or filter.</Text>
                      <Button onClick={handleClearFilters}>Clear filters</Button>
                    </BlockStack>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: '8px' }}>
                      <Text variant="bodySm" tone="subdued">
                        Viewing {filteredQueue.length} items · Selected: {selectedIndex + 1} of {filteredQueue.length}
                      </Text>
                    </div>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                      headings={['ASIN', 'SKU', 'Title', 'Reason', 'Actions']}
                      rows={rows}
                    />
                  </>
                )}
              </Card>
            </BlockStack>
          ) : (
            shortcutsContent
          )}
        </Tabs>
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
        large
      >
        {resolveState.item && (
          <Modal.Section>
            <BlockStack gap="400">
              {resolveState.error && (
                <Banner tone="critical">
                  <p>{resolveState.error}</p>
                </Banner>
              )}

              {/* Item Details Card */}
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingSm">Item to Resolve</Text>
                  <InlineStack gap="800">
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">ASIN</Text>
                      <Text variant="bodyMd" fontWeight="semibold">{resolveState.item.asin || '-'}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">SKU</Text>
                      <Text variant="bodyMd" fontWeight="semibold">{resolveState.item.sku || '-'}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Reason</Text>
                      {getReasonBadge(resolveState.item.reason)}
                    </BlockStack>
                  </InlineStack>
                  {resolveState.item.title && (
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Title</Text>
                      <Text variant="bodyMd">{resolveState.item.title}</Text>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <Divider />

              <Banner tone="info">
                <p>
                  Select a BOM to map this listing. The mapping will be saved and used automatically for future orders.
                </p>
              </Banner>

              {/* BOM Selection with search */}
              <BlockStack gap="200">
                <Text variant="headingSm">Select BOM ({boms.length} available)</Text>
                <TextField
                  label="Search BOMs"
                  labelHidden
                  placeholder="Search by SKU or description..."
                  value={bomSearch}
                  onChange={setBomSearch}
                  clearButton
                  onClearButtonClick={() => setBomSearch('')}
                  autoComplete="off"
                />
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--p-color-border)', borderRadius: '8px' }}>
                  {filteredBoms.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center' }}>
                      <Text tone="subdued">No BOMs match "{bomSearch}"</Text>
                    </div>
                  ) : (
                    filteredBoms.map((bom) => (
                      <div
                        key={bom.id}
                        onClick={() => setResolveState((prev) => ({ ...prev, bom_id: bom.id }))}
                        style={{
                          padding: '12px 16px',
                          cursor: 'pointer',
                          backgroundColor: resolveState.bom_id === bom.id ? 'var(--p-color-bg-surface-selected)' : 'transparent',
                          borderBottom: '1px solid var(--p-color-border-subdued)',
                        }}
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <div style={{ width: '20px' }}>
                            {resolveState.bom_id === bom.id && <Text fontWeight="bold">✓</Text>}
                          </div>
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="semibold">{bom.bundle_sku}</Text>
                            <Text variant="bodySm" tone="subdued">
                              {bom.description || 'No description'}
                              {bom.bom_components?.length > 0 && ` · ${bom.bom_components.length} component(s)`}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      </div>
                    ))
                  )}
                </div>
              </BlockStack>

              <Checkbox
                label="Save as rule for future orders"
                checked={resolveState.saveAsRule}
                onChange={(checked) => setResolveState((prev) => ({ ...prev, saveAsRule: checked }))}
                helpText="When enabled, similar listings will be automatically resolved"
              />

              <Divider />

              <Text variant="headingSm">Identity Overrides (optional)</Text>
              <Text variant="bodySm" tone="subdued">
                Override the ASIN, SKU, or title used for matching future orders.
              </Text>

              <InlineStack gap="400">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="ASIN"
                    value={resolveState.asin}
                    onChange={(value) => setResolveState((prev) => ({ ...prev, asin: value }))}
                    placeholder="e.g., B08N5WRWNW"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="SKU"
                    value={resolveState.sku}
                    onChange={(value) => setResolveState((prev) => ({ ...prev, sku: value }))}
                    placeholder="e.g., INV-TOOL-001"
                  />
                </div>
              </InlineStack>
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
