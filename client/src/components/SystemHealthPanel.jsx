import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  Button,
  Banner,
  ProgressBar,
  Tooltip,
} from '@shopify/polaris';
import { InvictaLoading, InvictaButton } from './ui/index.jsx';
import * as api from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (!pence && pence !== 0) return '-';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

/**
 * Format relative time
 */
function formatRelativeTime(isoString) {
  if (!isoString) return 'Never';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format absolute time
 */
function formatAbsoluteTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Health Status Card component for individual integration
 */
function HealthStatusCard({ title, icon, children, status, lastSyncTime }) {
  const statusColors = {
    success: 'success',
    warning: 'warning',
    error: 'critical',
    unknown: 'attention',
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="headingSm">{title}</Text>
            {icon}
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={statusColors[status] || 'attention'}>
              {status === 'success' ? 'Healthy' : status === 'warning' ? 'Warning' : status === 'error' ? 'Error' : 'Unknown'}
            </Badge>
            {lastSyncTime && (
              <Tooltip content={formatAbsoluteTime(lastSyncTime)}>
                <Text variant="bodySm" tone="subdued">
                  {formatRelativeTime(lastSyncTime)}
                </Text>
              </Tooltip>
            )}
          </InlineStack>
        </InlineStack>
        <Divider />
        {children}
      </BlockStack>
    </Card>
  );
}

/**
 * Stat Row component
 */
function StatRow({ label, value, tone, suffix }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text variant="bodySm" tone="subdued">{label}</Text>
      <InlineStack gap="100" blockAlign="center">
        <Text variant="bodyMd" fontWeight="semibold" tone={tone}>
          {value}
        </Text>
        {suffix && <Text variant="bodySm" tone="subdued">{suffix}</Text>}
      </InlineStack>
    </InlineStack>
  );
}

/**
 * SystemHealthPanel - Displays system integration health status
 */
