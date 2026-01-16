import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { auditLog } from '../services/audit.js';

const router = express.Router();

// Password requirements
const PASSWORD_MIN_LENGTH = 8;
const SALT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 12;

// Account lockout settings
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

// In-memory store for failed login attempts (key: email, value: { attempts, lockedUntil })
// In production, consider using Redis for distributed environments
const failedAttempts = new Map();

/**
 * Check if an account is currently locked out
 * @param {string} email - The email to check
 * @returns {Object} - { locked: boolean, remainingMinutes: number }
 */
function checkAccountLockout(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const record = failedAttempts.get(normalizedEmail);

  if (!record || !record.lockedUntil) {
    return { locked: false, remainingMinutes: 0 };
  }

  const now = Date.now();
  if (now < record.lockedUntil) {
    const remainingMinutes = Math.ceil((record.lockedUntil - now) / (60 * 1000));
    return { locked: true, remainingMinutes };
  }

  // Lockout expired, reset attempts
  failedAttempts.delete(normalizedEmail);
  return { locked: false, remainingMinutes: 0 };
}

/**
 * Record a failed login attempt
 * @param {string} email - The email that failed login
 * @returns {Object} - { locked: boolean, attemptsRemaining: number }
 */
function recordFailedAttempt(email) {
  const normalizedEmail = email.toLowerCase().trim();
  let record = failedAttempts.get(normalizedEmail);

  if (!record) {
    record = { attempts: 0, lockedUntil: null };
  }

  record.attempts += 1;

  if (record.attempts >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + (LOCKOUT_DURATION_MINUTES * 60 * 1000);
    failedAttempts.set(normalizedEmail, record);
    return { locked: true, attemptsRemaining: 0 };
  }

  failedAttempts.set(normalizedEmail, record);
  return { locked: false, attemptsRemaining: MAX_FAILED_ATTEMPTS - record.attempts };
}

/**
 * Clear failed login attempts after successful login
 * @param {string} email - The email to clear
 */
function clearFailedAttempts(email) {
  const normalizedEmail = email.toLowerCase().trim();
  failedAttempts.delete(normalizedEmail);
}

/**
 * Validates password complexity requirements
 * @param {string} password - The password to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validatePasswordComplexity(password) {
  const errors = [];

  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * POST /auth/login
 * Authenticate with email and password
 * Returns a session token
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return errors.badRequest(res, 'Email and password are required');
  }

  // Check if account is locked out
  const lockoutStatus = checkAccountLockout(email);
  if (lockoutStatus.locked) {
    return errors.forbidden(res, `Account is temporarily locked. Try again in ${lockoutStatus.remainingMinutes} minutes.`);
  }

  try {
    // Find user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (userError) {
      console.error('User lookup error:', userError);
      return errors.internal(res, 'Authentication error');
    }

    if (!user) {
      // Don't reveal whether email exists
      return errors.unauthorized(res, 'Invalid email or password');
    }

    if (!user.is_active) {
      return errors.forbidden(res, 'Account is disabled');
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      const failureResult = recordFailedAttempt(email);
      if (failureResult.locked) {
        return errors.forbidden(res, `Account is now locked for ${LOCKOUT_DURATION_MINUTES} minutes due to too many failed attempts.`);
      }
      return errors.unauthorized(res, `Invalid email or password. ${failureResult.attemptsRemaining} attempts remaining.`);
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(email);

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

    // Create session
    const { error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        ip_address: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        user_agent: req.headers['user-agent'] || 'unknown'
      });

    if (sessionError) {
      console.error('Session creation error:', sessionError);
      return errors.internal(res, 'Failed to create session');
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    sendSuccess(res, {
      token,
      expires_at: expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return errors.internal(res, 'Authentication error');
  }
});

/**
 * POST /auth/logout
 * Invalidate current session
 */
