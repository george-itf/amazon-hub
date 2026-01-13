import React, { useEffect, useState } from 'react';
import { Page, Layout, Card, DataTable, Spinner, TextField, Select, Button, FormLayout } from '@shopify/polaris';
import { getListings, createListing, getBoms } from '../utils/api.jsx';

/**
 * ListingsPage lists all entries in the listing memory and allows
 * creation of new mappings from ASIN/SKU/title fingerprints to BOMs.
 */
export default function ListingsPage() {
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState([]);
  const [boms, setBoms] = useState([]);
  const [form, setForm] = useState({ asin: '', sku: '', title: '', bom_id: '' });
  const [creating, setCreating] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const [listingData, bomData] = await Promise.all([getListings(), getBoms()]);
      setListings(listingData.listings || []);
      setBoms(bomData.boms || []);
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
  async function handleCreate() {
    setCreating(true);
    try {
      const payload = {
        asin: form.asin || null,
        sku: form.sku || null,
        title: form.title || null,
        bom_id: form.bom_id || null
      };
      await createListing(payload);
      setForm({ asin: '', sku: '', title: '', bom_id: '' });
      await load();
    } catch (err) {
      alert(`Create failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  }
  const rows = listings.map((l) => [l.asin || '', l.sku || '', l.title_fingerprint || '', l.bom_id || '']);
  const bomOptions = [
    { label: '— Select BOM —', value: '' },
    ...boms.map((b) => ({ label: `${b.bundle_sku} (${b.description})`, value: b.id }))
  ];
  return (
    <Page title="Listings">
      <Layout>
        <Layout.Section oneThird>
          <Card title="Add Listing" sectioned>
            <FormLayout>
              <TextField label="ASIN" value={form.asin} onChange={handleChange('asin')} />
              <TextField label="SKU" value={form.sku} onChange={handleChange('sku')} />
              <TextField label="Title" value={form.title} onChange={handleChange('title')} />
              <Select label="BOM" options={bomOptions} value={form.bom_id} onChange={handleChange('bom_id')} />
              <Button primary onClick={handleCreate} loading={creating} disabled={!form.bom_id}>Create</Button>
            </FormLayout>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card title="Listings">
            {loading ? (
              <Spinner accessibilityLabel="Loading listings" size="large" />
            ) : (
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text']}
                headings={['ASIN', 'SKU', 'Title fingerprint', 'BOM ID']}
                rows={rows}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}