export default function SystemHealthPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [daysBack, setDaysBack] = useState(30);

  const loadHealthData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getSystemHealth({ days_back: daysBack });
      setHealthData(data);
    } catch (err) {
      console.error('Failed to load system health:', err);
      setError(err.message || 'Failed to load system health');
    } finally {
      setLoading(false);
    }
  }, [daysBack]);

  useEffect(() => {
    loadHealthData();
  }, [loadHealthData]);

  if (loading) {
    return <InvictaLoading message="Loading system health..." />;
  }

  if (error) {
    return (
      <Banner tone="critical" onDismiss={() => setError(null)}>
        <p>{error}</p>
        <Button onClick={loadHealthData}>Retry</Button>
      </Banner>
    );
  }

  if (!healthData) {
    return (
      <Card>
        <Text tone="subdued">No health data available.</Text>
      </Card>
    );
  }

  const { amazon_sync, keepa_refresh, demand_model, royal_mail } = healthData;

  // Determine overall health status
  const getAmazonStatus = () => {
    if (!amazon_sync.last_sync_at) return 'unknown';
    if (amazon_sync.last_status === 'failed') return 'error';
    if (amazon_sync.period_stats.failed_count > amazon_sync.period_stats.success_count) return 'warning';
    return 'success';
  };

  const getKeepaStatus = () => {
    if (!keepa_refresh.last_refresh_at) return 'unknown';
    return 'success';
  };

  const getDemandModelStatus = () => {
    if (!demand_model.trained_at) return 'unknown';
    // Warn if model is older than 7 days
    const modelAge = new Date() - new Date(demand_model.trained_at);
    if (modelAge > 7 * 24 * 60 * 60 * 1000) return 'warning';
    return 'success';
  };

  const getRoyalMailStatus = () => {
    if (!royal_mail.last_batch_at) return 'unknown';
    if (royal_mail.period_stats.total_labels_failed > 0) return 'warning';
    return 'success';
  };

  return (
    <BlockStack gap="400">
      {/* Header */}
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text variant="headingMd">System Health</Text>
          <Text variant="bodySm" tone="subdued">
            Integration status for the last {daysBack} days
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          <Button
            size="slim"
            pressed={daysBack === 7}
            onClick={() => setDaysBack(7)}
          >
            7d
          </Button>
          <Button
            size="slim"
            pressed={daysBack === 30}
            onClick={() => setDaysBack(30)}
          >
            30d
          </Button>
          <Button
            size="slim"
            pressed={daysBack === 90}
            onClick={() => setDaysBack(90)}
          >
            90d
          </Button>
          <InvictaButton
            size="slim"
            variant="secondary"
            onClick={loadHealthData}
          >
            Refresh
          </InvictaButton>
        </InlineStack>
      </InlineStack>

      {/* Amazon Sync Card */}
      <HealthStatusCard
        title="Amazon Order Sync"
        status={getAmazonStatus()}
        lastSyncTime={amazon_sync.last_sync_at}
      >
        <BlockStack gap="200">
          {amazon_sync.last_description && (
            <Text variant="bodySm" tone="subdued">
              {amazon_sync.last_description}
            </Text>
          )}
          <StatRow
            label="Successful syncs"
            value={amazon_sync.period_stats.success_count}
            tone="success"
          />
          <StatRow
            label="Failed syncs"
            value={amazon_sync.period_stats.failed_count}
            tone={amazon_sync.period_stats.failed_count > 0 ? 'critical' : undefined}
          />
          <StatRow
            label="Orders synced"
            value={amazon_sync.period_stats.total_orders_synced.toLocaleString()}
          />
          {amazon_sync.period_stats.total_errors > 0 && (
            <StatRow
              label="Total errors"
              value={amazon_sync.period_stats.total_errors}
              tone="critical"
            />
          )}
          {amazon_sync.period_stats.success_count + amazon_sync.period_stats.failed_count > 0 && (
            <>
              <Divider />
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Success Rate</Text>
                <ProgressBar
                  progress={
                    (amazon_sync.period_stats.success_count /
                      (amazon_sync.period_stats.success_count + amazon_sync.period_stats.failed_count)) *
                    100
                  }
                  size="small"
                  tone={getAmazonStatus() === 'success' ? 'highlight' : 'critical'}
                />
              </BlockStack>
            </>
          )}
        </BlockStack>
      </HealthStatusCard>

      {/* Keepa Refresh Card */}
      <HealthStatusCard
        title="Keepa Data Refresh"
        status={getKeepaStatus()}
        lastSyncTime={keepa_refresh.last_refresh_at}
      >
        <BlockStack gap="200">
          {keepa_refresh.last_description && (
            <Text variant="bodySm" tone="subdued">
              {keepa_refresh.last_description}
            </Text>
          )}
          <StatRow
            label="Last tokens spent"
            value={keepa_refresh.last_tokens_spent.toLocaleString()}
          />
          <StatRow
            label="Last ASINs refreshed"
            value={keepa_refresh.last_asins_refreshed.toLocaleString()}
          />
          <Divider />
          <StatRow
            label="Total requests"
            value={keepa_refresh.period_stats.total_requests.toLocaleString()}
            suffix={`(${daysBack}d)`}
          />
          <StatRow
            label="Total tokens spent"
            value={keepa_refresh.period_stats.total_tokens_spent.toLocaleString()}
          />
          <StatRow
            label="Total ASINs refreshed"
            value={keepa_refresh.period_stats.total_asins_refreshed.toLocaleString()}
          />
        </BlockStack>
      </HealthStatusCard>

      {/* Demand Model Card */}
      <HealthStatusCard
        title="Demand Prediction Model"
        status={getDemandModelStatus()}
        lastSyncTime={demand_model.trained_at}
      >
        <BlockStack gap="200">
          {demand_model.model_name ? (
            <>
              <StatRow
                label="Model name"
                value={demand_model.model_name}
              />
              <StatRow
                label="Status"
                value={demand_model.is_active ? 'Active' : 'Inactive'}
                tone={demand_model.is_active ? 'success' : 'critical'}
              />
              {demand_model.metrics && (
                <>
                  <Divider />
                  <Text variant="bodySm" fontWeight="semibold">Model Metrics</Text>
                  {demand_model.metrics.mae && (
                    <StatRow
                      label="Mean Absolute Error"
                      value={demand_model.metrics.mae.toFixed(3)}
                    />
                  )}
                  {demand_model.metrics.r2 && (
                    <StatRow
                      label="R-squared"
                      value={demand_model.metrics.r2.toFixed(3)}
                    />
                  )}
                  {demand_model.metrics.rmse && (
                    <StatRow
                      label="RMSE"
                      value={demand_model.metrics.rmse.toFixed(3)}
                    />
                  )}
                </>
              )}
              {demand_model.training_summary && (
                <>
                  <Divider />
                  <Text variant="bodySm" fontWeight="semibold">Training Summary</Text>
                  {demand_model.training_summary.samples_count && (
                    <StatRow
                      label="Training samples"
                      value={demand_model.training_summary.samples_count.toLocaleString()}
                    />
                  )}
                  {demand_model.training_summary.features_count && (
                    <StatRow
                      label="Features"
                      value={demand_model.training_summary.features_count}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <Text variant="bodySm" tone="subdued">
              No demand model has been trained yet. Train a model to enable demand predictions.
            </Text>
          )}
        </BlockStack>
      </HealthStatusCard>

      {/* Royal Mail Card */}
      <HealthStatusCard
        title="Royal Mail Shipping"
        status={getRoyalMailStatus()}
        lastSyncTime={royal_mail.last_batch_at}
      >
        <BlockStack gap="200">
          {royal_mail.last_description && (
            <Text variant="bodySm" tone="subdued">
              {royal_mail.last_description}
            </Text>
          )}
          {royal_mail.last_batch_at && (
            <>
              <Text variant="bodySm" fontWeight="semibold">Last Batch</Text>
              <StatRow
                label="Type"
                value={royal_mail.last_batch_dry_run ? 'Dry run' : 'Live'}
                tone={royal_mail.last_batch_dry_run ? 'subdued' : undefined}
              />
              <StatRow
                label="Labels created"
                value={royal_mail.last_batch_success}
                tone="success"
              />
              {royal_mail.last_batch_failed > 0 && (
                <StatRow
                  label="Labels failed"
                  value={royal_mail.last_batch_failed}
                  tone="critical"
                />
              )}
              {!royal_mail.last_batch_dry_run && royal_mail.last_batch_cost_pence > 0 && (
                <StatRow
                  label="Batch cost"
                  value={formatPrice(royal_mail.last_batch_cost_pence)}
                />
              )}
            </>
          )}
          <Divider />
          <Text variant="bodySm" fontWeight="semibold">Period Totals ({daysBack}d)</Text>
          <StatRow
            label="Total batches"
            value={royal_mail.period_stats.total_batches.toLocaleString()}
          />
          <StatRow
            label="Labels created"
            value={royal_mail.period_stats.total_labels_success.toLocaleString()}
            tone="success"
          />
          {royal_mail.period_stats.total_labels_failed > 0 && (
            <StatRow
              label="Labels failed"
              value={royal_mail.period_stats.total_labels_failed.toLocaleString()}
              tone="critical"
            />
          )}
          <StatRow
            label="Total shipping cost"
            value={formatPrice(royal_mail.period_stats.total_cost_pence)}
            tone={royal_mail.period_stats.total_cost_pence > 0 ? 'critical' : undefined}
          />
        </BlockStack>
      </HealthStatusCard>

      {/* Timestamp */}
      <Text variant="bodySm" tone="subdued" alignment="center">
        Last updated: {formatAbsoluteTime(healthData.generated_at)}
      </Text>
    </BlockStack>
  );
}
