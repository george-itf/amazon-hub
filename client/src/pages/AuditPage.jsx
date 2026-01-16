import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Page,
  Layout,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Select,
  TextField,
  Card,
  Button,
  Badge,
  Modal,
  Divider,
  DataTable,
  Spinner,
  Icon,
  Tooltip,
  Box,
} from '@shopify/polaris';
import {
  RefreshIcon,
  ExportIcon,
  FilterIcon,
  ClipboardIcon,
  SearchIcon,
} from '@shopify/polaris-icons';
import * as api from '../utils/api.jsx';

// Entity types for filter dropdown
const ENTITY_TYPES = [
  { label: 'All Types', value: '' },
  { label: 'Components', value: 'COMPONENT' },
  { label: 'BOMs', value: 'BOM' },
  { label: 'Listings', value: 'LISTING_MEMORY' },
  { label: 'Orders', value: 'ORDER' },
  { label: 'Order Lines', value: 'ORDER_LINE' },
  { label: 'Pick Batches', value: 'PICK_BATCH' },
  { label: 'Returns', value: 'RETURN' },
  { label: 'Stock', value: 'STOCK' },
  { label: 'Allocation', value: 'ALLOCATION' },
  { label: 'Shipping', value: 'SHIPPING' },
  { label: 'System', value: 'SYSTEM' },
];

// Action types for filter dropdown
const ACTION_TYPES = [
  { label: 'All Actions', value: '' },
  { label: 'Create', value: 'CREATE' },
  { label: 'Update', value: 'UPDATE' },
  { label: 'Delete', value: 'DELETE' },
  { label: 'Supersede', value: 'SUPERSEDE' },
  { label: 'Receive', value: 'RECEIVE' },
  { label: 'Adjust', value: 'ADJUST' },
  { label: 'Reserve', value: 'RESERVE' },
  { label: 'Confirm', value: 'CONFIRM' },
  { label: 'Cancel', value: 'CANCEL' },
  { label: 'Import', value: 'IMPORT' },
  { label: 'Apply', value: 'APPLY' },
  { label: 'Ship', value: 'SHIP' },
];

// Date presets for quick selection
const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'month' },
  { label: 'All time', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

/**
 * Convert date preset to date range
 */
function getDateRange(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return { since: today.toISOString(), until: null };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const endOfYesterday = new Date(today);
      endOfYesterday.setMilliseconds(-1);
      return { since: yesterday.toISOString(), until: endOfYesterday.toISOString() };
    }
    case '7d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { since: start.toISOString(), until: null };
    }
    case '30d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { since: start.toISOString(), until: null };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { since: start.toISOString(), until: null };
    }
    case 'all':
    default:
      return { since: null, until: null };
  }
}

/**
 * Format a value for display in diff viewer
 */
