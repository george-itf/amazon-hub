import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Tabs,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Button,
  Banner,
  Divider,
  Badge,
  Checkbox,
  Modal,
  FormLayout,
} from '@shopify/polaris';
import {
  SettingsIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from '@shopify/polaris-icons';
import SystemHealthPanel from '../components/SystemHealthPanel.jsx';
import {
  getShippingRules,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  getDemandModelStatus,
  trainDemandModel,
  getDemandModelHistory,
  resetAllBomAssignments,
} from '../utils/api.jsx';
import { useUserPreferences } from '../hooks/useUserPreferences.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (!pence && pence !== 0) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Parse pounds to pence
 */
function parsePounds(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

/**
 * Default Settings Card
 */
function DefaultSettingsCard() {
  const { getPreference, setPreference, loading: prefsLoading } = useUserPreferences();

  const defaultSettings = {
    min_margin: '10',
    target_margin: '15',
    horizon_days: '14',
    default_service_code: 'CRL1',
  };

  // Load defaults from preferences or localStorage initially
  const [defaults, setDefaults] = useState(() => {
    try {
      const saved = localStorage.getItem('amazon_hub_defaults');
      return saved ? JSON.parse(saved) : defaultSettings;
    } catch { return defaultSettings; }
  });
  const [saved, setSaved] = useState(false);

  // Sync defaults from user preferences when loaded
  useEffect(() => {
    if (!prefsLoading) {
      const savedDefaults = getPreference('amazon_hub_defaults', null);
      if (savedDefaults && typeof savedDefaults === 'object') {
        setDefaults({ ...defaultSettings, ...savedDefaults });
      }
    }
  }, [prefsLoading, getPreference]);

  const handleSave = async () => {
    // Save to user preferences (syncs to server if logged in)
    await setPreference('amazon_hub_defaults', defaults);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd">Default Settings</Text>
          {saved && <Badge tone="success">Saved</Badge>}
        </InlineStack>
        <Text variant="bodySm" tone="subdued">
          These defaults apply to new listings and ASIN analysis.
        </Text>
        <Divider />

        <FormLayout>
          <FormLayout.Group>
            <TextField
              label="Default Min Margin %"
              type="number"
              value={defaults.min_margin}
              onChange={(v) => setDefaults({ ...defaults, min_margin: v })}
              suffix="%"
              helpText="Minimum margin threshold for listings"
              autoComplete="off"
            />
            <TextField
              label="Default Target Margin %"
              type="number"
              value={defaults.target_margin}
              onChange={(v) => setDefaults({ ...defaults, target_margin: v })}
              suffix="%"
              helpText="Target margin for optimal pricing"
              autoComplete="off"
            />
          </FormLayout.Group>
          <FormLayout.Group>
            <TextField
              label="Forecast Horizon (days)"
              type="number"
              value={defaults.horizon_days}
              onChange={(v) => setDefaults({ ...defaults, horizon_days: v })}
              suffix="days"
              helpText="Default days for demand forecasting"
              autoComplete="off"
            />
            <Select
              label="Default Shipping Service"
              options={[
                { label: 'Royal Mail Tracked 24 (CRL1)', value: 'CRL1' },
                { label: 'Royal Mail Tracked 48 (CRL2)', value: 'CRL2' },
                { label: 'Royal Mail 1st Class (STL1)', value: 'STL1' },
                { label: 'Royal Mail 2nd Class (STL2)', value: 'STL2' },
              ]}
              value={defaults.default_service_code}
              onChange={(v) => setDefaults({ ...defaults, default_service_code: v })}
              helpText="Default service for new shipping labels"
            />
          </FormLayout.Group>
        </FormLayout>

        <InlineStack align="end">
          <Button variant="primary" onClick={handleSave}>
            Save Defaults
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

/**
 * Shipping Rules Management Card
 */
function ShippingRulesCard() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    service_code: 'CRL1',
    max_weight_grams: '',
    max_length_cm: '',
    max_width_cm: '',
    max_height_cm: '',
    base_cost_pence: '',
    is_active: true,
  });

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getShippingRules();
      setRules(data.rules || []);
    } catch (err) {
      setError(err.message || 'Failed to load shipping rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const handleOpenModal = (rule = null) => {
    if (rule) {
      setEditingRule(rule);
      setFormData({
        name: rule.name || '',
        description: rule.description || '',
        service_code: rule.service_code || 'CRL1',
        max_weight_grams: rule.max_weight_grams?.toString() || '',
        max_length_cm: rule.max_length_cm?.toString() || '',
        max_width_cm: rule.max_width_cm?.toString() || '',
        max_height_cm: rule.max_height_cm?.toString() || '',
        base_cost_pence: rule.base_cost_pence ? (rule.base_cost_pence / 100).toFixed(2) : '',
        is_active: rule.is_active !== false,
      });
    } else {
      setEditingRule(null);
      setFormData({
        name: '',
        description: '',
        service_code: 'CRL1',
        max_weight_grams: '',
        max_length_cm: '',
        max_width_cm: '',
        max_height_cm: '',
        base_cost_pence: '',
        is_active: true,
      });
    }
    setModalOpen(true);
  };

  const handleSaveRule = async () => {
    try {
      const payload = {
        name: formData.name,
        description: formData.description || null,
        service_code: formData.service_code,
        max_weight_grams: formData.max_weight_grams ? parseInt(formData.max_weight_grams) : null,
        max_length_cm: formData.max_length_cm ? parseFloat(formData.max_length_cm) : null,
        max_width_cm: formData.max_width_cm ? parseFloat(formData.max_width_cm) : null,
        max_height_cm: formData.max_height_cm ? parseFloat(formData.max_height_cm) : null,
        base_cost_pence: parsePounds(formData.base_cost_pence),
        is_active: formData.is_active,
      };

      if (editingRule) {
        await updateShippingRule(editingRule.id, payload);
      } else {
        await createShippingRule(payload);
      }

      setModalOpen(false);
      loadRules();
    } catch (err) {
      setError(err.message || 'Failed to save shipping rule');
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!confirm('Are you sure you want to delete this shipping rule?')) return;
    try {
      await deleteShippingRule(ruleId);
      loadRules();
    } catch (err) {
      setError(err.message || 'Failed to delete shipping rule');
    }
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd">Shipping Rules</Text>
            <Text variant="bodySm" tone="subdued">
              Configure parcel sizes and shipping services for different product types.
            </Text>
          </BlockStack>
          <Button variant="primary" onClick={() => handleOpenModal()}>
            Add Rule
          </Button>
        </InlineStack>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        <Divider />

        {loading ? (
          <Text tone="subdued">Loading shipping rules...</Text>
        ) : rules.length === 0 ? (
          <Text tone="subdued">No shipping rules configured. Add a rule to get started.</Text>
        ) : (
          <BlockStack gap="300">
            {rules.map((rule) => (
              <Card key={rule.id}>
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodyMd" fontWeight="semibold">{rule.name}</Text>
                      <Badge tone={rule.is_active ? 'success' : 'attention'}>
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      <Badge>{rule.service_code}</Badge>
                    </InlineStack>
                    {rule.description && (
                      <Text variant="bodySm" tone="subdued">{rule.description}</Text>
                    )}
                    <InlineStack gap="300" wrap>
                      {rule.max_weight_grams && (
                        <Text variant="bodySm">Max: {rule.max_weight_grams}g</Text>
                      )}
                      {rule.max_length_cm && rule.max_width_cm && rule.max_height_cm && (
                        <Text variant="bodySm">
                          Dims: {rule.max_length_cm}×{rule.max_width_cm}×{rule.max_height_cm}cm
                        </Text>
                      )}
                      {rule.base_cost_pence && (
                        <Text variant="bodySm">Cost: {formatPrice(rule.base_cost_pence)}</Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button size="slim" onClick={() => handleOpenModal(rule)}>Edit</Button>
                    <Button size="slim" tone="critical" onClick={() => handleDeleteRule(rule.id)}>Delete</Button>
                  </InlineStack>
                </InlineStack>
              </Card>
            ))}
          </BlockStack>
        )}
      </BlockStack>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'Edit Shipping Rule' : 'Add Shipping Rule'}
        primaryAction={{
          content: 'Save',
          onAction: handleSaveRule,
          disabled: !formData.name,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Rule Name"
              value={formData.name}
              onChange={(v) => setFormData({ ...formData, name: v })}
              placeholder="e.g., Small Parcel"
              autoComplete="off"
              requiredIndicator
            />
            <TextField
              label="Description"
              value={formData.description}
              onChange={(v) => setFormData({ ...formData, description: v })}
              placeholder="Optional description"
              autoComplete="off"
            />
            <Select
              label="Royal Mail Service"
              options={[
                { label: 'Tracked 24 (CRL1)', value: 'CRL1' },
                { label: 'Tracked 48 (CRL2)', value: 'CRL2' },
                { label: '1st Class (STL1)', value: 'STL1' },
                { label: '2nd Class (STL2)', value: 'STL2' },
                { label: 'Special Delivery 9am (SD1)', value: 'SD1' },
                { label: 'Special Delivery 1pm (SD2)', value: 'SD2' },
              ]}
              value={formData.service_code}
              onChange={(v) => setFormData({ ...formData, service_code: v })}
            />
            <FormLayout.Group>
              <TextField
                label="Max Weight (grams)"
                type="number"
                value={formData.max_weight_grams}
                onChange={(v) => setFormData({ ...formData, max_weight_grams: v })}
                suffix="g"
                autoComplete="off"
              />
              <TextField
                label="Base Cost"
                type="number"
                value={formData.base_cost_pence}
                onChange={(v) => setFormData({ ...formData, base_cost_pence: v })}
                prefix="£"
                autoComplete="off"
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Max Length (cm)"
                type="number"
                value={formData.max_length_cm}
                onChange={(v) => setFormData({ ...formData, max_length_cm: v })}
                suffix="cm"
                autoComplete="off"
              />
              <TextField
                label="Max Width (cm)"
                type="number"
                value={formData.max_width_cm}
                onChange={(v) => setFormData({ ...formData, max_width_cm: v })}
                suffix="cm"
                autoComplete="off"
              />
              <TextField
                label="Max Height (cm)"
                type="number"
                value={formData.max_height_cm}
                onChange={(v) => setFormData({ ...formData, max_height_cm: v })}
                suffix="cm"
                autoComplete="off"
              />
            </FormLayout.Group>
            <Checkbox
              label="Rule is active"
              checked={formData.is_active}
              onChange={(v) => setFormData({ ...formData, is_active: v })}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Card>
  );
}

/**
 * Demand Model Management Card
 */
function DemandModelCard() {
  const [modelStatus, setModelStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const loadModelData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, historyData] = await Promise.all([
        getDemandModelStatus(),
        getDemandModelHistory(5),
      ]);
      setModelStatus(statusData);
      setHistory(historyData.runs || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load demand model data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModelData();
  }, [loadModelData]);

  const handleTrainModel = async () => {
    if (!confirm('Train a new demand model? This may take up to 2 minutes.')) return;

    setTraining(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await trainDemandModel();
      setSuccess(`Model trained successfully! MAE: ${result.model?.metrics?.holdout_mae?.toFixed(3) || 'N/A'}`);
      loadModelData(); // Refresh data
    } catch (err) {
      setError(err.message || 'Failed to train demand model');
    } finally {
      setTraining(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd">Demand Prediction Model</Text>
            <Text variant="bodySm" tone="subdued">
              ML model that predicts daily sales from Keepa market signals (rank, offers, price).
            </Text>
          </BlockStack>
          <Button
            variant="primary"
            onClick={handleTrainModel}
            loading={training}
            disabled={loading}
          >
            Train New Model
          </Button>
        </InlineStack>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {success && (
          <Banner tone="success" onDismiss={() => setSuccess(null)}>
            <p>{success}</p>
          </Banner>
        )}

        <Divider />

        {loading ? (
          <Text tone="subdued">Loading model status...</Text>
        ) : modelStatus?.active ? (
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodyMd" fontWeight="semibold">Current Active Model</Text>
              <Badge tone="success">Active</Badge>
            </InlineStack>

            <BlockStack gap="200">
              <InlineStack gap="400" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Model Name</Text>
                  <Text variant="bodyMd">{modelStatus.model?.model_name || '-'}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Trained</Text>
                  <Text variant="bodyMd">{formatDate(modelStatus.model?.trained_at)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Training Period</Text>
                  <Text variant="bodyMd">{modelStatus.model?.lookback_days || '-'} days</Text>
                </BlockStack>
              </InlineStack>

              {modelStatus.model?.training_summary && (
                <InlineStack gap="400" wrap>
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Training ASINs</Text>
                    <Text variant="bodyMd">{modelStatus.model.training_summary.rows_total?.toLocaleString() || '-'}</Text>
                  </BlockStack>
                </InlineStack>
              )}

              {modelStatus.model?.metrics && (
                <>
                  <Divider />
                  <Text variant="bodyMd" fontWeight="semibold">Model Performance</Text>
                  <InlineStack gap="400" wrap>
                    {modelStatus.model.metrics.holdout_mae != null && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">MAE (units/day)</Text>
                        <Text variant="bodyMd">{modelStatus.model.metrics.holdout_mae.toFixed(3)}</Text>
                      </BlockStack>
                    )}
                    {modelStatus.model.metrics.holdout_r2_log != null && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">R² (log scale)</Text>
                        <Text variant="bodyMd">{modelStatus.model.metrics.holdout_r2_log.toFixed(3)}</Text>
                      </BlockStack>
                    )}
                    {modelStatus.model.metrics.holdout_count != null && (
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">Holdout Size</Text>
                        <Text variant="bodyMd">{modelStatus.model.metrics.holdout_count}</Text>
                      </BlockStack>
                    )}
                  </InlineStack>
                </>
              )}

              {modelStatus.model?.coefficients && (
                <>
                  <Divider />
                  <Text variant="bodyMd" fontWeight="semibold">Model Coefficients</Text>
                  <Text variant="bodySm" tone="subdued">
                    ln(units/day) = {modelStatus.model.coefficients.intercept?.toFixed(3)}
                    + {modelStatus.model.coefficients.ln_rank?.toFixed(3)} × ln(rank)
                    + {modelStatus.model.coefficients.ln_offer?.toFixed(3)} × ln(offers)
                    + {modelStatus.model.coefficients.ln_price?.toFixed(3)} × ln(price)
                  </Text>
                </>
              )}
            </BlockStack>
          </BlockStack>
        ) : (
          <Banner tone="warning">
            <p>No demand model is currently active. Train a model to enable demand predictions in the ASIN Analyzer.</p>
          </Banner>
        )}

        {history.length > 0 && (
          <>
            <Divider />
            <Text variant="bodyMd" fontWeight="semibold">Training History</Text>
            <BlockStack gap="200">
              {history.map((run) => (
                <Card key={run.id}>
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text variant="bodySm">{formatDate(run.trained_at)}</Text>
                      {run.is_active && <Badge tone="success" size="small">Active</Badge>}
                    </InlineStack>
                    <InlineStack gap="300" wrap>
                      <Text variant="bodySm" tone="subdued">
                        {run.training_summary?.rows_total || '?'} ASINs
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        MAE: {run.metrics?.holdout_mae?.toFixed(3) || 'N/A'}
                      </Text>
                    </InlineStack>
                  </InlineStack>
                </Card>
              ))}
            </BlockStack>
          </>
        )}

        <Divider />
        <Text variant="bodySm" tone="subdued">
          The model is used in ASIN Analyzer to predict units/day based on Keepa data.
          Training is automatic (daily) but can be triggered manually above.
        </Text>
      </BlockStack>
    </Card>
  );
}

/**
 * Data Management Card
 */
function DataManagementCard() {
  const { deletePreference, isLoggedIn } = useUserPreferences();
  const [clearing, setClearing] = useState(false);
  const [resettingBoms, setResettingBoms] = useState(false);
  const [bomResetResult, setBomResetResult] = useState(null);

  const handleClearPreferences = async () => {
    const message = isLoggedIn
      ? 'This will clear all preferences (custom tabs, defaults) from your account and this browser. Continue?'
      : 'This will clear all local preferences (custom tabs, defaults). Continue?';

    if (!confirm(message)) return;
    setClearing(true);

    try {
      // Delete from server (if logged in) and localStorage
      await deletePreference('inventory_custom_tabs');
      await deletePreference('listings_custom_tabs');
      await deletePreference('amazon_hub_defaults');

      // Also clear localStorage directly for immediate effect
      localStorage.removeItem('inventory_custom_tabs');
      localStorage.removeItem('listings_custom_tabs');
      localStorage.removeItem('amazon_hub_defaults');

      setTimeout(() => {
        setClearing(false);
        window.location.reload();
      }, 500);
    } catch (err) {
      console.error('Failed to clear preferences:', err);
      setClearing(false);
      // Still try to reload to clear what we can
      window.location.reload();
    }
  };

  const handleResetAllBoms = async () => {
    const message =
      'WARNING: This will clear ALL BOM assignments from every listing.\n\n' +
      'All listings will be flagged for BOM review. This action cannot be undone.\n\n' +
      'Are you sure you want to continue?';

    if (!confirm(message)) return;

    // Double confirmation for safety
    const confirmText = prompt(
      'Type "RESET ALL BOMS" to confirm this action:'
    );
    if (confirmText !== 'RESET ALL BOMS') {
      alert('Reset cancelled - confirmation text did not match.');
      return;
    }

    setResettingBoms(true);
    setBomResetResult(null);

    try {
      const result = await resetAllBomAssignments();
      setBomResetResult({
        success: true,
        message: `Successfully reset ${result.affected || 'all'} BOM assignments. All listings are now flagged for review.`,
      });
    } catch (err) {
      console.error('Failed to reset BOM assignments:', err);
      setBomResetResult({
        success: false,
        message: err.message || 'Failed to reset BOM assignments. Check console for details.',
      });
    } finally {
      setResettingBoms(false);
    }
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd">Data Management</Text>
        <Divider />

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="bodyMd" fontWeight="semibold">Clear User Preferences</Text>
              <Text variant="bodySm" tone="subdued">
                {isLoggedIn
                  ? 'Resets custom tabs, default settings, and other synced preferences from your account.'
                  : 'Resets custom tabs, default settings, and other browser-stored preferences.'}
              </Text>
            </BlockStack>
            <Button
              tone="critical"
              onClick={handleClearPreferences}
              loading={clearing}
            >
              Clear Preferences
            </Button>
          </InlineStack>

          <Divider />

          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="bodyMd" fontWeight="semibold">Reset All BOM Assignments</Text>
              <Text variant="bodySm" tone="subdued">
                Clears all BOM assignments from every listing, flagging them for manual review.
                Use this to start fresh with BOM assignments.
              </Text>
            </BlockStack>
            <Button
              tone="critical"
              onClick={handleResetAllBoms}
              loading={resettingBoms}
            >
              Reset All BOMs
            </Button>
          </InlineStack>

          {bomResetResult && (
            <Banner
              tone={bomResetResult.success ? 'success' : 'critical'}
              onDismiss={() => setBomResetResult(null)}
            >
              {bomResetResult.message}
            </Banner>
          )}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

/**
 * SettingsPage - System settings and configuration
 */
export default function SettingsPage() {
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = [
    { id: 'health', content: 'System Health' },
    { id: 'demand', content: 'Demand Model' },
    { id: 'defaults', content: 'Defaults' },
    { id: 'shipping', content: 'Shipping Rules' },
    { id: 'data', content: 'Data' },
  ];

  return (
    <Page
      title="Settings"
      subtitle="System configuration and health monitoring"
    >
      <Layout>
        <Layout.Section>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted>
            {selectedTab === 0 && <SystemHealthPanel />}
            {selectedTab === 1 && <DemandModelCard />}
            {selectedTab === 2 && <DefaultSettingsCard />}
            {selectedTab === 3 && <ShippingRulesCard />}
            {selectedTab === 4 && <DataManagementCard />}
          </Tabs>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
