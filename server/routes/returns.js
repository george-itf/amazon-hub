import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireAdmin, requireStaff } from '../middleware/auth.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import { auditLog, getAuditContext, recordSystemEvent } from '../services/audit.js';

const router = express.Router();

/**
 * GET /returns
 * Get all returns with optional status filter
 */
router.get('/', async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  try {
    let query = supabase
      .from('returns')
      .select(`
        *,
        orders (
          id,
          external_order_id
        ),
        return_lines (
          id,
          component_id,
          qty,
          condition,
          disposition,
          inspection_note,
          components (
            id,
            internal_sku,
            description
          )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    if (error) {
      console.error('Returns fetch error:', error);
      return errors.internal(res, 'Failed to fetch returns');
    }

    sendSuccess(res, {
      returns: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('Returns fetch error:', err);
    errors.internal(res, 'Failed to fetch returns');
  }
});

/**
 * GET /returns/:id
 * Get a single return with all details
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('returns')
      .select(`
        *,
        orders (
          id,
          external_order_id,
          customer_name,
          customer_email
        ),
        order_lines (
          id,
          asin,
          sku,
          title,
          quantity
        ),
        return_lines (
          id,
          component_id,
          qty,
          condition,
          disposition,
          inspection_note,
          components (
            id,
            internal_sku,
            description,
            brand
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return errors.notFound(res, 'Return');
      }
      console.error('Return fetch error:', error);
      return errors.internal(res, 'Failed to fetch return');
    }

    sendSuccess(res, data);
  } catch (err) {
    console.error('Return fetch error:', err);
    errors.internal(res, 'Failed to fetch return');
  }
});

/**
 * POST /returns
 * Create a new return
 * ADMIN only
 */
