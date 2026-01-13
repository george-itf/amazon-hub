import React, { useEffect, useState } from 'react';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  TextField,
  FormLayout,
  Button,
  Banner,
  Text,
  BlockStack,
  Badge,
} from '@shopify/polaris';
import { getBoms, createBom, getComponents } from '../utils/api.jsx';

/**
 * BundlesPage lists all bundles/BOMs with their component lines and
 * provides a form to create new ones. BOMs define what components
 * make up a sellable product.
 */
export default function BundlesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [boms, setBoms] = useState([]);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({ bundle_sku: '', description: '', componentQuantities: {} });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [bomData, compData] = await Promise.all([getBoms(), getComponents()]);
      setBoms(bomData.boms || []);
      setComponents(compData.components || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load BOMs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleFormChange(field) {
    return (value) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleQuantityChange(componentId) {
    return (value) =>
      setForm((prev) => ({
        ...prev,
        componentQuantities: { ...prev.componentQuantities, [componentId]: value },
      }));
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const componentsList = Object.entries(form.componentQuantities)
        .filter(([_, qty]) => {
          const parsed = parseInt(qty);
          return !isNaN(parsed) && parsed > 0;
        })
        .map(([component_id, qty_required]) => ({
          component_id,
          qty_required: parseInt(qty_required),
        }));

      if (componentsList.length === 0) {
        setCreateError('Please add at least one component with quantity > 0');
        setCreating(false);
        return;
      }

      await createBom({
        bundle_sku: form.bundle_sku,
        description: form.description,
        components: componentsList,
      });
      setForm({ bundle_sku: '', description: '', componentQuantities: {} });
      await load();
    } catch (err) {
      setCreateError(err.message || 'Failed to create BOM');
    } finally {
      setCreating(false);
    }
  }

  // Count selected components
  const selectedCount = Object.values(form.componentQuantities).filter(
    (qty) => parseInt(qty) > 0
  ).length;

  // Prepare rows for the BOM table
  const rows = boms.map((bom) => {
    const compList =
      bom.bom_components?.map((bc) => {
        const comp = bc.components || components.find((c) => c.id === bc.component_id);
        return `${comp?.internal_sku || 'Unknown'} ×${bc.qty_required}`;
      }) || [];

    return [
      <Text variant="bodyMd" fontWeight="semibold" key={bom.id}>
        {bom.bundle_sku}
      </Text>,
      bom.description || '-',
      <BlockStack gap="100" key={`comp-${bom.id}`}>
        {compList.length > 0 ? (
          compList.map((c, i) => (
            <Badge key={i} tone="info">
              {c}
            </Badge>
          ))
        ) : (
          <Text tone="subdued">No components</Text>
        )}
      </BlockStack>,
      bom.is_active ? (
        <Badge tone="success">Active</Badge>
      ) : (
        <Badge tone="default">Inactive</Badge>
      ),
    ];
  });

  return (
    <Page
      title="BOMs / Bundles"
      subtitle="Define product compositions"
      secondaryActions={[{ content: 'Refresh', onAction: load }]}
    >
      <Layout>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Create BOM</Text>

              {createError && (
                <Banner tone="critical" onDismiss={() => setCreateError(null)}>
                  <p>{createError}</p>
                </Banner>
              )}

              <FormLayout>
                <TextField
                  label="Bundle SKU"
                  value={form.bundle_sku}
                  onChange={handleFormChange('bundle_sku')}
                  placeholder="e.g., BUNDLE-STARTER-KIT"
                  helpText="Unique identifier for this bundle"
                  autoComplete="off"
                />
                <TextField
                  label="Description"
                  value={form.description}
                  onChange={handleFormChange('description')}
                  placeholder="e.g., Starter Tool Kit"
                />

                <Text variant="headingSm">Components ({selectedCount} selected)</Text>

                {components.length === 0 ? (
                  <Banner tone="warning">
                    <p>No components available. Create components first.</p>
                  </Banner>
                ) : (
                  <BlockStack gap="200">
                    {components.map((c) => (
                      <TextField
                        key={c.id}
                        label={c.internal_sku}
                        labelHidden={false}
                        type="number"
                        min="0"
                        value={form.componentQuantities[c.id] || ''}
                        onChange={handleQuantityChange(c.id)}
                        placeholder="0"
                        prefix="×"
                        helpText={c.description || undefined}
                        connectedLeft={
                          <div style={{ padding: '8px', minWidth: '60px' }}>
                            <Text variant="bodySm" tone="subdued">
                              Qty
                            </Text>
                          </div>
                        }
                      />
                    ))}
                  </BlockStack>
                )}

                <Button
                  variant="primary"
                  onClick={handleCreate}
                  loading={creating}
                  disabled={!form.bundle_sku || components.length === 0}
                >
                  Create BOM
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
                  <Spinner accessibilityLabel="Loading BOMs" size="large" />
                </div>
              ) : boms.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text variant="headingMd">No BOMs yet</Text>
                    <Text tone="subdued">
                      Create your first Bill of Materials using the form. BOMs define what
                      components make up each product you sell.
                    </Text>
                  </BlockStack>
                </div>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text']}
                  headings={['Bundle SKU', 'Description', 'Components', 'Status']}
                  rows={rows}
                  footerContent={`${boms.length} BOM(s)`}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
