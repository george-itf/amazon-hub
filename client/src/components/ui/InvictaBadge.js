import React from 'react';
import { Badge, Tooltip } from '@shopify/polaris';

/**
 * Status color mapping for different statuses
 */
const STATUS_COLORS = {
  // Order statuses
  IMPORTED: { bg: '#E3E8EE', color: '#637381', tone: 'default' },
  NEEDS_REVIEW: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  READY_TO_PICK: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  PICKED: { bg: '#CCE5FF', color: '#004085', tone: 'info' },
  DISPATCHED: { bg: '#D1ECF1', color: '#0C5460', tone: 'success' },
  CANCELLED: { bg: '#F8D7DA', color: '#721C24', tone: 'critical' },

  // Pick batch statuses
  DRAFT: { bg: '#E3E8EE', color: '#637381', tone: 'default' },
  RESERVED: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  CONFIRMED: { bg: '#D4EDDA', color: '#155724', tone: 'success' },

  // Return statuses
  PENDING_INSPECTION: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  INSPECTED: { bg: '#CCE5FF', color: '#004085', tone: 'info' },
  PROCESSED: { bg: '#D4EDDA', color: '#155724', tone: 'success' },

  // Disposition types
  RESTOCK: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  REFURB: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  SCRAP: { bg: '#F8D7DA', color: '#721C24', tone: 'critical' },
  SUPPLIER_RETURN: { bg: '#E2D5F1', color: '#5A2D82', tone: 'new' },

  // Review queue statuses
  PENDING: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  RESOLVED: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  SKIPPED: { bg: '#E3E8EE', color: '#637381', tone: 'default' },

  // Stock levels
  IN_STOCK: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  LOW_STOCK: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  OUT_OF_STOCK: { bg: '#F8D7DA', color: '#721C24', tone: 'critical' },

  // Boolean states
  ACTIVE: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  INACTIVE: { bg: '#E3E8EE', color: '#637381', tone: 'default' },

  // Roles
  ADMIN: { bg: '#E2D5F1', color: '#5A2D82', tone: 'new' },
  STAFF: { bg: '#CCE5FF', color: '#004085', tone: 'info' },

  // Resolution sources
  ASIN: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  SKU: { bg: '#CCE5FF', color: '#004085', tone: 'info' },
  FINGERPRINT: { bg: '#FFF3CD', color: '#856404', tone: 'attention' },
  MEMORY: { bg: '#D4EDDA', color: '#155724', tone: 'success' },
  MANUAL: { bg: '#E2D5F1', color: '#5A2D82', tone: 'new' },
};

/**
 * InvictaBadge - Status badge with automatic color mapping
 *
 * Props:
 * - status: string - Status key (maps to predefined colors)
 * - label: string - Optional custom label (defaults to status)
 * - tooltip: string - Optional tooltip text
 * - size: 'small' | 'medium'
 */
export function InvictaBadge({ status, label, tooltip, size = 'medium' }) {
  const normalizedStatus = status?.toUpperCase()?.replace(/[- ]/g, '_');
  const config = STATUS_COLORS[normalizedStatus] || STATUS_COLORS.IMPORTED;

  const displayLabel = label || status?.replace(/_/g, ' ') || 'Unknown';

  const badgeStyle = size === 'small' ? {
    fontSize: '11px',
    padding: '2px 6px',
  } : {};

  const badge = (
    <Badge tone={config.tone} size={size}>
      {displayLabel}
    </Badge>
  );

  if (tooltip) {
    return <Tooltip content={tooltip}>{badge}</Tooltip>;
  }

  return badge;
}

/**
 * InvictaStockBadge - Badge specifically for stock levels
 */
export function InvictaStockBadge({ available, reserved, threshold = 10 }) {
  let status, label;

  if (available <= 0) {
    status = 'OUT_OF_STOCK';
    label = 'Out of Stock';
  } else if (available <= threshold) {
    status = 'LOW_STOCK';
    label = `Low (${available})`;
  } else {
    status = 'IN_STOCK';
    label = `${available} avail`;
  }

  const tooltip = reserved > 0 ? `${reserved} reserved` : undefined;

  return <InvictaBadge status={status} label={label} tooltip={tooltip} />;
}

/**
 * InvictaResolutionBadge - Badge for showing resolution method
 */
export function InvictaResolutionBadge({ method, resolved }) {
  if (!resolved) {
    return <InvictaBadge status="NEEDS_REVIEW" label="Unresolved" />;
  }

  return <InvictaBadge status={method} label={method} tooltip={`Resolved via ${method}`} />;
}

export default InvictaBadge;
