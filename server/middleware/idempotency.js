import crypto from 'crypto';
import supabase from '../services/supabase.js';
import { errors } from './correlationId.js';

/**
 * Idempotency middleware factory
 * Ensures that requests with the same idempotency key are not processed twice
 * Required for irreversible actions like stock changes
 */
export function idempotencyMiddleware() {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['idempotency-key'];

    // If no idempotency key provided, skip this middleware
    if (!idempotencyKey) {
      return next();
    }

    try {
      // Hash the request body for comparison
      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(req.body || {}))
        .digest('hex');

      // Check if this key was already used
      const { data: existing, error: lookupError } = await supabase
        .from('idempotency_keys')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (lookupError) {
        console.error('Idempotency lookup error:', lookupError);
        return errors.internal(res, 'Idempotency check failed');
      }

      if (existing) {
        // Key exists - check if request matches
        if (existing.request_hash !== requestHash) {
          return errors.badRequest(res,
            'Idempotency key reused with different request body',
            { idempotency_key: idempotencyKey }
          );
        }

        // Same request - return cached response
        if (existing.response_body) {
          return res.status(existing.response_status || 200).json(existing.response_body);
        }

        // Request is still processing (shouldn't happen normally)
        return errors.conflict(res, 'Request with this idempotency key is still being processed');
      }

      // Store the idempotency key before processing
      const { error: insertError } = await supabase
        .from('idempotency_keys')
        .insert({
          idempotency_key: idempotencyKey,
          endpoint: req.path,
          request_hash: requestHash,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      if (insertError) {
        // Unique constraint violation means concurrent request
        if (insertError.code === '23505') {
          return errors.conflict(res, 'Concurrent request with same idempotency key');
        }
        console.error('Idempotency insert error:', insertError);
        return errors.internal(res, 'Idempotency check failed');
      }

      // Attach key info to request for later storage of response
      req.idempotencyKey = idempotencyKey;

      // Intercept response to store it
      const originalJson = res.json.bind(res);
      res.json = async (body) => {
        // Store the response
        try {
          await supabase
            .from('idempotency_keys')
            .update({
              response_status: res.statusCode,
              response_body: body
            })
            .eq('idempotency_key', idempotencyKey);
        } catch (err) {
          console.error('Failed to store idempotency response:', err);
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      console.error('Idempotency middleware error:', err);
      return errors.internal(res, 'Idempotency check failed');
    }
  };
}

/**
 * Require idempotency key middleware
 * For endpoints that mandate idempotency keys
 */
export function requireIdempotencyKey(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return errors.badRequest(res,
      'Idempotency-Key header is required for this operation',
      { hint: 'Provide a unique Idempotency-Key header to prevent duplicate operations' }
    );
  }

  next();
}
