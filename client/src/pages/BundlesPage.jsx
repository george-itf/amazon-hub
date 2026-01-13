import React, { useEffect, useState } from 'react';
import { Page, Layout, Card, DataTable, Spinner, TextField, FormLayout, Button } from '@shopify/polaris';
import { getBoms, createBom, getComponents } from '../utils/api.jsx';

/**
 * BundlesPage lists all bundles/BOMs with their component lines and
 * provides a form to create new ones.  The form allows entering a
 * bundle SKU and description and specifying quantities for each
 * component.  Only components with a quantity > 0 are included in
 * the BOM.
 */
export default function BundlesPage() {
  const [loading, setLoading] = useState(true);
  const [boms, setBoms] = useState([]);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({ bundle_sku: '', description: '', componentQuantities: {} });
  const [creating, setCreating] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const [bomData, compData] = await Promise.all([getBoms(), getComponents()]);
      setBoms(bomData);
      setComponents(compData);
    } catch (err) {
      console.error(err);
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
    return (value) => setForm((prev) => ({
      ...prev,
      componentQuantities: { ...prev.componentQuantities, [componentId]: value }
    }));
  }
  async function handleCreate() {
    setCreating(true);
    try {
      const componentsList = Object.entries(form.componentQuantities)
        .filter(([_, qty]) => parseInt(qty) > 0)
        .map(([component_id, qty_required]) => ({ component_id, qty_required: parseInt(qty_required) }));
      await createBom({ bundle_sku: form.bundle_sku, description: form.description, components: componentsList });
      setForm({ bundle_sku: '', description: '', componentQuantities: {} });
      await load();
    } catch (err) {
      alert(`Create failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }
  // Prepare rows for the BOM table
  const rows = boms.map((bom) => {
    const compList = bom.bom_components
      .map((c) => {
        const comp = components.find((co) => co.id === c.component_id);
        return `${comp?.internal_sku || c.component_id} (x${c.qty_required})`;
      })
      .join(', ');
    return [bom.bundle_sku, bom.description || '', compList];
  });
  return (
    <Page title="Bundles">
      <Layout>
        <Layout.Section oneThird>
          <Card title="Add Bundle" sectioned>
            <FormLayout>
              <TextField
                label="Bundle SKU"
                value={form.bundle_sku}
                onChange={handleFormChange('bundle_sku')}
              />
              <TextField
                label="Description"
                value={form.description}
                onChange={handleFormChange('description')}
              />
              <p>Select quantities for each component:</p>
              {components.map((c) => (
                <TextField
                  key={c.id}
                  label={`${c.internal_sku} (${c.description})`}
                  type="number"
                  value={form.componentQuantities[c.id] || ''}
                  onChange={handleQuantityChange(c.id)}
                />
              ))}
              <Button primary onClick={handleCreate} loading={creating} disabled={!form.bundle_sku}>Create</Button>
            </FormLayout>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card title="Bundles">
            {loading ? (
              <Spinner accessibilityLabel="Loading bundles" size="large" />
            ) : (
              <DataTable
                columnContentTypes={['text', 'text', 'text']}
                headings={['Bundle SKU', 'Description', 'Components']}
                rows={rows}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}