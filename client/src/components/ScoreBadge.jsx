import React from 'react';
import { Badge, Tooltip, BlockStack, Text, InlineStack } from '@shopify/polaris';

/**
 * Score Badge Component
 * Displays a 0-100 score with RED/AMBER/GREEN color banding
 */
export default function ScoreBadge({ score, size = 'medium', showTooltip = true }) {
  if (!score || score.value === null || score.value === undefined) {
    return <Badge>-</Badge>;
  }

  const { value, band, reasons = [] } = score;

  // Determine badge tone based on band
  const toneMap = {
    GREEN: 'success',
    AMBER: 'warning',
    RED: 'critical',
  };
  const tone = toneMap[band] || undefined;

  // Badge content
  const badge = (
    <Badge tone={tone} size={size}>
      {value}
    </Badge>
  );

  if (!showTooltip || reasons.length === 0) {
    return badge;
  }

  // Tooltip with reasons breakdown
  const tooltipContent = (
    <BlockStack gap="200">
      <Text variant="bodySm" fontWeight="semibold">Score Breakdown</Text>
      {reasons.map((r, i) => (
        <InlineStack key={i} gap="200" blockAlign="center">
          <Text variant="bodySm" tone={r.weight > 0 ? 'success' : r.weight < 0 ? 'critical' : 'subdued'}>
            {r.weight > 0 ? '+' : ''}{r.weight}
          </Text>
          <Text variant="bodySm">{r.detail}</Text>
        </InlineStack>
      ))}
    </BlockStack>
  );

  return (
    <Tooltip content={tooltipContent} preferredPosition="above">
      {badge}
    </Tooltip>
  );
}

/**
 * Score Progress Bar
 * Visual representation of score with color gradient
 */
export function ScoreProgressBar({ score }) {
  if (!score || score.value === null) {
    return null;
  }

  const { value, band } = score;

  const colorMap = {
    GREEN: '#008060',
    AMBER: '#b98900',
    RED: '#c9372c',
  };

  return (
    <div style={{ width: '100%', height: '8px', backgroundColor: '#e4e5e7', borderRadius: '4px', overflow: 'hidden' }}>
      <div
        style={{
          width: `${value}%`,
          height: '100%',
          backgroundColor: colorMap[band] || '#8c9196',
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  );
}

/**
 * Score Card
 * Full score display with value, band, and reasons
 */
export function ScoreCard({ score, title = 'Analysis Score' }) {
  if (!score) return null;

  const { value, band, reasons = [] } = score;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingSm">{title}</Text>
        <ScoreBadge score={score} size="large" showTooltip={false} />
      </InlineStack>

      <ScoreProgressBar score={score} />

      {reasons.length > 0 && (
        <BlockStack gap="100">
          {reasons.map((r, i) => (
            <InlineStack key={i} gap="200" blockAlign="center">
              <div style={{
                width: '24px',
                textAlign: 'right',
                fontWeight: 'bold',
                color: r.weight > 0 ? '#008060' : r.weight < 0 ? '#c9372c' : '#8c9196',
                fontSize: '12px',
              }}>
                {r.weight > 0 ? '+' : ''}{r.weight}
              </div>
              <Text variant="bodySm" tone="subdued">{r.detail}</Text>
            </InlineStack>
          ))}
        </BlockStack>
      )}
    </BlockStack>
  );
}
