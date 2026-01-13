/**
 * Tests for the deterministic title parser
 */

import { parseTitle, compareIntents, suggestComponents } from '../utils/deterministicParser.js';

describe('parseTitle', () => {
  describe('battery detection', () => {
    test('detects 2x battery pattern', () => {
      const result = parseTitle('Makita DHP481RTJ 18V LXT Brushless Combi Drill with 2x 5.0Ah Batteries');
      expect(result.battery_qty).toBe(2);
      expect(result.detected_tokens).toContain('BATTERY_2');
    });

    test('detects "with X batteries" pattern', () => {
      const result = parseTitle('DeWalt Hammer Drill with 2 Batteries');
      expect(result.battery_qty).toBe(2);
    });

    test('detects dual battery pattern', () => {
      const result = parseTitle('Milwaukee M18 FPD2 Dual Battery Kit');
      expect(result.battery_qty).toBe(2);
    });

    test('returns null when no battery info', () => {
      const result = parseTitle('Makita Angle Grinder 115mm');
      expect(result.battery_qty).toBe(null);
    });
  });

  describe('bare tool detection', () => {
    test('detects "body only"', () => {
      const result = parseTitle('Makita DHP481Z 18V LXT Combi Drill Body Only');
      expect(result.bare_tool).toBe(true);
      expect(result.battery_qty).toBe(0);
      expect(result.charger_included).toBe(false);
    });

    test('detects "bare tool"', () => {
      const result = parseTitle('DeWalt DCD996 Bare Tool - No Batteries');
      expect(result.bare_tool).toBe(true);
    });

    test('detects "unit only"', () => {
      const result = parseTitle('Milwaukee Impact Driver Unit Only');
      expect(result.bare_tool).toBe(true);
    });
  });

  describe('charger detection', () => {
    test('detects "with charger"', () => {
      const result = parseTitle('Makita Kit with Charger and Case');
      expect(result.charger_included).toBe(true);
    });

    test('detects "charger included"', () => {
      const result = parseTitle('DeWalt Kit - Charger Included');
      expect(result.charger_included).toBe(true);
    });

    test('detects no charger for body only', () => {
      const result = parseTitle('Makita Drill Body Only');
      expect(result.charger_included).toBe(false);
    });
  });

  describe('case detection', () => {
    test('detects "with case"', () => {
      const result = parseTitle('Makita Kit with Case');
      expect(result.case_included).toBe(true);
    });

    test('detects "carry case"', () => {
      const result = parseTitle('DeWalt Drill Kit inc Carry Case');
      expect(result.case_included).toBe(true);
    });

    test('detects MakPac', () => {
      const result = parseTitle('Makita DHP481RTJ in MakPac');
      expect(result.case_included).toBe(true);
    });

    test('detects TSTAK', () => {
      const result = parseTitle('DeWalt Kit in TSTAK');
      expect(result.case_included).toBe(true);
    });
  });

  describe('kit detection', () => {
    test('detects "kit" keyword', () => {
      const result = parseTitle('Makita 18V LXT Combi Kit');
      expect(result.kit).toBe(true);
    });

    test('detects "twin kit"', () => {
      const result = parseTitle('DeWalt Twin Kit');
      expect(result.kit).toBe(true);
    });

    test('bare tool should not be kit', () => {
      const result = parseTitle('Makita Body Only');
      expect(result.kit).toBe(null);
    });
  });

  describe('tool type detection', () => {
    test('detects combi drill', () => {
      const result = parseTitle('Makita 18V Combi Drill Kit');
      expect(result.tool_core).toBe('COMBI_DRILL');
    });

    test('detects impact driver', () => {
      const result = parseTitle('Milwaukee M18 Impact Driver');
      expect(result.tool_core).toBe('IMPACT_DRIVER');
    });

    test('detects angle grinder', () => {
      const result = parseTitle('Makita 18V Angle Grinder 115mm');
      expect(result.tool_core).toBe('ANGLE_GRINDER');
    });

    test('detects circular saw', () => {
      const result = parseTitle('DeWalt 18V XR Circular Saw');
      expect(result.tool_core).toBe('CIRCULAR_SAW');
    });
  });

  describe('voltage detection', () => {
    test('detects 18V', () => {
      const result = parseTitle('Makita 18V Combi Drill');
      expect(result.voltage).toBe(18);
    });

    test('detects 12V', () => {
      const result = parseTitle('Bosch 12V Drill');
      expect(result.voltage).toBe(12);
    });

    test('detects 40V', () => {
      const result = parseTitle('Makita 40V Max XGT');
      expect(result.voltage).toBe(40);
    });
  });

  describe('brand detection', () => {
    test('detects Makita', () => {
      const result = parseTitle('Makita DHP481 18V Drill');
      expect(result.brand).toBe('MAKITA');
    });

    test('detects DeWalt', () => {
      const result = parseTitle('DeWalt DCD996 Hammer Drill');
      expect(result.brand).toBe('DEWALT');
    });

    test('detects Milwaukee', () => {
      const result = parseTitle('Milwaukee M18 FUEL');
      expect(result.brand).toBe('MILWAUKEE');
    });
  });

  describe('edge cases', () => {
    test('handles null input', () => {
      const result = parseTitle(null);
      expect(result.battery_qty).toBe(null);
      expect(result.detected_tokens).toEqual([]);
    });

    test('handles empty string', () => {
      const result = parseTitle('');
      expect(result.battery_qty).toBe(null);
    });

    test('handles whitespace', () => {
      const result = parseTitle('   ');
      expect(result.battery_qty).toBe(null);
    });
  });
});

describe('compareIntents', () => {
  test('identical intents are compatible', () => {
    const intent1 = { battery_qty: 2, charger_included: true, tool_core: 'COMBI_DRILL' };
    const intent2 = { battery_qty: 2, charger_included: true, tool_core: 'COMBI_DRILL' };
    const result = compareIntents(intent1, intent2);
    expect(result.compatible).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('battery mismatch is incompatible', () => {
    const intent1 = { battery_qty: 2 };
    const intent2 = { battery_qty: 1 };
    const result = compareIntents(intent1, intent2);
    expect(result.compatible).toBe(false);
    expect(result.conflicts).toContain('Battery qty mismatch: 2 vs 1');
  });

  test('null values are ignored in comparison', () => {
    const intent1 = { battery_qty: 2, charger_included: null };
    const intent2 = { battery_qty: 2, charger_included: true };
    const result = compareIntents(intent1, intent2);
    expect(result.compatible).toBe(true);
  });
});

describe('suggestComponents', () => {
  test('suggests batteries when battery_qty > 0', () => {
    const intent = { battery_qty: 2, charger_included: true, case_included: true };
    const result = suggestComponents(intent);
    expect(result.needs_batteries).toBe(true);
    expect(result.battery_count).toBe(2);
    expect(result.needs_charger).toBe(true);
    expect(result.needs_case).toBe(true);
  });

  test('bare tool should not need batteries', () => {
    const intent = { bare_tool: true, battery_qty: 0 };
    const result = suggestComponents(intent);
    expect(result.is_bare_tool).toBe(true);
    expect(result.needs_batteries).toBe(false);
  });

  test('confidence is LOW when uncertain', () => {
    const intent = { battery_qty: null, charger_included: null };
    const result = suggestComponents(intent);
    expect(result.confidence).toBe('LOW');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test('confidence is HIGH when all signals clear', () => {
    const intent = { battery_qty: 2, charger_included: true, bare_tool: false, tool_core: 'COMBI_DRILL' };
    const result = suggestComponents(intent);
    expect(result.confidence).toBe('HIGH');
  });
});
