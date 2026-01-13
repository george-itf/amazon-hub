import React from 'react';
import { Card, BlockStack, Text, InlineStack, Divider } from '@shopify/polaris';

/**
 * InvictaPanel - White card with subtle shadow
 *
 * Props:
 * - title: string - Optional panel title
 * - subtitle: string - Optional subtitle
 * - children: ReactNode - Panel content
 * - action: ReactNode - Optional action button in header
 * - footer: ReactNode - Optional footer content
 * - padding: 'tight' | 'default' | 'loose'
 * - variant: 'default' | 'highlight' | 'warning' | 'error'
 */
export function InvictaPanel({
  title,
  subtitle,
  children,
  action,
  footer,
  padding = 'default',
  variant = 'default',
}) {
  const getBorderColor = () => {
    switch (variant) {
      case 'highlight':
        return '#F26522';
      case 'warning':
        return '#FFB020';
      case 'error':
        return '#D72C0D';
      default:
        return 'transparent';
    }
  };

  const cardStyle = {
    borderLeft: variant !== 'default' ? `4px solid ${getBorderColor()}` : 'none',
  };

  const paddingMap = {
    tight: '200',
    default: '400',
    loose: '600',
  };

  return (
    <div style={cardStyle}>
      <Card padding={paddingMap[padding]}>
        <BlockStack gap="400">
          {(title || action) && (
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                {title && (
                  <Text variant="headingMd" as="h3">
                    {title}
                  </Text>
                )}
                {subtitle && (
                  <Text variant="bodyMd" tone="subdued">
                    {subtitle}
                  </Text>
                )}
              </BlockStack>
              {action}
            </InlineStack>
          )}
          {(title || action) && children && <Divider />}
          {children}
          {footer && (
            <>
              <Divider />
              {footer}
            </>
          )}
        </BlockStack>
      </Card>
    </div>
  );
}

/**
 * InvictaStatPanel - Panel displaying a single stat with label
 */
export function InvictaStatPanel({ label, value, sublabel, trend, variant = 'default' }) {
  const getTrendColor = () => {
    if (trend > 0) return '#008060';
    if (trend < 0) return '#D72C0D';
    return '#637381';
  };

  const getTrendSymbol = () => {
    if (trend > 0) return '↑';
    if (trend < 0) return '↓';
    return '';
  };

  return (
    <InvictaPanel variant={variant} padding="tight">
      <BlockStack gap="100">
        <Text variant="bodyMd" tone="subdued">
          {label}
        </Text>
        <InlineStack gap="200" blockAlign="baseline">
          <Text variant="heading2xl" as="p">
            {value}
          </Text>
          {trend !== undefined && (
            <span style={{ color: getTrendColor(), fontSize: '14px' }}>
              {getTrendSymbol()} {Math.abs(trend)}%
            </span>
          )}
        </InlineStack>
        {sublabel && (
          <Text variant="bodySm" tone="subdued">
            {sublabel}
          </Text>
        )}
      </BlockStack>
    </InvictaPanel>
  );
}

/**
 * InvictaPanelGrid - Grid layout for multiple panels
 */
export function InvictaPanelGrid({ children, columns = 3, gap = '16px' }) {
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap,
  };

  return <div style={gridStyle}>{children}</div>;
}

export default InvictaPanel;
