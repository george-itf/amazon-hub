/**
 * Standardised terminology for Amazon Hub
 * Use these constants across all UI components for consistency
 */

// Order statuses (canonical labels)
export const ORDER_STATUS = {
  PENDING: { value: 'PENDING', label: 'Pending', tone: 'attention' },
  READY_TO_PICK: { value: 'READY_TO_PICK', label: 'Ready to Pick', tone: 'info' },
  PICKED: { value: 'PICKED', label: 'Picked', tone: 'success' },
  DISPATCHED: { value: 'DISPATCHED', label: 'Dispatched', tone: 'success' },
  DELIVERED: { value: 'DELIVERED', label: 'Delivered', tone: 'success' },
  CANCELLED: { value: 'CANCELLED', label: 'Cancelled', tone: 'critical' },
  ON_HOLD: { value: 'ON_HOLD', label: 'On Hold', tone: 'warning' },
};

// Listing statuses
export const LISTING_STATUS = {
  ACTIVE: { value: 'ACTIVE', label: 'Active', tone: 'success' },
  INACTIVE: { value: 'INACTIVE', label: 'Inactive', tone: 'subdued' },
  SUPPRESSED: { value: 'SUPPRESSED', label: 'Suppressed', tone: 'critical' },
  PENDING_REVIEW: { value: 'PENDING_REVIEW', label: 'Pending Review', tone: 'attention' },
};

// Stock adjustment reason codes
export const ADJUSTMENT_REASON = {
  STOCK_COUNT: { value: 'STOCK_COUNT', label: 'Stock Count', description: 'Physical recount result' },
  PURCHASE: { value: 'PURCHASE', label: 'Purchase', description: 'New stock received' },
  DAMAGE: { value: 'DAMAGE', label: 'Damage', description: 'Items damaged/unusable' },
  SHRINKAGE: { value: 'SHRINKAGE', label: 'Shrinkage', description: 'Missing/lost inventory' },
  RETURN_TO_SUPPLIER: { value: 'RETURN_TO_SUPPLIER', label: 'Return to Supplier', description: 'Stock returned to vendor' },
  CUSTOMER_RETURN: { value: 'CUSTOMER_RETURN', label: 'Customer Return', description: 'Returned by customer' },
  CORRECTION: { value: 'CORRECTION', label: 'Correction', description: 'Fix previous error' },
  TRANSFER: { value: 'TRANSFER', label: 'Transfer', description: 'Moved between locations' },
};

// Action verbs (consistent across UI)
export const ACTION_VERBS = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
  ASSIGN: 'Assign',
  REMOVE: 'Remove',
  APPLY: 'Apply',
  CANCEL: 'Cancel',
  CONFIRM: 'Confirm',
  EXPORT: 'Export',
  IMPORT: 'Import',
  REFRESH: 'Refresh',
  SAVE: 'Save',
  DISCARD: 'Discard',
  UNDO: 'Undo',
  RETRY: 'Retry',
};

// Safety levels for actions
export const SAFETY_LEVEL = {
  SAFE: { level: 'safe', label: 'Safe', description: 'No risk, easily reversible', requiresConfirmation: false },
  MODERATE: { level: 'moderate', label: 'Moderate', description: 'May need review, reversible with effort', requiresConfirmation: true },
  RISKY: { level: 'risky', label: 'Risky', description: 'Affects multiple items, harder to reverse', requiresConfirmation: true, requiresTypedConfirmation: false },
  IRREVERSIBLE: { level: 'irreversible', label: 'Irreversible', description: 'Cannot be undone', requiresConfirmation: true, requiresTypedConfirmation: true },
};

// BOM statuses
export const BOM_STATUS = {
  ASSIGNED: { value: 'ASSIGNED', label: 'BOM Assigned', tone: 'success' },
  UNASSIGNED: { value: 'UNASSIGNED', label: 'No BOM', tone: 'attention' },
  PENDING_REVIEW: { value: 'PENDING_REVIEW', label: 'Needs Review', tone: 'warning' },
  UNKNOWN: { value: 'UNKNOWN', label: 'Unknown', tone: 'subdued' },
};

// Stock levels
export const STOCK_LEVEL = {
  IN_STOCK: { value: 'IN_STOCK', label: 'In Stock', tone: 'success', threshold: 10 },
  LOW_STOCK: { value: 'LOW_STOCK', label: 'Low Stock', tone: 'warning', threshold: 5 },
  OUT_OF_STOCK: { value: 'OUT_OF_STOCK', label: 'Out of Stock', tone: 'critical', threshold: 0 },
};

// Shipping service codes
export const SHIPPING_SERVICE = {
  TPN: { value: 'TPN', label: 'Tracked 24', description: 'Next day delivery', priceRange: '£3.50-4.50' },
  TPL: { value: 'TPL', label: 'Tracked 48', description: '2-day delivery', priceRange: '£2.80-3.50' },
  STL1: { value: 'STL1', label: '1st Class', description: '1-2 days', priceRange: '£1.50-2.50' },
  STL2: { value: 'STL2', label: '2nd Class', description: '2-3 days', priceRange: '£0.85-1.50' },
};

// Helper functions
export function getStatusBadgeProps(status, statusMap) {
  const config = statusMap[status] || { label: status, tone: 'subdued' };
  return { children: config.label, tone: config.tone };
}

export function getReasonOptions(reasonMap) {
  return Object.values(reasonMap).map(r => ({
    value: r.value,
    label: r.label,
    helpText: r.description,
  }));
}

export function getSafetyConfirmationRequired(safetyLevel) {
  const config = SAFETY_LEVEL[safetyLevel];
  return config ? config.requiresConfirmation : true;
}

export default {
  ORDER_STATUS,
  LISTING_STATUS,
  ADJUSTMENT_REASON,
  ACTION_VERBS,
  SAFETY_LEVEL,
  BOM_STATUS,
  STOCK_LEVEL,
  SHIPPING_SERVICE,
  getStatusBadgeProps,
  getReasonOptions,
  getSafetyConfirmationRequired,
};
