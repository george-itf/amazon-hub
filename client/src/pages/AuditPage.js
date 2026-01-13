import React, { useEffect, useState, useCallback } from 'react';
import {
  Page,
  Layout,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Select,
  TextField,
  Filters,
  Card,
} from '@shopify/polaris';
import {
  InvictaSectionHeader,
  InvictaPanel,
  InvictaTimeline,
  InvictaBadge,
  InvictaButton,
  InvictaLoading,
  InvictaTable,
} from '../components/ui/index.js';
import * as api from '../utils/api.js';

const ENTITY_TYPES = [
  { label: 'All Types', value: '' },
  { label: 'Components', value: 'COMPONENT' },
  { label: 'BOMs', value: 'BOM' },
  { label: 'Listings', value: 'LISTING_MEMORY' },
  { label: 'Orders', value: 'ORDER' },
  { label: 'Pick Batches', value: 'PICK_BATCH' },
  { label: 'Returns', value: 'RETURN' },
  { label: 'Stock', value: 'STOCK' },
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
];

/**
 * AuditPage - View audit timeline and system events
 */
export default function AuditPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [activity, setActivity] = useState([]);
  const [entityType, setEntityType] = useState('');
  const [actionType, setActionType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

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

      const [timelineData, activityData] = await Promise.all([
        api.getAuditTimeline(params),
        api.getRecentActivity(),
      ]);

      setEvents(timelineData.events || []);
      setTotal(timelineData.total || 0);
      setActivity(activityData.events || []);
    } catch (err) {
      console.error('Audit load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, entityType, actionType]);

  useEffect(() => {
    loadAuditData();
  }, [loadAuditData]);

  const handleEventClick = (event) => {
    // Show event details in a modal or expand
    console.log('Event clicked:', event);
  };

  const columns = [
    {
      id: 'created_at',
      header: 'Time',
      accessor: (row) => row.created_at,
      render: (value) => {
        const date = new Date(value);
        return (
          <BlockStack gap="100">
            <Text variant="bodySm">{date.toLocaleDateString()}</Text>
            <Text variant="bodySm" tone="subdued">{date.toLocaleTimeString()}</Text>
          </BlockStack>
        );
      },
      sortable: true,
    },
    {
      id: 'action',
      header: 'Action',
      accessor: (row) => row.action,
      render: (value) => <InvictaBadge status={value} size="small" />,
    },
    {
      id: 'entity_type',
      header: 'Entity',
      accessor: (row) => row.entity_type,
      render: (value, row) => (
        <BlockStack gap="100">
          <Text variant="bodySm">{value}</Text>
          <Text variant="bodySm" tone="subdued">{row.entity_id?.substring(0, 8)}</Text>
        </BlockStack>
      ),
    },
    {
      id: 'changes_summary',
      header: 'Description',
      accessor: (row) => row.changes_summary,
      render: (value) => (
        <Text variant="bodySm">{value || '-'}</Text>
      ),
    },
    {
      id: 'actor_display',
      header: 'By',
      accessor: (row) => row.actor_display,
      render: (value, row) => (
        <BlockStack gap="100">
          <Text variant="bodySm">{value || 'System'}</Text>
          <Text variant="bodySm" tone="subdued">{row.actor_type}</Text>
        </BlockStack>
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
      subtitle="View all system changes and events"
      secondaryActions={[
        { content: 'Refresh', onAction: loadAuditData },
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
              <InlineStack gap="400" align="start">
                <div style={{ minWidth: '200px' }}>
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
                <div style={{ minWidth: '200px' }}>
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
                <div style={{ flex: 1, maxWidth: '300px' }}>
                  <TextField
                    label="Search"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search descriptions..."
                    clearButton
                    onClearButtonClick={() => setSearchQuery('')}
                  />
                </div>
              </InlineStack>
            </Card>

            {/* Events Table */}
            <InvictaTable
              columns={columns}
              data={events}
              loading={loading}
              emptyState={{
                heading: 'No audit events',
                description: 'System changes will appear here.',
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
            <InvictaPanel title="Audit Statistics">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text>Total Events</Text>
                  <Text fontWeight="semibold">{total}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text>Today</Text>
                  <Text fontWeight="semibold">
                    {events.filter(e =>
                      new Date(e.created_at).toDateString() === new Date().toDateString()
                    ).length}
                  </Text>
                </InlineStack>
              </BlockStack>
            </InvictaPanel>

            {/* Recent Activity Timeline */}
            <InvictaSectionHeader title="Recent Activity" count={activity.length}>
              <InvictaTimeline
                events={activity.slice(0, 10)}
                onEventClick={handleEventClick}
              />
            </InvictaSectionHeader>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
