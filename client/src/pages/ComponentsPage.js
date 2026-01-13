import React, { useEffect, useState } from 'react';
import { Page, Layout, Card, DataTable, TextField, Button, FormLayout, Spinner } from '@shopify/polaris';
import { getComponents, createComponent } from '../utils/api.js';

/**
 * ComponentsPage lists all components and provides a simple form to
 * create new ones.  After creation the list refreshes.  In a more
 * complete system you would also allow editing and deleting.
 */
export default function ComponentsPage() {
  const [loading, setLoading] = useState(true);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({ internal_sku: '', description: '', brand: '', cost_ex_vat: '' });
  const [creating, setCreating] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const data = await getComponents();
      setComponents(data);
    } catch (err) {
      console.error(err);
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
    try {
      // Convert cost to number
      const cost = form.cost_ex_vat ? parseFloat(form.cost_ex_vat) : null;
      await createComponent({ ...form, cost_ex_vat: cost });
      setForm({ internal_sku: '', description: '', brand: '', cost_ex_vat: '' });
      await load();
    } catch (err) {
      alert(`Create failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }
  const rows = components.map((c) => [c.internal_sku, c.description || '', c.brand || '', c.cost_ex_vat ?? '']);
  return (
    <Page title="Components">
      <Layout>
        <Layout.Section oneThird>
          <Card title="Add Component" sectioned>
            <FormLayout>
              <TextField
                label="Internal SKU"
                value={form.internal_sku}
                onChange={handleChange('internal_sku')}
              />
              <TextField
                label="Description"
                value={form.description}
                onChange={handleChange('description')}
              />
              <TextField
                label="Brand"
                value={form.brand}
                onChange={handleChange('brand')}
              />
              <TextField
                label="Cost ex VAT"
                value={form.cost_ex_vat}
                type="number"
                onChange={handleChange('cost_ex_vat')}
              />
              <Button primary onClick={handleSubmit} loading={creating} disabled={!form.internal_sku}>Create</Button>
            </FormLayout>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card title="Components">
            {loading ? (
              <Spinner accessibilityLabel="Loading components" size="large" />
            ) : (
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'numeric']}
                headings={['SKU', 'Description', 'Brand', 'Cost ex VAT']}
                rows={rows}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}