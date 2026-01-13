/**
 * Tests for identity normalization utilities
 */

import { normalizeAsin, normalizeSku, fingerprintTitle } from '../utils/identityNormalization.js';

describe('normalizeAsin', () => {
  test('converts to uppercase', () => {
    expect(normalizeAsin('b07wfzfp95')).toBe('B07WFZFP95');
  });

  test('trims whitespace', () => {
    expect(normalizeAsin('  B07WFZFP95  ')).toBe('B07WFZFP95');
  });

  test('handles mixed case', () => {
    expect(normalizeAsin('B07wFzFp95')).toBe('B07WFZFP95');
  });

  test('returns null for null input', () => {
    expect(normalizeAsin(null)).toBe(null);
  });

  test('returns null for undefined input', () => {
    expect(normalizeAsin(undefined)).toBe(null);
  });

  test('returns null for empty string', () => {
    expect(normalizeAsin('')).toBe(null);
  });
});

describe('normalizeSku', () => {
  test('converts to uppercase', () => {
    expect(normalizeSku('mak-dhp481-kit')).toBe('MAK-DHP481-KIT');
  });

  test('trims whitespace', () => {
    expect(normalizeSku('  MAK-DHP481  ')).toBe('MAK-DHP481');
  });

  test('handles special characters', () => {
    expect(normalizeSku('MAK_DHP481/KIT')).toBe('MAK_DHP481/KIT');
  });

  test('returns null for null input', () => {
    expect(normalizeSku(null)).toBe(null);
  });

  test('returns null for undefined input', () => {
    expect(normalizeSku(undefined)).toBe(null);
  });

  test('returns null for empty string', () => {
    expect(normalizeSku('')).toBe(null);
  });
});

describe('fingerprintTitle', () => {
  test('converts to lowercase', () => {
    const result = fingerprintTitle('MAKITA DHP481 Drill');
    expect(result).toBe('makita dhp481 drill');
  });

  test('removes special characters', () => {
    const result = fingerprintTitle('Makita DHP481RTJ - 18V LXT (Kit)');
    expect(result).toBe('makita dhp481rtj 18v lxt kit');
  });

  test('collapses multiple spaces', () => {
    const result = fingerprintTitle('Makita    DHP481     Kit');
    expect(result).toBe('makita dhp481 kit');
  });

  test('trims whitespace', () => {
    const result = fingerprintTitle('  Makita Drill  ');
    expect(result).toBe('makita drill');
  });

  test('handles unicode', () => {
    const result = fingerprintTitle('Makita – DHP481');
    expect(result).toBe('makita dhp481');
  });

  test('returns null for null input', () => {
    expect(fingerprintTitle(null)).toBe(null);
  });

  test('returns null for undefined input', () => {
    expect(fingerprintTitle(undefined)).toBe(null);
  });

  test('returns null for empty string', () => {
    expect(fingerprintTitle('')).toBe(null);
  });

  test('creates consistent fingerprints', () => {
    const title1 = 'Makita DHP481RTJ 18V LXT Brushless Combi Drill';
    const title2 = 'MAKITA DHP481RTJ - 18V LXT - Brushless Combi Drill';
    expect(fingerprintTitle(title1)).toBe(fingerprintTitle(title2));
  });

  test('different titles create different fingerprints', () => {
    const title1 = 'Makita DHP481 Body Only';
    const title2 = 'Makita DHP481 Kit with Batteries';
    expect(fingerprintTitle(title1)).not.toBe(fingerprintTitle(title2));
  });
});
