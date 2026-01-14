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
  Tabs,
} from '@shopify/polaris';
import {
  InvictaSectionHeader,
  InvictaPanel,
  InvictaTimeline,
  InvictaBadge,
  InvictaButton,
  InvictaLoading,
  InvictaTable,
} from '../components/ui/index.jsx';
import * as api from '../utils/api.jsx';

const ENTITY_TYPES = [
  { label: 'All Types', value: '' },
  { label: 'Components', value: 'COMPONENT' },
  { label: 'BOMs', value: 'BOM' },
  { label: 'Listings', value: 'LISTING_MEMORY' },
  { label: 'Orders', value: 'ORDER' },
  { label: 'Pick Batches', value: 'PICK_BATCH' },
  { label: 'Returns', value: 'RETURN' },
  { label: 'Stock', value: 'STOCK' },
  { label: 'System', value: 'SYSTEM' },
];

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
];

const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'month' },
  { label: 'All time', value: 'all' },
  { label: 'Custom', value: 'custom' },
];

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
 * Format a value for display
 */
function formatValue(value) {
  if (value === null || value === undefined) return <Text tone="subdued">null</Text>;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Diff viewer component
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
                  overflow: 'auto',
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
                  overflow: 'auto',
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
  };
  return <Badge tone={toneMap[action] || 'default'}>{action}</Badge>;
}

/**
 * Entity type badge
 */
function EntityBadge({ type }) {
  const toneMap = {
    COMPONENT: 'info',
    BOM: 'success',
    ORDER: 'attention',
    PICK_BATCH: 'warning',
    RETURN: 'critical',
    STOCK: 'info',
    LISTING_MEMORY: 'success',
    SYSTEM: 'default',
  };
  return <Badge tone={toneMap[type] || 'default'}>{type}</Badge>;
}

/**
 * AuditPage - View audit timeline and system events
 */
