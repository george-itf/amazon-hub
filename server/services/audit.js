import supabase from './supabase.js';

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
    const { error } = await supabase
      .from('audit_log')
      .insert({
        entity_type: entityType,
        entity_id: entityId?.toString(),
        action,
        before_json: beforeJson,
        after_json: afterJson,
        changes_summary: changesSummary,
        actor_type: actorType,
        actor_id: actorId?.toString(),
        actor_display: actorDisplay,
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
    const { error } = await supabase
      .from('system_events')
      .insert({
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId?.toString(),
        description,
        metadata,
        severity
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
  return {
    actorType: req.actor?.type || 'SYSTEM',
    actorId: req.actor?.id || null,
    actorDisplay: req.actor?.display || 'Unknown',
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    correlationId: req.correlationId
  };
}
