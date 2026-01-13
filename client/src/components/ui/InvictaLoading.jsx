import React from 'react';
import { Spinner, Card, BlockStack, Text, SkeletonBodyText, SkeletonDisplayText } from '@shopify/polaris';

/**
 * InvictaLoading - Full page loading indicator
 */
export function InvictaLoading({ message = 'Loading...' }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '300px',
      gap: '16px',
    }}>
      <Spinner size="large" />
      <Text variant="bodyMd" tone="subdued">{message}</Text>
    </div>
  );
}

/**
 * InvictaPageLoading - Loading state for an entire page
 */
export function InvictaPageLoading() {
  return (
    <BlockStack gap="400">
      <Card>
        <SkeletonDisplayText size="medium" />
        <div style={{ marginTop: '16px' }}>
          <SkeletonBodyText lines={3} />
        </div>
      </Card>
      <Card>
        <SkeletonBodyText lines={5} />
      </Card>
    </BlockStack>
  );
}

/**
 * InvictaTableLoading - Loading skeleton for tables
 */
export function InvictaTableLoading({ rows = 5, columns = 4 }) {
  return (
    <Card>
      <div style={{ padding: '16px' }}>
        <BlockStack gap="200">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: '16px',
            }}>
              {Array.from({ length: columns }).map((_, j) => (
                <SkeletonBodyText key={j} lines={1} />
              ))}
            </div>
          ))}
        </BlockStack>
      </div>
    </Card>
  );
}

/**
 * InvictaInlineLoading - Small inline loading indicator
 */
export function InvictaInlineLoading({ size = 'small' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <Spinner size={size} />
    </span>
  );
}

export default InvictaLoading;