router.post('/logout', async (req, res) => {
  const header = req.headers['authorization'];
  if (!header) {
    return sendSuccess(res, { message: 'Logged out' });
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return sendSuccess(res, { message: 'Logged out' });
  }

  const token = parts[1];
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    await supabase
      .from('sessions')
      .delete()
      .eq('token_hash', tokenHash);

    sendSuccess(res, { message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    // Still return success - user is effectively logged out
    sendSuccess(res, { message: 'Logged out' });
  }
});

/**
 * POST /auth/register
 * Create a new user account (ADMIN only in production, open for initial setup)
 */
router.post('/register', async (req, res) => {
  const { email, password, name, role = 'STAFF' } = req.body;

  if (!email || !password) {
    return errors.badRequest(res, 'Email and password are required');
  }

  // Validate password complexity
  const passwordValidation = validatePasswordComplexity(password);
  if (!passwordValidation.valid) {
    return errors.badRequest(res, passwordValidation.errors.join('. '));
  }

  if (!['ADMIN', 'STAFF'].includes(role)) {
    return errors.badRequest(res, 'Role must be ADMIN or STAFF');
  }

  try {
    // Check if this is the first user (allow ADMIN for initial setup)
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('User count error:', countError);
      return errors.internal(res, 'Registration error');
    }

    const isFirstUser = count === 0;
    let adminUser = null; // Track the admin who creates the user

    // If not first user, require authentication and ADMIN role
    if (!isFirstUser) {
      // Check for auth header
      const header = req.headers['authorization'];
      if (!header) {
        return errors.unauthorized(res, 'Only administrators can create new accounts');
      }

      const parts = header.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return errors.unauthorized(res, 'Invalid authorization header');
      }

      const token = parts[1];
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*, users(*)')
        .eq('token_hash', tokenHash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (sessionError || !session || !session.users || session.users.role !== 'ADMIN') {
        return errors.forbidden(res, 'Only administrators can create new accounts');
      }

      // Store the admin user info for audit logging
      adminUser = session.users;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        name: name || null,
        role: isFirstUser ? 'ADMIN' : role // First user is always ADMIN
      })
      .select('id, email, name, role, created_at')
      .single();

    if (createError) {
      if (createError.code === '23505') {
        return errors.conflict(res, 'A user with this email already exists');
      }
      console.error('User creation error:', createError);
      return errors.internal(res, 'Failed to create user');
    }

    // Log the creation - use admin's info as the actor, not the new user's
    await auditLog({
      entityType: 'USER',
      entityId: newUser.id,
      action: 'CREATE',
      afterJson: { email: newUser.email, name: newUser.name, role: newUser.role },
      actorType: isFirstUser ? 'SYSTEM' : 'USER',
      actorId: isFirstUser ? null : adminUser.id,
      actorDisplay: isFirstUser ? 'Initial Setup' : adminUser.email,
      correlationId: req.correlationId
    });

    sendSuccess(res, {
      user: newUser,
      message: isFirstUser ? 'Admin account created. You can now log in.' : 'User account created.'
    }, 201);
  } catch (err) {
    console.error('Registration error:', err);
    return errors.internal(res, 'Registration error');
  }
});

/**
 * GET /auth/me
 * Get current user info
 */
router.get('/me', async (req, res) => {
  const header = req.headers['authorization'];
  if (!header) {
    return errors.unauthorized(res, 'Not authenticated');
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return errors.unauthorized(res, 'Invalid authorization header');
  }

  const token = parts[1];
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
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

    if (!session || !session.users) {
      return errors.unauthorized(res, 'Invalid or expired session');
    }

    const user = session.users;
    sendSuccess(res, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      last_login_at: user.last_login_at
    });
  } catch (err) {
    console.error('Get user error:', err);
    return errors.internal(res, 'Authentication error');
  }
});

/**
 * POST /auth/change-password
 * Change password for authenticated user
 */
router.post('/change-password', async (req, res) => {
  const { current_password, new_password } = req.body;
  const header = req.headers['authorization'];

  if (!header) {
    return errors.unauthorized(res, 'Not authenticated');
  }

  if (!current_password || !new_password) {
    return errors.badRequest(res, 'Current password and new password are required');
  }

  // Validate new password complexity
  const passwordValidation = validatePasswordComplexity(new_password);
  if (!passwordValidation.valid) {
    return errors.badRequest(res, passwordValidation.errors.join('. '));
  }

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return errors.unauthorized(res, 'Invalid authorization header');
  }

  const token = parts[1];
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*, users(*)')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (sessionError || !session || !session.users) {
      return errors.unauthorized(res, 'Invalid or expired session');
    }

    const user = session.users;

    // Verify current password
    const passwordValid = await bcrypt.compare(current_password, user.password_hash);
    if (!passwordValid) {
      return errors.unauthorized(res, 'Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

    // Update password
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', user.id);

    if (updateError) {
      console.error('Password update error:', updateError);
      return errors.internal(res, 'Failed to update password');
    }

    // Invalidate all other sessions for this user
    await supabase
      .from('sessions')
      .delete()
      .eq('user_id', user.id)
      .neq('token_hash', tokenHash);

    await auditLog({
      entityType: 'USER',
      entityId: user.id,
      action: 'UPDATE',
      changesSummary: 'Password changed',
      actorType: 'USER',
      actorId: user.id,
      actorDisplay: user.email,
      correlationId: req.correlationId
    });

    sendSuccess(res, { message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return errors.internal(res, 'Failed to change password');
  }
});

export default router;