export default function AuditPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [activity, setActivity] = useState([]);

  // Filter state
  const [entityType, setEntityType] = useState('');
  const [actionType, setActionType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState('7d');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  // Detail modal
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [entityHistory, setEntityHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    today: 0,
    byType: {},
    byAction: {},
    byActor: {},
  });

  // Calculate date range
  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        since: customSince ? new Date(customSince).toISOString() : null,
        until: customUntil ? new Date(customUntil + 'T23:59:59').toISOString() : null,
      };
    }
    return getDateRange(datePreset);
  }, [datePreset, customSince, customUntil]);

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
      if (dateRange.since) params.since = dateRange.since;
      if (dateRange.until) params.until = dateRange.until;

      const [timelineData, activityData] = await Promise.all([
        api.getAuditTimeline(params),
        api.getRecentActivity(),
      ]);

      const eventsList = timelineData.events || [];
      setEvents(eventsList);
      setTotal(timelineData.total || 0);
      setActivity(activityData.events || activityData || []);

      // Calculate stats
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const byType = {};
      const byAction = {};
      const byActor = {};

      for (const event of eventsList) {
        // By type
        byType[event.entity_type] = (byType[event.entity_type] || 0) + 1;

        // By action
        const action = event.subtype || event.action || 'UNKNOWN';
        byAction[action] = (byAction[action] || 0) + 1;

        // By actor
        const actor = event.actor_display || 'System';
        byActor[actor] = (byActor[actor] || 0) + 1;
      }

      const todayCount = eventsList.filter(e =>
        new Date(e.created_at) >= todayStart
      ).length;

      setStats({ today: todayCount, byType, byAction, byActor });
    } catch (err) {
      console.error('Audit load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, entityType, actionType, dateRange]);

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

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    if (event.entity_type && event.entity_id) {
      loadEntityHistory(event.entity_type, event.entity_id);
    }
  };

  const handleClearFilters = () => {
    setEntityType('');
    setActionType('');
    setSearchQuery('');
    setDatePreset('7d');
    setCustomSince('');
    setCustomUntil('');
    setPage(1);
  };

  const hasFilters = entityType || actionType || searchQuery || datePreset !== '7d';

  // Filter events by search query (client-side)
  const filteredEvents = useMemo(() => {
    if (!searchQuery) return events;

    const query = searchQuery.toLowerCase();
    return events.filter((event) => (
      (event.description && event.description.toLowerCase().includes(query)) ||
      (event.entity_id && event.entity_id.toLowerCase().includes(query)) ||
      (event.actor_display && event.actor_display.toLowerCase().includes(query)) ||
      (event.entity_type && event.entity_type.toLowerCase().includes(query)) ||
      (event.subtype && event.subtype.toLowerCase().includes(query))
    ));
  }, [events, searchQuery]);

  const columns = [
    {
      id: 'created_at',
      header: 'Time',
      accessor: (row) => row.created_at,
      render: (value) => {
        const date = new Date(value);
        const isToday = date.toDateString() === new Date().toDateString();
        return (
          <BlockStack gap="100">
            <Text variant="bodySm" fontWeight={isToday ? 'semibold' : 'regular'}>
              {isToday ? 'Today' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </Text>
            <Text variant="bodySm" tone="subdued">{date.toLocaleTimeString('en-GB')}</Text>
          </BlockStack>
        );
      },
      sortable: true,
    },
    {
      id: 'action',
      header: 'Action',
      accessor: (row) => row.subtype || row.action,
      render: (value) => <ActionBadge action={value} />,
    },
    {
      id: 'entity_type',
      header: 'Entity',
      accessor: (row) => row.entity_type,
      render: (value, row) => (
        <BlockStack gap="100">
          <EntityBadge type={value} />
          <Text variant="bodySm" tone="subdued" fontFamily="mono">
            {row.entity_id?.substring(0, 8)}...
          </Text>
        </BlockStack>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      accessor: (row) => row.description,
      render: (value) => (
        <Text variant="bodySm">
          {value?.length > 80 ? `${value.substring(0, 80)}...` : value || '-'}
        </Text>
      ),
    },
    {
      id: 'actor_display',
      header: 'By',
      accessor: (row) => row.actor_display,
      render: (value, row) => (
        <BlockStack gap="100">
          <Text variant="bodySm" fontWeight="semibold">{value || 'System'}</Text>
          <Text variant="bodySm" tone="subdued">{row.actor_type}</Text>
        </BlockStack>
      ),
    },
    {
      id: 'actions',
      header: '',
      render: (_, row) => (
        <Button size="slim" onClick={() => handleEventClick(row)}>Details</Button>
      ),
    },
  ];

  if (loading && events.length === 0) {
    return (
      <Page title="Audit Log">
        <InvictaLoading message="Loading audit events..." />
      </Page>
    );
  }

  return (
    <Page
      title="Audit Log"
      subtitle="Complete history of all system changes and events"
      secondaryActions={[
        { content: 'Refresh', onAction: loadAuditData },
        { content: 'Clear Filters', onAction: handleClearFilters, disabled: !hasFilters },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            {/* Filters */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="400" align="start" wrap>
                  <div style={{ minWidth: '150px' }}>
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
                      <div style={{ minWidth: '150px' }}>
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
                      <div style={{ minWidth: '150px' }}>
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
                  <div style={{ minWidth: '150px' }}>
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
                  <div style={{ minWidth: '150px' }}>
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
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <TextField
                      label="Search"
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="Search descriptions, IDs, actors..."
                      clearButton
                      onClearButtonClick={() => setSearchQuery('')}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Events Table */}
            <InvictaTable
              columns={columns}
              data={filteredEvents}
              loading={loading}
              emptyState={{
                heading: searchQuery || hasFilters ? 'No matching events' : 'No audit events',
                description: searchQuery || hasFilters
                  ? 'Try adjusting your filters or search term.'
                  : 'System changes will appear here.',
              }}
              resourceName={{ singular: 'event', plural: 'events' }}
              pagination={{
                page,
                totalPages: Math.ceil(total / pageSize),
                onPageChange: setPage,
              }}
              onRowClick={handleEventClick}
            />
          </BlockStack>
        </Layout.Section>

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
                {searchQuery && (
                  <InlineStack align="space-between">
                    <Text variant="bodySm">Matching Search</Text>
                    <Text variant="bodyMd" fontWeight="bold">{filteredEvents.length}</Text>
                  </InlineStack>
                )}
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

            {/* Top Actors */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingSm">Top Actors</Text>
                <Divider />
                {Object.entries(stats.byActor)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([actor, count]) => (
                    <InlineStack key={actor} align="space-between">
                      <Text variant="bodySm">{actor}</Text>
                      <Text variant="bodySm" fontWeight="semibold">{count}</Text>
                    </InlineStack>
                  ))}
                {Object.keys(stats.byActor).length === 0 && (
                  <Text tone="subdued" variant="bodySm">No data</Text>
                )}
              </BlockStack>
            </Card>

            {/* Recent Activity Timeline */}
            {activity.length > 0 && (
              <InvictaSectionHeader title="Recent Activity" count={activity.length}>
                <InvictaTimeline
                  events={activity.slice(0, 8)}
                  onEventClick={handleEventClick}
                />
              </InvictaSectionHeader>
            )}
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
          }}
          title="Event Details"
          large
          secondaryActions={[
            {
              content: 'Close',
              onAction: () => {
                setSelectedEvent(null);
                setEntityHistory([]);
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
                  <Text variant="bodyMd" fontFamily="mono">{selectedEvent.entity_id || '-'}</Text>
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
                  {selectedEvent.correlation_id && (
                    <BlockStack gap="100">
                      <Text variant="bodySm" tone="subdued">Correlation ID</Text>
                      <Text variant="bodyMd" fontFamily="mono">
                        {selectedEvent.correlation_id.substring(0, 12)}...
                      </Text>
                    </BlockStack>
                  )}
                </InlineStack>
              </BlockStack>

              {/* Changes (Diff View) */}
              {selectedEvent.metadata?.before || selectedEvent.metadata?.after ? (
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

              {/* Entity History */}
              {selectedEvent.entity_id && (
                <>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="headingSm">Entity History</Text>
                      {loadingHistory && <Text tone="subdued">Loading...</Text>}
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
