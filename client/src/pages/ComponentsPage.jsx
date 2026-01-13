import React, { useEffect, useState } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  TextField,
  Button,
  FormLayout,
  Spinner,
  Banner,
  Text,
  BlockStack,
  Badge,
} from '@shopify/polaris';
import { getComponents, createComponent } from '../utils/api.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * ComponentsPage lists all components and provides a simple form to
 * create new ones. Shows stock levels and allows creating inventory items.
 */
export default function ComponentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({ internal_sku: '', description: '', brand: '', cost_ex_vat_pence: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getComponents();
      setComponents(data.components || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load components');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleChange(field) {
    return (value) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    setCreating(true);
    setCreateError(null);
    try {
      // Convert cost to pence
      const costPence = form.cost_ex_vat_pence ? Math.round(parseFloat(form.cost_ex_vat_pence) * 100) : null;
      await createComponent({
        internal_sku: form.internal_sku,
        description: form.description,
        brand: form.brand,
        cost_ex_vat_pence: costPence,
      });
      setForm({ internal_sku: '', description: '', brand: '', cost_ex_vat_pence: '' });
      await load();
    } catch (err) {
      setCreateError(err.message || 'Failed to create component');
    } finally {
      setCreating(false);
    }
  }

  function getStockBadge(available) {
    if (available === undefined || available === null) {
      return <Badge tone="default">No stock data</Badge>;
    }
    if (available <= 0) {
      return <Badge tone="critical">Out of stock</Badge>;
    }
    if (available < 10) {
      return <Badge tone="warning">Low: {available}</Badge>;
    }
    return <Badge tone="success">{available} available</Badge>;
  }

  const rows = components.map((c) => [
    <Text variant="bodyMd" fontWeight="semibold" key={c.id}>
      {c.internal_sku}
    </Text>,
    c.description || '-',
    c.brand || '-',
    formatPrice(c.cost_ex_vat_pence),
    getStockBadge(c.total_available),
  ]);

  return (
    <Page
      title="Components"
      subtitle="Manage individual parts and components"
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Add Component</Text>

              {createError && (
                <Banner tone="critical" onDismiss={() => setCreateError(null)}>
                  <p>{createError}</p>
                </Banner>
              )}

              <FormLayout>
                <TextField
                  label="Internal SKU"
                  value={form.internal_sku}
                  onChange={handleChange('internal_sku')}
                  placeholder="e.g., INV-SCRW-001"
                  helpText="Unique identifier for this component"
                  autoComplete="off"
                />
                <TextField
                  label="Description"
                  value={form.description}
                  onChange={handleChange('description')}
                  placeholder="e.g., M6 x 20mm Hex Bolt"
                />
                <TextField
                  label="Brand"
                  value={form.brand}
                  onChange={handleChange('brand')}
                  placeholder="e.g., Invicta"
                />
                <TextField
                  label="Cost ex VAT (£)"
                  value={form.cost_ex_vat_pence}
                  type="number"
                  onChange={handleChange('cost_ex_vat_pence')}
                  placeholder="0.00"
                  prefix="£"
                  step="0.01"
                />
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  loading={creating}
                  disabled={!form.internal_sku}
                >
                  Create Component
                </Button>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            <Card>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner accessibilityLabel="Loading components" size="large" />
                </div>
              ) : components.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No components yet</Text>
                    <Text tone="subdued">
                      Create your first component using the form on the left.
                    </Text>
                  </BlockStack>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'text']}
                  headings={['SKU', 'Description', 'Brand', 'Cost', 'Stock']}
                  rows={rows}
                  footerContent={`${components.length} component(s)`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
