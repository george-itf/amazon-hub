import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /audit/timeline
 * Get unified audit timeline combining system events, stock movements, etc.
 *
 * Query params:
 * - limit: Max records per source (default: 100)
 * - offset: Pagination offset (default: 0)
 * - entity_type: Filter by entity type (e.g., ORDER, COMPONENT, LISTING_MEMORY)
 * - entity_id: Filter by specific entity ID
 * - since: ISO date string for start of date range
 * - until: ISO date string for end of date range
 * - action: Filter by action type (e.g., CREATE, UPDATE, DELETE)
 * - actor_id: Filter by user/actor ID
 * - actor_display: Filter by actor display name (partial match)
 * - correlation_id: Filter by correlation ID for related events
 */
router.get('/timeline', requireStaff, async (req, res) => {
  const {
    limit = 100,
    offset = 0,
    entity_type,
    entity_id,
    since,
    until,
    action,
    actor_id,
    actor_display,
    correlation_id
  } = req.query;

  try {
    // Fetch from multiple sources and merge
    const queries = [];

    // System events
    let systemEventsQuery = supabase
      .from('system_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (since) systemEventsQuery = systemEventsQuery.gte('created_at', since);
    if (until) systemEventsQuery = systemEventsQuery.lte('created_at', until);
    if (entity_type) systemEventsQuery = systemEventsQuery.eq('entity_type', entity_type);
    if (entity_id) systemEventsQuery = systemEventsQuery.eq('entity_id', entity_id);
    if (action) systemEventsQuery = systemEventsQuery.eq('event_type', action.toUpperCase());

    queries.push(systemEventsQuery.then(r => ({
      source: 'SYSTEM_EVENT',
      data: r.data || [],
      error: r.error
    })));

    // Stock movements
    let stockMovementsQuery = supabase
      .from('stock_movements')
      .select(`
        *,
        components (
          internal_sku,
          description
        )
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (since) stockMovementsQuery = stockMovementsQuery.gte('created_at', since);
    if (until) stockMovementsQuery = stockMovementsQuery.lte('created_at', until);
    if (action) stockMovementsQuery = stockMovementsQuery.eq('reason', action.toUpperCase());
    if (actor_id) stockMovementsQuery = stockMovementsQuery.eq('actor_id', actor_id);
    if (actor_display) stockMovementsQuery = stockMovementsQuery.ilike('actor_display', `%${actor_display}%`);
    // Filter by component_id if entity_type is COMPONENT
    if (entity_type === 'COMPONENT' && entity_id) {
      stockMovementsQuery = stockMovementsQuery.eq('component_id', entity_id);
    }

    queries.push(stockMovementsQuery.then(r => ({
      source: 'STOCK_MOVEMENT',
      data: r.data || [],
      error: r.error
    })));

    // Audit log entries
    let auditLogQuery = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (since) auditLogQuery = auditLogQuery.gte('created_at', since);
    if (until) auditLogQuery = auditLogQuery.lte('created_at', until);
    if (entity_type) auditLogQuery = auditLogQuery.eq('entity_type', entity_type);
    if (entity_id) auditLogQuery = auditLogQuery.eq('entity_id', entity_id);
    if (action) auditLogQuery = auditLogQuery.eq('action', action.toUpperCase());
    if (actor_id) auditLogQuery = auditLogQuery.eq('actor_id', actor_id);
    if (actor_display) auditLogQuery = auditLogQuery.ilike('actor_display', `%${actor_display}%`);
    if (correlation_id) auditLogQuery = auditLogQuery.eq('correlation_id', correlation_id);

    queries.push(auditLogQuery.then(r => ({
      source: 'AUDIT_LOG',
      data: r.data || [],
      error: r.error
    })));

    // Execute all queries in parallel
    const results = await Promise.all(queries);

    // Check for errors
    for (const result of results) {
      if (result.error) {
        console.error(`Timeline query error (${result.source}):`, result.error);
      }
    }

    // Merge and normalize events
    const events = [];

    // System events
    for (const event of results[0].data) {
      events.push({
        id: event.id,
        type: 'SYSTEM_EVENT',
        subtype: event.event_type,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        description: event.description,
        severity: event.severity,
        metadata: event.metadata,
        created_at: event.created_at,
        actor_type: 'SYSTEM',
        actor_display: 'System'
      });
    }

    // Stock movements
    for (const movement of results[1].data) {
      const delta = movement.on_hand_delta !== 0 ? movement.on_hand_delta : movement.reserved_delta;
      const description = `${movement.reason}: ${delta > 0 ? '+' : ''}${delta} ${movement.components?.internal_sku || 'unknown'} at ${movement.location}`;

      events.push({
        id: movement.id,
        type: 'STOCK_MOVEMENT',
        subtype: movement.reason,
        entity_type: 'COMPONENT',
        entity_id: movement.component_id,
        description,
        severity: 'INFO',
        metadata: {
          component_sku: movement.components?.internal_sku,
          location: movement.location,
          on_hand_delta: movement.on_hand_delta,
          reserved_delta: movement.reserved_delta,
          reference_type: movement.reference_type,
          reference_id: movement.reference_id,
          note: movement.note
        },
        created_at: movement.created_at,
        actor_type: movement.actor_type,
        actor_id: movement.actor_id,
        actor_display: movement.actor_display
      });
    }

    // Audit log entries
    for (const entry of results[2].data) {
      events.push({
        id: entry.id,
        type: 'AUDIT_LOG',
        subtype: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        description: entry.changes_summary || `${entry.action} ${entry.entity_type}`,
        severity: 'INFO',
        metadata: {
          before: entry.before_json,
          after: entry.after_json
        },
        created_at: entry.created_at,
        actor_type: entry.actor_type,
        actor_id: entry.actor_id,
        actor_display: entry.actor_display,
        correlation_id: entry.correlation_id
      });
    }

    // Sort by created_at descending
    events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Apply pagination
    const paginatedEvents = events.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    sendSuccess(res, {
      events: paginatedEvents,
      total: events.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Timeline error:', err);
    return errors.internal(res, 'Failed to fetch timeline');
  }
});

/**
 * GET /audit/timeline/market-context
 * Get Keepa price change events for timeline overlay
 */
router.get('/timeline/market-context', requireStaff, async (req, res) => {
  const { asin, since, until } = req.query;

  try {
    let query = supabase
      .from('keepa_metrics_daily')
      .select('*')
      .order('date', { ascending: false })
      .limit(90);

    if (asin) query = query.eq('asin', asin.toUpperCase());
    if (since) query = query.gte('date', since);
    if (until) query = query.lte('date', until);

    const { data, error } = await query;

    if (error) {
      console.error('Market context error:', error);
      return errors.internal(res, 'Failed to fetch market context');
    }

    // Detect significant price changes
    const contextEvents = [];
    const metricsByAsin = {};

    for (const metric of data || []) {
      if (!metricsByAsin[metric.asin]) {
        metricsByAsin[metric.asin] = [];
      }
      metricsByAsin[metric.asin].push(metric);
    }

    for (const [asinKey, metrics] of Object.entries(metricsByAsin)) {
      metrics.sort((a, b) => new Date(a.date) - new Date(b.date));

      for (let i = 1; i < metrics.length; i++) {
        const prev = metrics[i - 1];
        const curr = metrics[i];

        // Detect buy box price change > 10%
        if (prev.buybox_price_pence && curr.buybox_price_pence) {
          const changePercent = ((curr.buybox_price_pence - prev.buybox_price_pence) / prev.buybox_price_pence) * 100;
          if (Math.abs(changePercent) > 10) {
            contextEvents.push({
              type: 'MARKET_CONTEXT',
              subtype: changePercent > 0 ? 'PRICE_INCREASE' : 'PRICE_DECREASE',
              asin: asinKey,
              date: curr.date,
              description: `Buy box price ${changePercent > 0 ? 'increased' : 'decreased'} by ${Math.abs(changePercent).toFixed(1)}%`,
              metadata: {
                previous_price_pence: prev.buybox_price_pence,
                current_price_pence: curr.buybox_price_pence,
                change_percent: changePercent.toFixed(1)
              }
            });
          }
        }

        // Detect significant offer count changes
        if (prev.offer_count && curr.offer_count) {
          const change = curr.offer_count - prev.offer_count;
          if (Math.abs(change) >= 5) {
            contextEvents.push({
              type: 'MARKET_CONTEXT',
              subtype: change > 0 ? 'OFFERS_INCREASED' : 'OFFERS_DECREASED',
              asin: asinKey,
              date: curr.date,
              description: `Offer count ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(change)}`,
              metadata: {
                previous_count: prev.offer_count,
                current_count: curr.offer_count,
                change
              }
            });
          }
        }
      }
    }

    sendSuccess(res, {
      events: contextEvents.sort((a, b) => new Date(b.date) - new Date(a.date))
    });
  } catch (err) {
    console.error('Market context error:', err);
    return errors.internal(res, 'Failed to fetch market context');
  }
});

/**
 * GET /audit/entity/:type/:id
 * Get audit history for a specific entity
 */
router.get('/entity/:type/:id', requireStaff, async (req, res) => {
  const { type, id } = req.params;
  const { limit = 50 } = req.query;

  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .eq('entity_type', type.toUpperCase())
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      console.error('Entity audit error:', error);
      return errors.internal(res, 'Failed to fetch entity audit history');
    }

    sendSuccess(res, {
      entity_type: type.toUpperCase(),
      entity_id: id,
      history: data || []
    });
  } catch (err) {
    console.error('Entity audit error:', err);
    return errors.internal(res, 'Failed to fetch entity audit history');
  }
});

/**
 * GET /audit/activity
 * Get recent activity by user
 */
router.get('/activity', requireStaff, async (req, res) => {
  const { user_id, limit = 50 } = req.query;

  try {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (user_id) {
      query = query.eq('actor_id', user_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Activity error:', error);
      return errors.internal(res, 'Failed to fetch activity');
    }

    sendSuccess(res, data || []);
  } catch (err) {
    console.error('Activity error:', err);
    return errors.internal(res, 'Failed to fetch activity');
  }
});

/**
 * GET /audit/actors
 * Get unique actors from audit log for filter dropdown
 */
router.get('/actors', requireStaff, async (req, res) => {
  try {
    // Get distinct actors from audit_log
    const { data, error } = await supabase
      .from('audit_log')
      .select('actor_id, actor_type, actor_display')
      .not('actor_id', 'is', null)
      .order('actor_display', { ascending: true });

    if (error) {
      console.error('Actors fetch error:', error);
      return errors.internal(res, 'Failed to fetch actors');
    }

    // Deduplicate by actor_id
    const actorsMap = new Map();
    for (const row of data || []) {
      if (row.actor_id && !actorsMap.has(row.actor_id)) {
        actorsMap.set(row.actor_id, {
          actor_id: row.actor_id,
          actor_type: row.actor_type || 'USER',
          actor_display: row.actor_display || row.actor_id,
        });
      }
    }

    const actors = Array.from(actorsMap.values()).sort((a, b) =>
      (a.actor_display || '').localeCompare(b.actor_display || '')
    );

    sendSuccess(res, { actors });
  } catch (err) {
    console.error('Actors error:', err);
    return errors.internal(res, 'Failed to fetch actors');
  }
});

/**
 * GET /audit/correlation/:id
 * Get all events with a specific correlation ID
 */
router.get('/correlation/:id', requireStaff, async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .eq('correlation_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Correlation fetch error:', error);
      return errors.internal(res, 'Failed to fetch correlated events');
    }

    sendSuccess(res, {
      correlation_id: id,
      events: data || [],
      count: (data || []).length,
    });
  } catch (err) {
    console.error('Correlation error:', err);
    return errors.internal(res, 'Failed to fetch correlated events');
  }
});

/**
 * GET /audit/export
 * Export audit log as CSV
 */
router.get('/export', requireStaff, async (req, res) => {
  const {
    entity_type,
    entity_id,
    since,
    until,
    action,
    actor_id,
    correlation_id,
    limit = 10000,
  } = req.query;

  try {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (since) query = query.gte('created_at', since);
    if (until) query = query.lte('created_at', until);
    if (entity_type) query = query.eq('entity_type', entity_type);
    if (entity_id) query = query.eq('entity_id', entity_id);
    if (action) query = query.eq('action', action.toUpperCase());
    if (actor_id) query = query.eq('actor_id', actor_id);
    if (correlation_id) query = query.eq('correlation_id', correlation_id);

    const { data, error } = await query;

    if (error) {
      console.error('Export error:', error);
      return errors.internal(res, 'Failed to export audit log');
    }

    // Convert to CSV
    const rows = data || [];
    if (rows.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit_log_export.csv"');
      return res.send('No data to export');
    }

    const headers = [
      'id',
      'created_at',
      'entity_type',
      'entity_id',
      'action',
      'changes_summary',
      'actor_type',
      'actor_id',
      'actor_display',
      'correlation_id',
    ];

    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((h) => escapeCSV(row[h])).join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_log_export_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvRows.join('\n'));
  } catch (err) {
    console.error('Export error:', err);
    return errors.internal(res, 'Failed to export audit log');
  }
});

export default router;