router.post('/', requireAdmin, async (req, res) => {
  const { order_id, order_line_id, channel = 'amazon', reason_code, customer_note, lines } = req.body;

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return errors.badRequest(res, 'Return lines are required');
  }

  // Validate lines
  for (const line of lines) {
    if (!line.component_id) {
      return errors.badRequest(res, 'Each line must have a component_id');
    }
    if (!line.qty || line.qty <= 0) {
      return errors.badRequest(res, 'Each line must have a positive qty');
    }
    if (!['NEW', 'OPENED', 'DAMAGED', 'FAULTY'].includes(line.condition)) {
      return errors.badRequest(res, 'Each line must have a valid condition (NEW, OPENED, DAMAGED, FAULTY)');
    }
  }

  try {
    // Create return
    const { data: returnRecord, error: returnError } = await supabase
      .from('returns')
      .insert({
        order_id: order_id || null,
        order_line_id: order_line_id || null,
        channel,
        reason_code,
        customer_note,
        status: 'RECEIVED',
        created_by_actor_type: req.actor.type,
        created_by_actor_id: req.actor.id,
        created_by_actor_display: req.actor.display
      })
      .select()
      .single();

    if (returnError) {
      console.error('Return create error:', returnError);
      return errors.internal(res, 'Failed to create return');
    }

    // Create return lines
    const { error: linesError } = await supabase
      .from('return_lines')
      .insert(lines.map(line => ({
        return_id: returnRecord.id,
        component_id: line.component_id,
        qty: line.qty,
        condition: line.condition,
        disposition: 'UNDECIDED',
        inspection_note: line.inspection_note || null
      })));

    if (linesError) {
      console.error('Return lines create error:', linesError);
      // Cleanup
      await supabase.from('returns').delete().eq('id', returnRecord.id);
      return errors.internal(res, 'Failed to create return lines');
    }

    await recordSystemEvent({
      eventType: 'RETURN_CREATED',
      entityType: 'RETURN',
      entityId: returnRecord.id,
      description: `Return #${returnRecord.return_number} created with ${lines.length} line(s)`,
      metadata: { order_id, line_count: lines.length }
    });

    // Fetch complete return
    const { data: completeReturn, error: fetchError } = await supabase
      .from('returns')
      .select(`
        *,
        return_lines (
          id,
          component_id,
          qty,
          condition,
          disposition,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('id', returnRecord.id)
      .single();

    sendSuccess(res, completeReturn || returnRecord, 201);
  } catch (err) {
    console.error('Return create error:', err);
    errors.internal(res, 'Failed to create return');
  }
});

/**
 * POST /returns/:id/inspect
 * Mark a return as inspected and set dispositions
 * ADMIN only
 */
router.post('/:id/inspect', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { line_dispositions, note } = req.body;

  if (!line_dispositions || !Array.isArray(line_dispositions)) {
    return errors.badRequest(res, 'line_dispositions array is required');
  }

  try {
    // Get current return
    const { data: returnRecord, error: fetchError } = await supabase
      .from('returns')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errors.notFound(res, 'Return');
      }
      console.error('Return fetch error:', fetchError);
      return errors.internal(res, 'Failed to fetch return');
    }

    if (returnRecord.status !== 'RECEIVED') {
      return errors.invalidStatus(res, 'Return must be in RECEIVED status to inspect', {
        current_status: returnRecord.status
      });
    }

    // Update each line's disposition
    for (const lineDisposition of line_dispositions) {
      if (!lineDisposition.line_id) {
        return errors.badRequest(res, 'Each disposition must have a line_id');
      }
      if (!['UNDECIDED', 'RESTOCK', 'REFURB', 'SCRAP', 'SUPPLIER_RETURN'].includes(lineDisposition.disposition)) {
        return errors.badRequest(res, 'Invalid disposition value');
      }

      const { error: updateError } = await supabase
        .from('return_lines')
        .update({
          disposition: lineDisposition.disposition,
          inspection_note: lineDisposition.inspection_note || null
        })
        .eq('id', lineDisposition.line_id)
        .eq('return_id', id);

      if (updateError) {
        console.error('Return line update error:', updateError);
        return errors.internal(res, 'Failed to update return line disposition');
      }
    }

    // Update return status to INSPECTED
    const { error: returnUpdateError } = await supabase
      .from('returns')
      .update({
        status: 'INSPECTED',
        inspected_at: new Date().toISOString(),
        inspected_by_actor_type: req.actor.type,
        inspected_by_actor_id: req.actor.id,
        inspected_by_actor_display: req.actor.display,
        note: note || null
      })
      .eq('id', id);

    if (returnUpdateError) {
      console.error('Return status update error:', returnUpdateError);
      return errors.internal(res, 'Failed to update return status');
    }

    await recordSystemEvent({
      eventType: 'RETURN_INSPECTED',
      entityType: 'RETURN',
      entityId: id,
      description: `Return inspected by ${req.actor.display}`
    });

    // Fetch updated return
    const { data: updatedReturn, error: refetchError } = await supabase
      .from('returns')
      .select(`
        *,
        return_lines (
          id,
          component_id,
          qty,
          condition,
          disposition,
          inspection_note,
          components (
            internal_sku,
            description
          )
        )
      `)
      .eq('id', id)
      .single();

    sendSuccess(res, updatedReturn);
  } catch (err) {
    console.error('Return inspect error:', err);
    errors.internal(res, 'Failed to inspect return');
  }
});

/**
 * POST /returns/:id/process
 * Process an inspected return (update stock based on dispositions)
 * ADMIN only, requires idempotency key
 */
router.post('/:id/process', requireAdmin, requireIdempotencyKey, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await supabase.rpc('rpc_return_process', {
      p_return_id: id,
      p_actor_type: req.actor.type,
      p_actor_id: req.actor.id,
      p_actor_display: req.actor.display
    });

    if (result.error) {
      console.error('Return process RPC error:', result.error);
      return errors.internal(res, 'Failed to process return');
    }

    const rpcResult = result.data;
    if (!rpcResult.ok) {
      if (rpcResult.error.code === 'RETURN_NOT_FOUND') {
        return errors.notFound(res, 'Return');
      }
      if (rpcResult.error.code === 'UNDECIDED_LINES') {
        return errors.badRequest(res, rpcResult.error.message);
      }
      return errors.invalidStatus(res, rpcResult.error.message, rpcResult.error.details);
    }

    await recordSystemEvent({
      eventType: 'RETURN_PROCESSED',
      entityType: 'RETURN',
      entityId: id,
      description: `Return processed by ${req.actor.display}`,
      metadata: rpcResult.data.processed_lines
    });

    sendSuccess(res, rpcResult.data);
  } catch (err) {
    console.error('Return process error:', err);
    errors.internal(res, 'Failed to process return');
  }
});

/**
 * GET /returns/quarantine
 * Get all returns that haven't been fully processed
 * (awaiting inspection or awaiting processing)
 */
router.get('/quarantine/summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('returns')
      .select(`
        id,
        return_number,
        status,
        created_at,
        channel,
        return_lines (
          id,
          qty,
          condition,
          disposition,
          components (
            internal_sku,
            description
          )
        )
      `)
      .in('status', ['RECEIVED', 'INSPECTED'])
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Quarantine fetch error:', error);
      return errors.internal(res, 'Failed to fetch quarantine');
    }

    const summary = {
      awaiting_inspection: data.filter(r => r.status === 'RECEIVED'),
      awaiting_processing: data.filter(r => r.status === 'INSPECTED'),
      total_items: data.reduce((sum, r) => sum + r.return_lines.reduce((ls, l) => ls + l.qty, 0), 0),
      warning: 'Returned stock does not increase sellable inventory until processed.'
    };

    sendSuccess(res, summary);
  } catch (err) {
    console.error('Quarantine fetch error:', err);
    errors.internal(res, 'Failed to fetch quarantine');
  }
});

export default router;
