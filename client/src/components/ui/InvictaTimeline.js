import React from 'react';
import { Card, BlockStack, Text, InlineStack } from '@shopify/polaris';
import { InvictaBadge } from './InvictaBadge.js';

/**
 * InvictaTimeline - Audit timeline display
 *
 * Props:
 * - events: Array<{ id, timestamp, type, description, actor, entity, metadata }>
 * - loading: boolean
 * - onEventClick: function(event)
 */
export function InvictaTimeline({ events = [], loading = false, onEventClick }) {
  if (loading) {
    return (
      <Card>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <Text tone="subdued">Loading timeline...</Text>
        </div>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <Text tone="subdued">No events to display</Text>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Vertical line */}
      <div style={{
        position: 'absolute',
        left: '11px',
        top: '20px',
        bottom: '20px',
        width: '2px',
        backgroundColor: '#E3E8EE',
      }} />

      <BlockStack gap="200">
        {events.map((event, index) => (
          <InvictaTimelineEvent
            key={event.id || index}
            event={event}
            onClick={onEventClick ? () => onEventClick(event) : undefined}
          />
        ))}
      </BlockStack>
    </div>
  );
}

/**
 * InvictaTimelineEvent - Single timeline event
 */
function InvictaTimelineEvent({ event, onClick }) {
  const formattedTime = formatTimestamp(event.timestamp || event.created_at);

  const getEventColor = (type) => {
    const colors = {
      CREATE: '#008060',
      UPDATE: '#2C6ECB',
      DELETE: '#D72C0D',
      SUPERSEDE: '#9C6ADE',
      RECEIVE: '#008060',
      ADJUST: '#FFB020',
      RESERVE: '#2C6ECB',
      CONFIRM: '#008060',
      CANCEL: '#D72C0D',
      DEFAULT: '#637381',
    };
    return colors[type?.toUpperCase()] || colors.DEFAULT;
  };

  const dotColor = getEventColor(event.action || event.event_type);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '8px',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '4px',
        transition: 'background-color 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={(e) => onClick && (e.currentTarget.style.backgroundColor = '#F6F6F7')}
      onMouseLeave={(e) => onClick && (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      {/* Dot */}
      <div style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        backgroundColor: 'white',
        border: `3px solid ${dotColor}`,
        flexShrink: 0,
        marginTop: '2px',
        zIndex: 1,
      }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineStack gap="200" align="space-between" wrap={false}>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <InvictaBadge
                status={event.action || event.event_type}
                size="small"
              />
              {event.entity_type && (
                <Text variant="bodySm" tone="subdued">
                  {event.entity_type}
                </Text>
              )}
            </InlineStack>
            <Text variant="bodyMd">
              {event.description || event.changes_summary || 'No description'}
            </Text>
            {event.actor_display && (
              <Text variant="bodySm" tone="subdued">
                by {event.actor_display}
              </Text>
            )}
          </BlockStack>
          <Text variant="bodySm" tone="subdued" alignment="end">
            {formattedTime}
          </Text>
        </InlineStack>
      </div>
    </div>
  );
}

/**
 * Helper: Format timestamp for display
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * InvictaActivityFeed - Compact activity feed for dashboard
 */
export function InvictaActivityFeed({ events = [], limit = 5, title = 'Recent Activity' }) {
  const displayEvents = events.slice(0, limit);

  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingMd">{title}</Text>
        {displayEvents.length === 0 ? (
          <Text tone="subdued">No recent activity</Text>
        ) : (
          displayEvents.map((event, index) => (
            <InlineStack key={event.id || index} gap="200" align="space-between">
              <Text variant="bodySm">
                {event.description || event.changes_summary}
              </Text>
              <Text variant="bodySm" tone="subdued">
                {formatTimestamp(event.timestamp || event.created_at)}
              </Text>
            </InlineStack>
          ))
        )}
      </BlockStack>
    </Card>
  );
}

export default InvictaTimeline;
