import crypto from 'crypto';
import supabase from '../services/supabase.js';
import { errors } from './correlationId.js';

/**
 * Authentication middleware
 * Validates session token from Authorization header or cookie
 * Attaches user and actor information to request
 */
export async function authMiddleware(req, res, next) {
  // Skip auth for auth endpoints
  if (req.path.startsWith('/auth') || req.path === '/' || req.path === '/health') {
    return next();
  }

  const header = req.headers['authorization'];
  if (!header) {
    return errors.unauthorized(res, 'Missing Authorization header');
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return errors.unauthorized(res, 'Invalid Authorization header format');
  }

  const token = parts[1];

  try {
    // Hash the token to look up in sessions table
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Look up session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*, users(*)')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (sessionError) {
      console.error('Session lookup error:', sessionError);
      return errors.internal(res, 'Authentication error');
    }

    if (!session) {
      return errors.unauthorized(res, 'Invalid or expired session');
    }

    if (!session.users) {
      return errors.unauthorized(res, 'User not found');
    }

    if (!session.users.is_active) {
      return errors.forbidden(res, 'Account is disabled');
    }

    // Attach user and actor info to request
    req.user = session.users;
    req.session = session;
    req.actor = {
      type: 'USER',
      id: session.users.id,
      display: session.users.email
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return errors.internal(res, 'Authentication error');
  }
}

/**
 * Role authorization middleware factory
 * Creates middleware that requires specific roles
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return errors.unauthorized(res, 'Not authenticated');
    }

    if (!allowedRoles.includes(req.user.role)) {
      return errors.forbidden(res, `This action requires one of the following roles: ${allowedRoles.join(', ')}`);
    }

    next();
  };
}

/**
 * Require ADMIN role
 */
export const requireAdmin = requireRole('ADMIN');

/**
 * Require at least STAFF role (both STAFF and ADMIN pass)
 */
export const requireStaff = requireRole('ADMIN', 'STAFF');