function formatValue(value) {
  if (value === null || value === undefined) return <Text tone="subdued">null</Text>;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Diff viewer component for before/after comparison
 */
function DiffViewer({ before, after }) {
  if (!before && !after) {
    return <Text tone="subdued">No data changes recorded.</Text>;
  }

  const beforeObj = before || {};
  const afterObj = after || {};
  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changes = [];

  for (const key of allKeys) {
    const oldVal = beforeObj[key];
    const newVal = afterObj[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ key, oldVal, newVal });
    }
  }

  if (changes.length === 0) {
    return <Text tone="subdued">No differences detected.</Text>;
  }

  return (
    <BlockStack gap="300">
      {changes.map(({ key, oldVal, newVal }) => (
        <Card key={key}>
          <BlockStack gap="200">
            <Text variant="headingSm">{key}</Text>
            <InlineStack gap="400" wrap>
              <BlockStack gap="100" inlineAlign="stretch">
                <Text variant="bodySm" tone="subdued">Before:</Text>
                <div style={{
                  backgroundColor: 'var(--p-color-bg-critical-subdued)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  maxWidth: '300px',
                  maxHeight: '150px',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {formatValue(oldVal)}
                </div>
              </BlockStack>
              <BlockStack gap="100" inlineAlign="stretch">
                <Text variant="bodySm" tone="subdued">After:</Text>
                <div style={{
                  backgroundColor: 'var(--p-color-bg-success-subdued)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  maxWidth: '300px',
                  maxHeight: '150px',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {formatValue(newVal)}
                </div>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>
      ))}
    </BlockStack>
  );
}

/**
 * Action badge with appropriate color
 */
function ActionBadge({ action }) {
  const toneMap = {
    CREATE: 'success',
    UPDATE: 'info',
    DELETE: 'critical',
    CANCEL: 'critical',
    RECEIVE: 'success',
    ADJUST: 'warning',
    RESERVE: 'attention',
    CONFIRM: 'success',
    SUPERSEDE: 'info',
    IMPORT: 'info',
    APPLY: 'success',
    SHIP: 'success',
  };
  return <Badge tone={toneMap[action] || 'default'}>{action}</Badge>;
}

/**
 * Entity type badge with color coding
 */
function EntityBadge({ type }) {
  const toneMap = {
    COMPONENT: 'info',
    BOM: 'success',
    ORDER: 'attention',
    ORDER_LINE: 'attention',
    PICK_BATCH: 'warning',
    RETURN: 'critical',
    STOCK: 'info',
    LISTING_MEMORY: 'success',
    ALLOCATION: 'warning',
    SHIPPING: 'info',
    SYSTEM: 'default',
  };
  return <Badge tone={toneMap[type] || 'default'}>{type}</Badge>;
}

/**
 * Copy to clipboard button
 */
function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Tooltip content={copied ? 'Copied!' : label}>
      <Button
        size="slim"
        icon={ClipboardIcon}
        onClick={handleCopy}
        accessibilityLabel={label}
      />
    </Tooltip>
  );
}

/**
 * AuditPage - Comprehensive audit trail viewer
 */
export default function AuditPage() {
  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Data states
  const [events, setEvents] = useState([]);
  const [actors, setActors] = useState([]);
  const [total, setTotal] = useState(0);

  // Filter states
  const [entityType, setEntityType] = useState('');
  const [actionType, setActionType] = useState('');
  const [actorId, setActorId] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState('7d');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Detail modal state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [entityHistory, setEntityHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [relatedEvents, setRelatedEvents] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    today: 0,
    byType: {},
    byAction: {},
  });

  // Calculate date range from preset or custom values
  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        since: customSince ? new Date(customSince).toISOString() : null,
        until: customUntil ? new Date(customUntil + 'T23:59:59').toISOString() : null,
      };
    }
    return getDateRange(datePreset);
  }, [datePreset, customSince, customUntil]);

  // Load actors for dropdown
  const loadActors = useCallback(async () => {
    try {
      const data = await api.getAuditActors();
      setActors(data.actors || []);
    } catch (err) {
      console.error('Failed to load actors:', err);
    }
  }, []);

  // Load audit data
  const loadAuditData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      };
      if (entityType) params.entity_type = entityType;
      if (actionType) params.action = actionType;
      if (actorId) params.actor_id = actorId;
      if (correlationId) params.correlation_id = correlationId;
      if (dateRange.since) params.since = dateRange.since;
      if (dateRange.until) params.until = dateRange.until;

      const data = await api.getAuditTimeline(params);
      const eventsList = data.events || [];
      setEvents(eventsList);
      setTotal(data.total || 0);

      // Calculate stats
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const byType = {};
      const byAction = {};

      for (const event of eventsList) {
        // By type
        byType[event.entity_type] = (byType[event.entity_type] || 0) + 1;

        // By action
        const action = event.subtype || event.action || 'UNKNOWN';
        byAction[action] = (byAction[action] || 0) + 1;
      }

      const todayCount = eventsList.filter(e =>
        new Date(e.created_at) >= todayStart
      ).length;

      setStats({ today: todayCount, byType, byAction });
    } catch (err) {
      console.error('Audit load error:', err);
      setError(err.message || 'Failed to load audit data');
    } finally {
      setLoading(false);
    }
  }, [page, entityType, actionType, actorId, correlationId, dateRange]);

  // Initial load
  useEffect(() => {
    loadActors();
  }, [loadActors]);

  useEffect(() => {
    loadAuditData();
  }, [loadAuditData]);

  // Load entity history when event is selected
  const loadEntityHistory = useCallback(async (entityType, entityId) => {
    if (!entityType || !entityId) return;

    setLoadingHistory(true);
    try {
      const data = await api.getEntityHistory(entityType, entityId);
      setEntityHistory(data.history || []);
    } catch (err) {
      console.error('Entity history error:', err);
      setEntityHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Load related events by correlation ID
  const loadRelatedEvents = useCallback(async (corrId) => {
    if (!corrId) return;

    setLoadingRelated(true);
    try {
      const data = await api.getCorrelatedEvents(corrId);
      setRelatedEvents(data.events || []);
    } catch (err) {
      console.error('Related events error:', err);
      setRelatedEvents([]);
    } finally {
      setLoadingRelated(false);
    }
  }, []);

  // Handle event click to show details
  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setEntityHistory([]);
    setRelatedEvents([]);

    if (event.entity_type && event.entity_id) {
      loadEntityHistory(event.entity_type, event.entity_id);
    }
    if (event.correlation_id) {
      loadRelatedEvents(event.correlation_id);
    }
  };

  // Handle correlation ID click to filter
  const handleCorrelationClick = (corrId) => {
    setCorrelationId(corrId);
    setPage(1);
    setSelectedEvent(null);
  };

  // Clear all filters
  const handleClearFilters = () => {
    setEntityType('');
    setActionType('');
    setActorId('');
    setCorrelationId('');
    setSearchQuery('');
    setDatePreset('7d');
    setCustomSince('');
    setCustomUntil('');
    setPage(1);
  };

  // Export to CSV
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      if (entityType) params.entity_type = entityType;
      if (actionType) params.action = actionType;
      if (actorId) params.actor_id = actorId;
      if (correlationId) params.correlation_id = correlationId;
      if (dateRange.since) params.since = dateRange.since;
      if (dateRange.until) params.until = dateRange.until;

      const blob = await api.exportAuditLog(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export audit log');
    } finally {
      setExporting(false);
    }
  };

  const hasFilters = entityType || actionType || actorId || correlationId || searchQuery || datePreset !== '7d';

  // Filter events by search query (client-side)
  const filteredEvents = useMemo(() => {
    if (!searchQuery) return events;

    const query = searchQuery.toLowerCase();
    return events.filter((event) => (
      (event.description && event.description.toLowerCase().includes(query)) ||
      (event.entity_id && event.entity_id.toLowerCase().includes(query)) ||
      (event.actor_display && event.actor_display.toLowerCase().includes(query)) ||
      (event.entity_type && event.entity_type.toLowerCase().includes(query)) ||
      (event.subtype && event.subtype.toLowerCase().includes(query)) ||
      (event.correlation_id && event.correlation_id.toLowerCase().includes(query))
    ));
  }, [events, searchQuery]);

  // Build actor options for dropdown
  const actorOptions = useMemo(() => {
    const options = [{ label: 'All Users', value: '' }];
    for (const actor of actors) {
      options.push({
        label: actor.actor_display || actor.actor_id,
        value: actor.actor_id,
      });
    }
    return options;
  }, [actors]);

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const isToday = date.toDateString() === new Date().toDateString();
    const dateStr = isToday ? 'Today' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return { dateStr, timeStr, isToday };
  };

  // Calculate pagination
  const totalPages = Math.ceil(total / pageSize);
  const canPrevious = page > 1;
  const canNext = page < totalPages;

  // Loading state
  if (loading && events.length === 0) {
    return (
      <Page title="Audit Log">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <Spinner accessibilityLabel="Loading audit events" size="large" />
                <div style={{ marginTop: '16px' }}>
                  <Text>Loading audit events...</Text>
                </div>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Audit Log"
      subtitle="Complete history of all system changes and events"
      primaryAction={{
        content: 'Export CSV',
        icon: ExportIcon,
        onAction: handleExport,
        loading: exporting,
      }}
      secondaryActions={[
        {
          content: 'Refresh',
          icon: RefreshIcon,
          onAction: loadAuditData,
        },
        {
          content: 'Clear Filters',
          icon: FilterIcon,
          onAction: handleClearFilters,
          disabled: !hasFilters,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Error Banner */}
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            {/* Filters Card */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm">Filters</Text>
                <Divider />
                <InlineStack gap="400" align="start" wrap>
                  {/* Date Range */}
                  <div style={{ minWidth: '140px' }}>
                    <Select
                      label="Date Range"
                      options={DATE_PRESETS}
                      value={datePreset}
                      onChange={(value) => {
                        setDatePreset(value);
                        setPage(1);
                      }}
                    />
                  </div>
                  {datePreset === 'custom' && (
                    <>
                      <div style={{ minWidth: '140px' }}>
                        <TextField
                          label="From"
                          type="date"
                          value={customSince}
                          onChange={(value) => {
                            setCustomSince(value);
                            setPage(1);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ minWidth: '140px' }}>
                        <TextField
                          label="To"
                          type="date"
                          value={customUntil}
                          onChange={(value) => {
                            setCustomUntil(value);
                            setPage(1);
                          }}
                          autoComplete="off"
                        />
                      </div>
                    </>
                  )}
                  {/* Entity Type */}
                  <div style={{ minWidth: '140px' }}>
                    <Select
                      label="Entity Type"
                      options={ENTITY_TYPES}
                      value={entityType}
                      onChange={(value) => {
                        setEntityType(value);
                        setPage(1);
                      }}
                    />
                  </div>
                  {/* Action Type */}
                  <div style={{ minWidth: '140px' }}>
                    <Select
                      label="Action"
                      options={ACTION_TYPES}
                      value={actionType}
                      onChange={(value) => {
                        setActionType(value);
                        setPage(1);
                      }}
                    />
                  </div>
                  {/* User */}
                  <div style={{ minWidth: '160px' }}>
                    <Select
                      label="User"
                      options={actorOptions}
                      value={actorId}
                      onChange={(value) => {
                        setActorId(value);
                        setPage(1);
                      }}
                    />
                  </div>
                  {/* Correlation ID */}
                  <div style={{ minWidth: '200px' }}>
                    <TextField
                      label="Correlation ID"
                      value={correlationId}
                      onChange={(value) => {
                        setCorrelationId(value);
                        setPage(1);
                      }}
                      placeholder="Filter by correlation ID"
                      clearButton
                      onClearButtonClick={() => {
                        setCorrelationId('');
                        setPage(1);
                      }}
                      autoComplete="off"
                    />
                  </div>
                  {/* Search */}
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <TextField
                      label="Search"
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="Search descriptions, IDs..."
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => setSearchQuery('')}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Results Summary */}
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" tone="subdued">
                Showing {filteredEvents.length} of {total} events
                {searchQuery && ` (filtered by search)`}
              </Text>
              {loading && <Spinner size="small" />}
            </InlineStack>

            {/* Events Table */}
            <Card>
              {filteredEvents.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingSm" tone="subdued">
                      {searchQuery || hasFilters ? 'No matching events' : 'No audit events'}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      {searchQuery || hasFilters
                        ? 'Try adjusting your filters or search term.'
                        : 'System changes will appear here.'}
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                  headings={['Time', 'Action', 'Entity', 'Description', 'User', '']}
                  rows={filteredEvents.map((event) => {
                    const { dateStr, timeStr, isToday } = formatTimestamp(event.created_at);
                    return [
                      <BlockStack key="time" gap="050">
                        <Text variant="bodySm" fontWeight={isToday ? 'semibold' : 'regular'}>
                          {dateStr}
                        </Text>
                        <Text variant="bodySm" tone="subdued">{timeStr}</Text>
                      </BlockStack>,
                      <ActionBadge key="action" action={event.subtype || event.action || 'UNKNOWN'} />,
                      <BlockStack key="entity" gap="050">
                        <EntityBadge type={event.entity_type} />
                        {event.entity_id && (
                          <Text variant="bodySm" tone="subdued" fontFamily="mono">
                            {event.entity_id.substring(0, 8)}...
                          </Text>
                        )}
                      </BlockStack>,
                      <Text key="desc" variant="bodySm" truncate>
                        {event.description?.length > 60
                          ? `${event.description.substring(0, 60)}...`
                          : event.description || '-'}
                      </Text>,
                      <BlockStack key="actor" gap="050">
                        <Text variant="bodySm" fontWeight="medium">
                          {event.actor_display || 'System'}
                        </Text>
                        {event.correlation_id && (
                          <Button
                            size="micro"
                            variant="plain"
                            onClick={() => handleCorrelationClick(event.correlation_id)}
                          >
                            <Text variant="bodySm" tone="subdued" fontFamily="mono">
                              {event.correlation_id.substring(0, 8)}...
                            </Text>
                          </Button>
                        )}
                      </BlockStack>,
                      <Button
                        key="details"
                        size="slim"
                        onClick={() => handleEventClick(event)}
                      >
                        Details
                      </Button>,
                    ];
                  })}
                  footerContent={
                    totalPages > 1 && (
                      <InlineStack align="center" gap="400">
                        <Button
                          disabled={!canPrevious}
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Text variant="bodySm">
                          Page {page} of {totalPages}
                        </Text>
                        <Button
                          disabled={!canNext}
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </InlineStack>
                    )
                  }
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Sidebar with Stats */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Quick Stats */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm">Statistics</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text variant="bodySm">Total Events (filtered)</Text>
                  <Text variant="bodyMd" fontWeight="bold">{total}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm">Shown</Text>
                  <Text variant="bodyMd" fontWeight="bold">{filteredEvents.length}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text variant="bodySm">Today</Text>
                  <Text variant="bodyMd" fontWeight="bold" tone="success">{stats.today}</Text>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Events by Type */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm">By Entity Type</Text>
                <Divider />
                {Object.entries(stats.byType)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([type, count]) => (
                    <InlineStack key={type} align="space-between">
                      <EntityBadge type={type} />
                      <Text variant="bodySm" fontWeight="semibold">{count}</Text>
                    </InlineStack>
                  ))}
                {Object.keys(stats.byType).length === 0 && (
                  <Text tone="subdued" variant="bodySm">No data</Text>
                )}
              </BlockStack>
            </Card>

            {/* Events by Action */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm">By Action</Text>
                <Divider />
                {Object.entries(stats.byAction)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([action, count]) => (
                    <InlineStack key={action} align="space-between">
                      <ActionBadge action={action} />
                      <Text variant="bodySm" fontWeight="semibold">{count}</Text>
                    </InlineStack>
                  ))}
                {Object.keys(stats.byAction).length === 0 && (
                  <Text tone="subdued" variant="bodySm">No data</Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <Modal
          open={!!selectedEvent}
          onClose={() => {
            setSelectedEvent(null);
            setEntityHistory([]);
            setRelatedEvents([]);
          }}
          title="Event Details"
          large
          secondaryActions={[
            {
              content: 'Close',
              onAction: () => {
                setSelectedEvent(null);
                setEntityHistory([]);
                setRelatedEvents([]);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {/* Event Header */}
              <InlineStack gap="400" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Action</Text>
                  <ActionBadge action={selectedEvent.subtype || selectedEvent.action} />
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Entity Type</Text>
                  <EntityBadge type={selectedEvent.entity_type} />
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Entity ID</Text>
                  <InlineStack gap="100" blockAlign="center">
                    <Text variant="bodyMd" fontFamily="mono">
                      {selectedEvent.entity_id || '-'}
                    </Text>
                    {selectedEvent.entity_id && (
                      <CopyButton text={selectedEvent.entity_id} label="Copy Entity ID" />
                    )}
                  </InlineStack>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Time</Text>
                  <Text variant="bodyMd">
                    {new Date(selectedEvent.created_at).toLocaleString('en-GB')}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* Description */}
              <BlockStack gap="200">
                <Text variant="headingSm">Description</Text>
                <Card>
                  <Text variant="bodyMd">{selectedEvent.description || 'No description'}</Text>
                </Card>
              </BlockStack>

              {/* Actor Info */}
              <BlockStack gap="200">
                <Text variant="headingSm">Actor</Text>
                <InlineStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Name</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {selectedEvent.actor_display || 'System'}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Type</Text>
                    <Text variant="bodyMd">{selectedEvent.actor_type || 'SYSTEM'}</Text>
                  </BlockStack>
                  {selectedEvent.actor_id && (
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">ID</Text>
                      <Text variant="bodyMd" fontFamily="mono">{selectedEvent.actor_id}</Text>
                    </BlockStack>
                  )}
                </InlineStack>
              </BlockStack>

              {/* Correlation ID */}
              {selectedEvent.correlation_id && (
                <BlockStack gap="200">
                  <Text variant="headingSm">Correlation ID</Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="bodyMd" fontFamily="mono">
                      {selectedEvent.correlation_id}
                    </Text>
                    <CopyButton text={selectedEvent.correlation_id} label="Copy Correlation ID" />
                    <Button
                      size="slim"
                      onClick={() => handleCorrelationClick(selectedEvent.correlation_id)}
                    >
                      Filter by this ID
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}

              {/* Changes (Diff View) */}
              {(selectedEvent.metadata?.before || selectedEvent.metadata?.after) ? (
                <BlockStack gap="200">
                  <Text variant="headingSm">Changes</Text>
                  <DiffViewer
                    before={selectedEvent.metadata?.before}
                    after={selectedEvent.metadata?.after}
                  />
                </BlockStack>
              ) : selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 ? (
                <BlockStack gap="200">
                  <Text variant="headingSm">Metadata</Text>
                  <Card>
                    <div style={{
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '200px',
                      overflow: 'auto',
                    }}>
                      {JSON.stringify(selectedEvent.metadata, null, 2)}
                    </div>
                  </Card>
                </BlockStack>
              ) : null}

              {/* Related Events (same correlation ID) */}
              {selectedEvent.correlation_id && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">Related Events (same operation)</Text>
                      {loadingRelated && <Spinner size="small" />}
                    </InlineStack>
                    {relatedEvents.length > 0 ? (
                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text']}
                        headings={['Time', 'Action', 'Entity', 'Description']}
                        rows={relatedEvents.slice(0, 10).map((h) => [
                          new Date(h.created_at).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                          <ActionBadge key="action" action={h.action} />,
                          <BlockStack key="entity" gap="050">
                            <EntityBadge type={h.entity_type} />
                            <Text variant="bodySm" tone="subdued" fontFamily="mono">
                              {h.entity_id?.substring(0, 8)}...
                            </Text>
                          </BlockStack>,
                          h.changes_summary || '-',
                        ])}
                        footerContent={
                          relatedEvents.length > 10
                            ? `Showing 10 of ${relatedEvents.length} related entries`
                            : undefined
                        }
                      />
                    ) : !loadingRelated ? (
                      <Text tone="subdued" variant="bodySm">No related events found.</Text>
                    ) : null}
                  </BlockStack>
                </>
              )}

              {/* Entity History */}
              {selectedEvent.entity_id && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">Entity History</Text>
                      {loadingHistory && <Spinner size="small" />}
                    </InlineStack>
                    {entityHistory.length > 0 ? (
                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text']}
                        headings={['Time', 'Action', 'Description', 'By']}
                        rows={entityHistory.slice(0, 10).map((h) => [
                          new Date(h.created_at).toLocaleString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                          <ActionBadge key="action" action={h.action} />,
                          h.changes_summary || '-',
                          h.actor_display || 'System',
                        ])}
                        footerContent={
                          entityHistory.length > 10
                            ? `Showing 10 of ${entityHistory.length} history entries`
                            : undefined
                        }
                      />
                    ) : !loadingHistory ? (
                      <Text tone="subdued" variant="bodySm">No additional history found.</Text>
                    ) : null}
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
