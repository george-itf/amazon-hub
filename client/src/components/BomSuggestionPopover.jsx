import React, { useState, useCallback, useEffect } from 'react';
import {
  Popover,
  ActionList,
  Button,
  BlockStack,
  Text,
  Badge,
  InlineStack,
  Spinner,
  Banner,
} from '@shopify/polaris';
import { getBomCandidates } from '../utils/api.jsx';

/**
 * BOM Suggestion Popover Component
 * Shows suggested BOMs for an ASIN and allows selection
 */
export default function BomSuggestionPopover({
  asin,
  title,
  currentBomId,
  currentBomName,
  confidence,
  onSelect,
  disabled = false,
}) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [parseIntent, setParseIntent] = useState(null);

  const toggleActive = useCallback(() => setActive((active) => !active), []);

  // Load candidates when popover opens
  useEffect(() => {
    if (active && asin && candidates.length === 0) {
      loadCandidates();
    }
  }, [active, asin]);

  const loadCandidates = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBomCandidates(asin, title);
      setCandidates(data.candidates || []);
      setParseIntent(data.parse_intent);
    } catch (err) {
      setError(err.message || 'Failed to load BOM candidates');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (bomId, bomSku) => {
    if (onSelect) {
      onSelect(bomId, bomSku);
    }
    setActive(false);
  };

  // Confidence badge color
  const confidenceTone = {
    HIGH: 'success',
    MEDIUM: 'warning',
    LOW: 'info',
  };

  // Activator button
  const activator = (
    <Button
      onClick={toggleActive}
      disclosure={active ? 'up' : 'down'}
      disabled={disabled}
      size="slim"
    >
      <InlineStack gap="200" blockAlign="center">
        {currentBomName ? (
          <>
            <Text variant="bodySm">{truncate(currentBomName, 20)}</Text>
            {confidence && (
              <Badge tone={confidenceTone[confidence]} size="small">
                {confidence}
              </Badge>
            )}
          </>
        ) : (
          <Text variant="bodySm" tone="subdued">Select BOM</Text>
        )}
      </InlineStack>
    </Button>
  );

  return (
    <Popover
      active={active}
      activator={activator}
      autofocusTarget="first-node"
      onClose={toggleActive}
      preferredAlignment="left"
    >
      <Popover.Pane>
        <div style={{ padding: '12px', minWidth: '300px', maxWidth: '400px' }}>
          <BlockStack gap="300">
            <Text variant="headingSm">BOM Suggestions for {asin}</Text>

            {loading && (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text tone="subdued">Loading candidates...</Text>
              </InlineStack>
            )}

            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            )}

            {/* Parse Intent Summary */}
            {parseIntent && (
              <BlockStack gap="100">
                <Text variant="bodySm" fontWeight="semibold">Detected from title:</Text>
                <InlineStack gap="100" wrap>
                  {parseIntent.brand && <Badge>{parseIntent.brand}</Badge>}
                  {parseIntent.tool_core && <Badge>{parseIntent.tool_core}</Badge>}
                  {parseIntent.voltage && <Badge>{parseIntent.voltage}V</Badge>}
                  {parseIntent.battery_qty !== null && (
                    <Badge>{parseIntent.battery_qty}x Battery</Badge>
                  )}
                  {parseIntent.bare_tool && <Badge>Body Only</Badge>}
                  {parseIntent.charger_included && <Badge>+ Charger</Badge>}
                  {parseIntent.case_included && <Badge>+ Case</Badge>}
                </InlineStack>
              </BlockStack>
            )}

            {/* Candidates list */}
            {!loading && candidates.length > 0 && (
              <ActionList
                items={candidates.map((c) => ({
                  content: (
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">
                          {c.bom_sku}
                        </Text>
                        <Badge tone={confidenceTone[c.confidence]} size="small">
                          {c.confidence}
                        </Badge>
                      </InlineStack>
                      {c.bom_description && (
                        <Text variant="bodySm" tone="subdued">
                          {truncate(c.bom_description, 50)}
                        </Text>
                      )}
                      {c.rationale && c.rationale.length > 0 && (
                        <Text variant="bodySm" tone="subdued">
                          {c.rationale.slice(0, 2).join(', ')}
                        </Text>
                      )}
                    </BlockStack>
                  ),
                  onAction: () => handleSelect(c.bom_id, c.bom_sku),
                  active: c.bom_id === currentBomId,
                }))}
              />
            )}

            {!loading && candidates.length === 0 && !error && (
              <Text tone="subdued">No matching BOMs found. Create a new BOM or map manually.</Text>
            )}

            {/* Clear selection option */}
            {currentBomId && (
              <Button
                plain
                destructive
                onClick={() => handleSelect(null, null)}
              >
                Clear BOM selection
              </Button>
            )}
          </BlockStack>
        </div>
      </Popover.Pane>
    </Popover>
  );
}

function truncate(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
