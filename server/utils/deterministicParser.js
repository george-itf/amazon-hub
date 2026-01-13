/**
 * Deterministic Title Parser for Power Tool Listings
 *
 * This parser extracts structured information from listing titles using
 * only deterministic, pattern-based rules. It follows the principle of
 * REVIEW over guessing - if something cannot be determined with high
 * confidence, it returns null rather than guessing.
 *
 * Output format (parse_intent):
 * - battery_qty: int or null
 * - charger_included: true/false/null
 * - case_included: true/false/null
 * - bare_tool: true/false/null
 * - kit: true/false/null
 * - detected_tokens: string[]
 * - tool_core: string|null (only if safely detected)
 */

// Known battery indicators with their counts
const BATTERY_PATTERNS = [
  { pattern: /\b(\d+)\s*x?\s*batter(?:y|ies)\b/i, extract: (m) => parseInt(m[1]) },
  { pattern: /\bwith\s+(\d+)\s*batter(?:y|ies)\b/i, extract: (m) => parseInt(m[1]) },
  { pattern: /\b(\d+)\s*ah\s+batter(?:y|ies)\b/i, extract: (m) => parseInt(m[1]) },
  { pattern: /\bdual\s+batter(?:y|ies)\b/i, extract: () => 2 },
  { pattern: /\btwin\s+batter(?:y|ies)\b/i, extract: () => 2 },
  { pattern: /\btriple\s+batter(?:y|ies)\b/i, extract: () => 3 },
  { pattern: /\b2\s*x\s*\d+\.?\d*\s*ah\b/i, extract: () => 2 },
  { pattern: /\b3\s*x\s*\d+\.?\d*\s*ah\b/i, extract: () => 3 },
  { pattern: /\b1\s*x\s*\d+\.?\d*\s*ah\b/i, extract: () => 1 },
];

// Charger indicators
const CHARGER_POSITIVE = [
  /\bwith\s+charger\b/i,
  /\b\+\s*charger\b/i,
  /\bincl(?:udes?|uding)?\s+charger\b/i,
  /\bcharger\s+included\b/i,
  /\bkit\b.*\bcharger\b/i,
  /\bcharger\b.*\bkit\b/i,
];

const CHARGER_NEGATIVE = [
  /\bbody\s+only\b/i,
  /\bbare\s+tool\b/i,
  /\bbare\s+unit\b/i,
  /\bno\s+batter(?:y|ies)\b/i,
  /\bwithout\s+charger\b/i,
  /\bcharger\s+not\s+included\b/i,
  /\bcharger\s+sold\s+separately\b/i,
];

// Case/carry case indicators
const CASE_POSITIVE = [
  /\bwith\s+case\b/i,
  /\bin\s+case\b/i,
  /\bcarry\s*case\b/i,
  /\bcarrying\s*case\b/i,
  /\bsystem\s*case\b/i,
  /\bmakpac\b/i,
  /\bl-boxx\b/i,
  /\bsortimo\b/i,
  /\btstak\b/i,
  /\bstackable\s+case\b/i,
];

const CASE_NEGATIVE = [
  /\bno\s+case\b/i,
  /\bwithout\s+case\b/i,
  /\bcase\s+not\s+included\b/i,
];

// Bare tool indicators (definitive)
const BARE_TOOL_PATTERNS = [
  /\bbody\s+only\b/i,
  /\bbare\s+tool\b/i,
  /\bbare\s+unit\b/i,
  /\btool\s+only\b/i,
  /\bunit\s+only\b/i,
  /\bskin\s+only\b/i,
  /\bnaked\b/i,
];

// Kit indicators
const KIT_PATTERNS = [
  /\bcombi\s*kit\b/i,
  /\btwin\s*kit\b/i,
  /\btriple\s*kit\b/i,
  /\bkit\b/i,
  /\bset\b/i,
  /\bcombo\b/i,
  /\bstarter\s+pack\b/i,
];

