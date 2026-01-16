import React, { Component } from 'react';
import { Banner, Button, Page, BlockStack, Text } from '@shopify/polaris';

/**
 * ErrorBoundary - Catches JavaScript errors in child components
 *
 * Displays a fallback UI with error message and retry button.
 * Logs errors to console with stack trace for debugging.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console with stack trace
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack trace:', errorInfo.componentStack);

    this.setState({ errorInfo });
  }

  handleRetry = () => {
    // Reset the error state to attempt re-rendering
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      const errorMessage = error?.message || 'An unexpected error occurred';

      return (
        <Page title="Something went wrong">
          <BlockStack gap="400">
            <Banner
              title="Application Error"
              tone="critical"
            >
              <BlockStack gap="200">
                <Text variant="bodyMd">
                  {errorMessage}
                </Text>
                {process.env.NODE_ENV === 'development' && errorInfo && (
                  <details style={{ marginTop: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
                      View error details
                    </summary>
                    <pre style={{
                      marginTop: '8px',
                      padding: '12px',
                      backgroundColor: '#f4f4f4',
                      borderRadius: '4px',
                      fontSize: '12px',
                      overflow: 'auto',
                      maxHeight: '200px',
                    }}>
                      {error?.stack}
                      {'\n\nComponent Stack:'}
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </BlockStack>
            </Banner>
            <div>
              <Button variant="primary" onClick={this.handleRetry}>
                Try Again
              </Button>
            </div>
          </BlockStack>
        </Page>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
