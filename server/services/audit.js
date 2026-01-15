import supabase from './supabase.js';

// Valid entity types for audit logging
const VALID_ENTITY_TYPES = new Set([
  'COMPONENT', 'BOM', 'LISTING', 'ORDER', 'ORDER_LINE', 'PICK_BATCH',
  'RETURN', 'REVIEW_ITEM', 'USER', 'SETTING', 'STOCK', 'SYSTEM'
]);

// Valid action types for audit logging
const VALID_ACTIONS = new Set([
  'CREATE', 'UPDATE', 'DELETE', 'RESOLVE', 'SKIP', 'CANCEL',
  'RESERVE', 'CONFIRM', 'RECEIVE', 'ADJUST', 'IMPORT', 'EXPORT',
  'LOGIN', 'LOGOUT', 'SUPERSEDE', 'REQUEUE'
]);

// Valid actor types
const VALID_ACTOR_TYPES = new Set(['USER', 'SYSTEM', 'API', 'WEBHOOK']);

// Maximum JSON size (1MB)
const MAX_JSON_SIZE = 1024 * 1024;

/**
 * Writes an entry to the audit log
 * Used for tracking configuration changes (BOM edits, memory changes, etc.)
 */
export async function auditLog({
  entityType,
  entityId,
  action,
  beforeJson = null,
  afterJson = null,
  changesSummary = null,
  actorType,
  actorId = null,
  actorDisplay = null,
  ipAddress = null,
  correlationId = null
}) {
  try {
    // Validate entity type
    const normalizedEntityType = entityType?.toUpperCase();
    if (!normalizedEntityType || !VALID_ENTITY_TYPES.has(normalizedEntityType)) {
      console.warn(`Invalid entity type: ${entityType}, using 'SYSTEM'`);
    }

    // Validate action
    const normalizedAction = action?.toUpperCase();
    if (!normalizedAction || !VALID_ACTIONS.has(normalizedAction)) {
      console.warn(`Invalid action: ${action}`);
    }

    // Validate actor type
    const normalizedActorType = actorType?.toUpperCase() || 'SYSTEM';
    if (!VALID_ACTOR_TYPES.has(normalizedActorType)) {
      console.warn(`Invalid actor type: ${actorType}, using 'SYSTEM'`);
    }

    // Validate JSON sizes to prevent memory issues
    const beforeJsonStr = beforeJson ? JSON.stringify(beforeJson) : null;
    const afterJsonStr = afterJson ? JSON.stringify(afterJson) : null;

    if (beforeJsonStr && beforeJsonStr.length > MAX_JSON_SIZE) {
      console.warn('beforeJson exceeds maximum size, truncating');
      beforeJson = { _truncated: true, _message: 'Data too large to store' };
    }
    if (afterJsonStr && afterJsonStr.length > MAX_JSON_SIZE) {
      console.warn('afterJson exceeds maximum size, truncating');
      afterJson = { _truncated: true, _message: 'Data too large to store' };
    }

    const { error } = await supabase
      .from('audit_log')
      .insert({
        entity_type: normalizedEntityType || 'SYSTEM',
        entity_id: entityId != null ? String(entityId) : null,
        action: normalizedAction || action,
        before_json: beforeJson,
        after_json: afterJson,
        changes_summary: changesSummary,
        actor_type: normalizedActorType,
        actor_id: actorId != null ? String(actorId) : null,
        actor_display: actorDisplay || 'Unknown',
        ip_address: ipAddress,
        correlation_id: correlationId
      });

    if (error) {
      console.error('Audit log error:', error);
      // Don't throw - audit logging failures shouldn't break the main operation
    }
  } catch (err) {
    console.error('Audit log exception:', err);
  }
}

// Valid severity levels
const VALID_SEVERITIES = new Set(['INFO', 'WARN', 'ERROR', 'CRITICAL']);

/**
 * Records a system event for the audit timeline
 */
export async function recordSystemEvent({
  eventType,
  entityType = null,
  entityId = null,
  description,
  metadata = null,
  severity = 'INFO'
}) {
  try {
    // Validate severity
    const normalizedSeverity = severity?.toUpperCase() || 'INFO';
    if (!VALID_SEVERITIES.has(normalizedSeverity)) {
      console.warn(`Invalid severity: ${severity}, using 'INFO'`);
    }

    // Validate metadata size
    if (metadata) {
      const metadataStr = JSON.stringify(metadata);
      if (metadataStr.length > MAX_JSON_SIZE) {
        console.warn('Metadata exceeds maximum size, truncating');
        metadata = { _truncated: true, _message: 'Metadata too large to store' };
      }
    }

    const { error } = await supabase
      .from('system_events')
      .insert({
        event_type: eventType,
        entity_type: entityType?.toUpperCase() || null,
        entity_id: entityId != null ? String(entityId) : null,
        description,
        metadata,
        severity: VALID_SEVERITIES.has(normalizedSeverity) ? normalizedSeverity : 'INFO'
      });

    if (error) {
      console.error('System event log error:', error);
    }
  } catch (err) {
    console.error('System event log exception:', err);
  }
}

/**
 * Helper to create audit context from request
 */
export function getAuditContext(req) {
  if (!req) {
    return {
      actorType: 'SYSTEM',
      actorId: null,
      actorDisplay: 'System',
      ipAddress: null,
      correlationId: null
    };
  }

  // Parse x-forwarded-for properly (could be comma-separated list)
  let ipAddress = req.ip;
  if (!ipAddress && req.headers?.['x-forwarded-for']) {
    const forwardedFor = req.headers['x-forwarded-for'];
    // Take the first IP (original client) from the chain
    ipAddress = forwardedFor.split(',')[0].trim();
  }

  return {
    actorType: req.actor?.type || 'SYSTEM',
    actorId: req.actor?.id || null,
    actorDisplay: req.actor?.display || 'System',
    ipAddress: ipAddress || null,
    correlationId: req.correlationId || null
  };
}