// Tool type detection (conservative - only well-known patterns)
const TOOL_TYPES = [
  { pattern: /\bcombi\s*drill\b/i, type: 'COMBI_DRILL' },
  { pattern: /\bhammer\s*drill\b/i, type: 'HAMMER_DRILL' },
  { pattern: /\bimpact\s*driver\b/i, type: 'IMPACT_DRIVER' },
  { pattern: /\bimpact\s*wrench\b/i, type: 'IMPACT_WRENCH' },
  { pattern: /\bangle\s*grinder\b/i, type: 'ANGLE_GRINDER' },
  { pattern: /\bcircular\s*saw\b/i, type: 'CIRCULAR_SAW' },
  { pattern: /\bjigsaw\b/i, type: 'JIGSAW' },
  { pattern: /\breciprocating\s*saw\b/i, type: 'RECIPROCATING_SAW' },
  { pattern: /\bsabre\s*saw\b/i, type: 'RECIPROCATING_SAW' },
  { pattern: /\bsds\s*drill\b/i, type: 'SDS_DRILL' },
  { pattern: /\brotary\s*hammer\b/i, type: 'ROTARY_HAMMER' },
  { pattern: /\bplaner\b/i, type: 'PLANER' },
  { pattern: /\brouter\b/i, type: 'ROUTER' },
  { pattern: /\bsander\b/i, type: 'SANDER' },
  { pattern: /\borbital\s*sander\b/i, type: 'ORBITAL_SANDER' },
  { pattern: /\bbelt\s*sander\b/i, type: 'BELT_SANDER' },
  { pattern: /\bmulti\s*tool\b/i, type: 'MULTI_TOOL' },
  { pattern: /\boscillating\b/i, type: 'MULTI_TOOL' },
  { pattern: /\bmitre\s*saw\b/i, type: 'MITRE_SAW' },
  { pattern: /\btable\s*saw\b/i, type: 'TABLE_SAW' },
  { pattern: /\bblower\b/i, type: 'BLOWER' },
  { pattern: /\bvacuum\b/i, type: 'VACUUM' },
  { pattern: /\btorch\b/i, type: 'TORCH' },
  { pattern: /\blight\b/i, type: 'WORK_LIGHT' },
  { pattern: /\bradio\b/i, type: 'RADIO' },
  { pattern: /\bnailer\b/i, type: 'NAILER' },
  { pattern: /\bstapler\b/i, type: 'STAPLER' },
  { pattern: /\bhoover\b/i, type: 'VACUUM' },
];

// Brand detection
const BRANDS = [
  'makita', 'dewalt', 'milwaukee', 'bosch', 'hikoki', 'hitachi',
  'metabo', 'festool', 'ryobi', 'einhell', 'stanley', 'black\\s*&?\\s*decker',
  'parkside', 'worx', 'draper', 'trend', 'erbauer', 'titan',
];

// Voltage detection
const VOLTAGE_PATTERN = /\b(\d+(?:\.\d+)?)\s*v(?:olt)?\b/i;

// Battery capacity detection
const CAPACITY_PATTERN = /\b(\d+(?:\.\d+)?)\s*ah\b/i;

/**
 * Parse a listing title and extract structured information.
 * Returns null for any field that cannot be determined with confidence.
 *
 * @param {string} title - The listing title to parse
 * @returns {Object} parse_intent object
 */
export function parseTitle(title) {
  if (!title || typeof title !== 'string') {
    return {
      battery_qty: null,
      charger_included: null,
      case_included: null,
      bare_tool: null,
      kit: null,
      detected_tokens: [],
      tool_core: null,
      voltage: null,
      capacity: null,
      brand: null,
    };
  }

  const normalizedTitle = title.trim();
  const detected_tokens = [];

  // Extract battery quantity
  let battery_qty = null;
  for (const { pattern, extract } of BATTERY_PATTERNS) {
    const match = normalizedTitle.match(pattern);
    if (match) {
      battery_qty = extract(match);
      detected_tokens.push(`BATTERY_${battery_qty}`);
      break;
    }
  }

  // Detect bare tool (must be explicit)
  let bare_tool = null;
  for (const pattern of BARE_TOOL_PATTERNS) {
    if (pattern.test(normalizedTitle)) {
      bare_tool = true;
      detected_tokens.push('BARE_TOOL');
      break;
    }
  }

  // If bare tool is detected, battery_qty should be 0
  if (bare_tool === true && battery_qty === null) {
    battery_qty = 0;
  }

  // Detect charger inclusion
  let charger_included = null;

  // Check negative indicators first (body only, etc)
  if (bare_tool === true) {
    charger_included = false;
  } else {
    for (const pattern of CHARGER_NEGATIVE) {
      if (pattern.test(normalizedTitle)) {
        charger_included = false;
        detected_tokens.push('NO_CHARGER');
        break;
      }
    }

    // Only check positive if we haven't found negative
    if (charger_included === null) {
      for (const pattern of CHARGER_POSITIVE) {
        if (pattern.test(normalizedTitle)) {
          charger_included = true;
          detected_tokens.push('WITH_CHARGER');
          break;
        }
      }
    }
  }

  // Detect case inclusion
  let case_included = null;
  for (const pattern of CASE_NEGATIVE) {
    if (pattern.test(normalizedTitle)) {
      case_included = false;
      detected_tokens.push('NO_CASE');
      break;
    }
  }

  if (case_included === null) {
    for (const pattern of CASE_POSITIVE) {
      if (pattern.test(normalizedTitle)) {
        case_included = true;
        detected_tokens.push('WITH_CASE');
        break;
      }
    }
  }

  // Detect kit
  let kit = null;
  if (bare_tool !== true) {
    for (const pattern of KIT_PATTERNS) {
      if (pattern.test(normalizedTitle)) {
        kit = true;
        detected_tokens.push('KIT');
        break;
      }
    }
  }

  // Detect tool type (only if confident)
  let tool_core = null;
  for (const { pattern, type } of TOOL_TYPES) {
    if (pattern.test(normalizedTitle)) {
      tool_core = type;
      detected_tokens.push(`TOOL_${type}`);
      break;
    }
  }

  // Detect voltage
  let voltage = null;
  const voltageMatch = normalizedTitle.match(VOLTAGE_PATTERN);
  if (voltageMatch) {
    voltage = parseFloat(voltageMatch[1]);
    detected_tokens.push(`${voltage}V`);
  }

  // Detect battery capacity
  let capacity = null;
  const capacityMatch = normalizedTitle.match(CAPACITY_PATTERN);
  if (capacityMatch) {
    capacity = parseFloat(capacityMatch[1]);
    detected_tokens.push(`${capacity}AH`);
  }

  // Detect brand
  let brand = null;
  for (const brandPattern of BRANDS) {
    const regex = new RegExp(`\\b${brandPattern}\\b`, 'i');
    if (regex.test(normalizedTitle)) {
      brand = brandPattern.replace(/\\s\*\?\s\*/g, ' ').toUpperCase();
      detected_tokens.push(`BRAND_${brand}`);
      break;
    }
  }

  return {
    battery_qty,
    charger_included,
    case_included,
    bare_tool,
    kit,
    detected_tokens,
    tool_core,
    voltage,
    capacity,
    brand,
  };
}

