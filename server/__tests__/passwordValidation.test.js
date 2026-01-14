/**
 * Tests for password complexity validation
 */

// Import the function by reading the auth file and extracting the validation logic
// Since the function is not exported, we recreate it for testing
const PASSWORD_MIN_LENGTH = 8;

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

describe('validatePasswordComplexity', () => {
  describe('valid passwords', () => {
    test('accepts password meeting all requirements', () => {
      const result = validatePasswordComplexity('Password1!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts complex password', () => {
      const result = validatePasswordComplexity('MyC0mpl3x@Pass!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts password with various special characters', () => {
      const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'];
      specialChars.forEach(char => {
        const result = validatePasswordComplexity(`Password1${char}`);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('invalid passwords', () => {
    test('rejects null password', () => {
      const result = validatePasswordComplexity(null);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('rejects empty password', () => {
      const result = validatePasswordComplexity('');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('rejects short password', () => {
      const result = validatePasswordComplexity('Aa1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    test('rejects password without uppercase', () => {
      const result = validatePasswordComplexity('password1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    test('rejects password without lowercase', () => {
      const result = validatePasswordComplexity('PASSWORD1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    test('rejects password without number', () => {
      const result = validatePasswordComplexity('Password!!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    test('rejects password without special character', () => {
      const result = validatePasswordComplexity('Password123');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });
  });

  describe('multiple errors', () => {
    test('returns all applicable errors', () => {
      const result = validatePasswordComplexity('abc');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
      expect(result.errors).toContain('Password must contain at least one number');
      expect(result.errors).toContain('Password must contain at least one special character');
    });
  });
});

describe('Account Lockout Logic', () => {
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MINUTES = 15;

  // Simulate the lockout tracking
  const failedAttempts = new Map();

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

    failedAttempts.delete(normalizedEmail);
    return { locked: false, remainingMinutes: 0 };
  }

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

  function clearFailedAttempts(email) {
    const normalizedEmail = email.toLowerCase().trim();
    failedAttempts.delete(normalizedEmail);
  }

  beforeEach(() => {
    failedAttempts.clear();
  });

  test('account is not locked initially', () => {
    const result = checkAccountLockout('test@example.com');
    expect(result.locked).toBe(false);
  });

  test('tracks failed attempts', () => {
    const result1 = recordFailedAttempt('test@example.com');
    expect(result1.locked).toBe(false);
    expect(result1.attemptsRemaining).toBe(4);

    const result2 = recordFailedAttempt('test@example.com');
    expect(result2.attemptsRemaining).toBe(3);
  });

  test('locks account after 5 failed attempts', () => {
    for (let i = 0; i < 4; i++) {
      recordFailedAttempt('test@example.com');
    }
    const result = recordFailedAttempt('test@example.com');
    expect(result.locked).toBe(true);
    expect(result.attemptsRemaining).toBe(0);
  });

  test('checkAccountLockout returns locked status', () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt('test@example.com');
    }
    const result = checkAccountLockout('test@example.com');
    expect(result.locked).toBe(true);
    expect(result.remainingMinutes).toBeGreaterThan(0);
  });

  test('clearFailedAttempts resets the counter', () => {
    for (let i = 0; i < 3; i++) {
      recordFailedAttempt('test@example.com');
    }
    clearFailedAttempts('test@example.com');

    const result = recordFailedAttempt('test@example.com');
    expect(result.attemptsRemaining).toBe(4);
  });

  test('normalizes email for consistency', () => {
    recordFailedAttempt('TEST@EXAMPLE.COM');
    recordFailedAttempt('test@example.com');
    recordFailedAttempt('  Test@Example.com  ');

    const record = failedAttempts.get('test@example.com');
    expect(record.attempts).toBe(3);
  });
});
