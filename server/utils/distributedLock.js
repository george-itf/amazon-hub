/**
 * Distributed Lock Utility
 * Uses PostgreSQL advisory locks via Supabase for distributed locking
 * Prevents race conditions in concurrent operations
 */
import supabase from '../services/supabase.js';
import crypto from 'crypto';

// Track locally held locks to prevent releasing locks we don't own
const localLocks = new Map();

/**
 * Generate a consistent numeric hash from a lock name
 * PostgreSQL advisory locks require bigint keys
 */
function hashLockName(lockName) {
  const hash = crypto.createHash('sha256').update(lockName).digest('hex');
  // Take first 15 hex chars and convert to bigint (fits in PostgreSQL bigint)
  return BigInt('0x' + hash.substring(0, 15));
}

/**
 * Acquire a distributed lock
 * @param {string} lockName - Unique name for the lock
 * @param {number} timeoutMs - Maximum time to hold lock (default 5 minutes)
 * @returns {Promise<boolean>} - True if lock acquired, false if already held
 */
export async function acquireDistributedLock(lockName, timeoutMs = 300000) {
  const lockKey = hashLockName(lockName);
  const lockId = crypto.randomUUID();

  try {
    // First check if lock exists in our table-based lock system
    const { data: existingLock, error: checkError } = await supabase
      .from('distributed_locks')
      .select('*')
      .eq('lock_name', lockName)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Lock check error:', checkError);
      return false;
    }

    // If lock exists and hasn't expired, fail to acquire
    if (existingLock) {
      const expiresAt = new Date(existingLock.expires_at);
      if (expiresAt > new Date()) {
        console.log(`[Lock] ${lockName} is held by another process until ${expiresAt.toISOString()}`);
        return false;
      }

      // Lock expired, delete it first
      await supabase
        .from('distributed_locks')
        .delete()
        .eq('lock_name', lockName);
    }

    // Try to acquire the lock
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
    const { error: insertError } = await supabase
      .from('distributed_locks')
      .insert({
        lock_name: lockName,
        lock_id: lockId,
        acquired_at: new Date().toISOString(),
        expires_at: expiresAt,
      });

    if (insertError) {
      // Unique constraint violation means another process got the lock
      if (insertError.code === '23505') {
        console.log(`[Lock] ${lockName} was acquired by another process`);
        return false;
      }
      console.error('Lock acquire error:', insertError);
      return false;
    }

    // Successfully acquired
    localLocks.set(lockName, lockId);
    console.log(`[Lock] Acquired ${lockName} (expires: ${expiresAt})`);
    return true;
  } catch (err) {
    console.error('Distributed lock error:', err);
    return false;
  }
}

/**
 * Release a distributed lock
 * @param {string} lockName - Name of the lock to release
 * @returns {Promise<boolean>} - True if released, false otherwise
 */
export async function releaseDistributedLock(lockName) {
  const localLockId = localLocks.get(lockName);

  if (!localLockId) {
    console.warn(`[Lock] Attempted to release ${lockName} but we don't hold it locally`);
    return false;
  }

  try {
    const { error } = await supabase
      .from('distributed_locks')
      .delete()
      .eq('lock_name', lockName)
      .eq('lock_id', localLockId);

    if (error) {
      console.error('Lock release error:', error);
      return false;
    }

    localLocks.delete(lockName);
    console.log(`[Lock] Released ${lockName}`);
    return true;
  } catch (err) {
    console.error('Distributed lock release error:', err);
    return false;
  }
}

/**
 * Check if a lock is held (by anyone)
 * @param {string} lockName - Name of the lock
 * @returns {Promise<boolean>} - True if lock is held
 */
export async function isLockHeld(lockName) {
  try {
    const { data, error } = await supabase
      .from('distributed_locks')
      .select('expires_at')
      .eq('lock_name', lockName)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Lock check error:', error);
      return false;
    }

    if (!data) return false;

    const expiresAt = new Date(data.expires_at);
    return expiresAt > new Date();
  } catch (err) {
    console.error('Lock check error:', err);
    return false;
  }
}

/**
 * Clean up expired locks (run periodically)
 * @returns {Promise<number>} - Number of expired locks cleaned
 */
export async function cleanupExpiredLocks() {
  try {
    const { data, error } = await supabase
      .from('distributed_locks')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select();

    if (error) {
      console.error('Lock cleanup error:', error);
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(`[Lock] Cleaned up ${count} expired locks`);
    }
    return count;
  } catch (err) {
    console.error('Lock cleanup error:', err);
    return 0;
  }
}