/**
 * Compare two parse_intent results to check if they're compatible
 * for the same BOM assignment.
 *
 * @param {Object} intent1
 * @param {Object} intent2
 * @returns {Object} { compatible: boolean, conflicts: string[] }
 */
export function compareIntents(intent1, intent2) {
  const conflicts = [];

  // Compare battery quantities (if both are known)
  if (intent1.battery_qty !== null && intent2.battery_qty !== null) {
    if (intent1.battery_qty !== intent2.battery_qty) {
      conflicts.push(`Battery qty mismatch: ${intent1.battery_qty} vs ${intent2.battery_qty}`);
    }
  }

  // Compare charger inclusion
  if (intent1.charger_included !== null && intent2.charger_included !== null) {
    if (intent1.charger_included !== intent2.charger_included) {
      conflicts.push(`Charger mismatch: ${intent1.charger_included} vs ${intent2.charger_included}`);
    }
  }

  // Compare case inclusion
  if (intent1.case_included !== null && intent2.case_included !== null) {
    if (intent1.case_included !== intent2.case_included) {
      conflicts.push(`Case mismatch: ${intent1.case_included} vs ${intent2.case_included}`);
    }
  }

  // Compare bare tool status
  if (intent1.bare_tool !== null && intent2.bare_tool !== null) {
    if (intent1.bare_tool !== intent2.bare_tool) {
      conflicts.push(`Bare tool mismatch: ${intent1.bare_tool} vs ${intent2.bare_tool}`);
    }
  }

  // Compare tool core
  if (intent1.tool_core !== null && intent2.tool_core !== null) {
    if (intent1.tool_core !== intent2.tool_core) {
      conflicts.push(`Tool type mismatch: ${intent1.tool_core} vs ${intent2.tool_core}`);
    }
  }

  // Compare voltage (with 10% tolerance)
  if (intent1.voltage !== null && intent2.voltage !== null) {
    const diff = Math.abs(intent1.voltage - intent2.voltage);
    const tolerance = Math.max(intent1.voltage, intent2.voltage) * 0.1;
    if (diff > tolerance) {
      conflicts.push(`Voltage mismatch: ${intent1.voltage}V vs ${intent2.voltage}V`);
    }
  }

  return {
    compatible: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Suggest potential BOM components based on parse_intent.
 * This is advisory only - human review is required.
 *
 * @param {Object} intent - parse_intent object
 * @returns {Object} Suggested component requirements
 */
export function suggestComponents(intent) {
  const suggestions = {
    needs_batteries: intent.battery_qty > 0,
    battery_count: intent.battery_qty || 0,
    needs_charger: intent.charger_included === true,
    needs_case: intent.case_included === true,
    is_bare_tool: intent.bare_tool === true,
    confidence: 'LOW', // Always conservative
    notes: [],
  };

  // Add notes about uncertainty
  if (intent.battery_qty === null && intent.bare_tool !== true) {
    suggestions.notes.push('Battery quantity unclear - needs manual review');
  }

  if (intent.charger_included === null && intent.bare_tool !== true) {
    suggestions.notes.push('Charger inclusion unclear - needs manual review');
  }

  if (intent.case_included === null) {
    suggestions.notes.push('Case inclusion unclear - needs manual review');
  }

  if (intent.tool_core === null) {
    suggestions.notes.push('Tool type not detected');
  }

  // Increase confidence if we have clear signals
  const clearSignals = [
    intent.bare_tool !== null,
    intent.battery_qty !== null,
    intent.charger_included !== null,
    intent.tool_core !== null,
  ].filter(Boolean).length;

  if (clearSignals >= 4) {
    suggestions.confidence = 'HIGH';
  } else if (clearSignals >= 2) {
    suggestions.confidence = 'MEDIUM';
  }

  return suggestions;
}

export default {
  parseTitle,
  compareIntents,
  suggestComponents,
};
