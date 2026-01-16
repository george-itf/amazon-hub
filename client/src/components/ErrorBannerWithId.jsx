import React, { useCallback, useState } from 'react';
import { Banner, Button, Text, InlineStack, Box } from '@shopify/polaris';

/**
 * ErrorBannerWithId - Displays API errors with correlation ID for support
 *
 * Features:
 * - Shows error message in a critical Banner
 * - Displays correlation ID in small gray text
 * - Copy ID button to clipboard for support tickets
 * - Shows appropriate action based on error category
 */
function ErrorBannerWithId({
  error,
  correlationId,
  category,
  onDismiss,
  onRetry,
  title = 'An error occurred',
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = useCallback(async () => {
    if (!correlationId) return;

    try {
      await navigator.clipboard.writeText(correlationId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy correlation ID:', err);
    }
  }, [correlationId]);

  // Determine action based on category
  const getActionButton = () => {
    switch (category) {
      case 'VALIDATION':
        return null; // User needs to fix input, no automatic action
      case 'RATE_LIMIT':
        return onRetry ? (
          <Button onClick={onRetry} size="slim">
            Retry in a moment
          </Button>
        ) : null;
      case 'EXTERNAL':
        return onRetry ? (
          <Button onClick={onRetry} size="slim">
            Retry
          </Button>
        ) : null;
      case 'CONFLICT':
        return onRetry ? (
          <Button onClick={onRetry} size="slim">
            Refresh
          </Button>
        ) : null;
      case 'INTERNAL':
        return onRetry ? (
          <Button onClick={onRetry} size="slim">
            Retry
          </Button>
        ) : null;
      default:
        return onRetry ? (
          <Button onClick={onRetry} size="slim">
            Retry
          </Button>
        ) : null;
    }
  };

  // Build banner action if dismissable
  const bannerAction = onDismiss ? { onDismiss } : undefined;

  return (
    <Banner
      title={title}
      tone="critical"
      onDismiss={bannerAction?.onDismiss}
    >
      <Box paddingBlockEnd="200">
        <Text as="p" variant="bodyMd">
          {error}
        </Text>
      </Box>

      {correlationId && (
        <Box paddingBlockEnd="200">
          <InlineStack gap="200" align="start" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              Reference ID: {correlationId}
            </Text>
            <Button
              onClick={handleCopyId}
              size="slim"
              variant="plain"
            >
              {copied ? 'Copied!' : 'Copy ID'}
            </Button>
          </InlineStack>
        </Box>
      )}

      {getActionButton() && (
        <Box paddingBlockStart="100">
          {getActionButton()}
        </Box>
      )}
    </Banner>
  );
}

export default ErrorBannerWithId;
