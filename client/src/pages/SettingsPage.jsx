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
} from '../utils/api.jsx';

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
  // These would be persisted to localStorage or a backend config endpoint
  const [defaults, setDefaults] = useState(() => {
    try {
      const saved = localStorage.getItem('amazon_hub_defaults');
      return saved ? JSON.parse(saved) : {
        min_margin: '10',
        target_margin: '15',
        horizon_days: '14',
        default_service_code: 'CRL1',
      };
    } catch { return { min_margin: '10', target_margin: '15', horizon_days: '14', default_service_code: 'CRL1' }; }
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('amazon_hub_defaults', JSON.stringify(defaults));
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
 * Data Management Card
 */
function DataManagementCard() {
  const [clearing, setClearing] = useState(false);

  const handleClearLocalStorage = () => {
    if (!confirm('This will clear all local preferences (custom tabs, defaults). Continue?')) return;
    setClearing(true);

    // Clear specific keys, not everything
    localStorage.removeItem('inventory_custom_tabs');
    localStorage.removeItem('listings_custom_tabs');
    localStorage.removeItem('amazon_hub_defaults');

    setTimeout(() => {
      setClearing(false);
      window.location.reload();
    }, 500);
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd">Data Management</Text>
        <Divider />

        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="bodyMd" fontWeight="semibold">Clear Local Preferences</Text>
              <Text variant="bodySm" tone="subdued">
                Resets custom tabs, default settings, and other browser-stored preferences.
              </Text>
            </BlockStack>
            <Button
              tone="critical"
              onClick={handleClearLocalStorage}
              loading={clearing}
            >
              Clear Preferences
            </Button>
          </InlineStack>
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
            {selectedTab === 1 && <DefaultSettingsCard />}
            {selectedTab === 2 && <ShippingRulesCard />}
            {selectedTab === 3 && <DataManagementCard />}
          </Tabs>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
