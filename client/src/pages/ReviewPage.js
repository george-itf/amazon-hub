import React, { useEffect, useState } from 'react';
import { Page, Card, DataTable, Spinner, Select, TextField, Button, FormLayout, Modal, Stack } from '@shopify/polaris';
import { getReviewQueue, getBoms, resolveReview } from '../utils/api.js';

/**
 * ReviewPage displays the current items in the review queue and lets
 * the user resolve each one by selecting a BOM and optionally
 * overriding the ASIN/SKU/Title.  When resolved the item is removed
 * from the queue and a listing memory entry is created.
 */
export default function ReviewPage() {
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState([]);
  const [boms, setBoms] = useState([]);
  const [resolveState, setResolveState] = useState({ open: false, item: null, bom_id: '', asin: '', sku: '', title: '' });
  async function load() {
    setLoading(true);
    try {
      const [queueData, bomData] = await Promise.all([getReviewQueue(), getBoms()]);
      setQueue(queueData);
      setBoms(bomData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  function openResolve(item) {
    setResolveState({ open: true, item, bom_id: '', asin: item.asin || '', sku: item.sku || '', title: item.title || '' });
  }
  function closeResolve() {
    setResolveState({ open: false, item: null, bom_id: '', asin: '', sku: '', title: '' });
  }
  const bomOptions = [
    { label: '— Select BOM —', value: '' },
    ...boms.map((b) => ({ label: `${b.bundle_sku} (${b.description})`, value: b.id }))
  ];
  async function handleResolve() {
    try {
      await resolveReview(resolveState.item.id, {
        bom_id: resolveState.bom_id,
        asin: resolveState.asin || null,
        sku: resolveState.sku || null,
        title: resolveState.title || null
      });
      closeResolve();
      await load();
    } catch (err) {
      alert(`Resolve failed: ${err.message}`);
    }
  }
  const rows = queue.map((item) => [
    item.asin || '',
    item.sku || '',
    item.title || '',
    item.reason || '',
    // Resolve button cell
    <Button size="slim" onClick={() => openResolve(item)}>Resolve</Button>
  ]);
  return (
    <Page title="Review">
      <Card>
        {loading ? (
          <Spinner accessibilityLabel="Loading review queue" size="large" />
        ) : queue.length === 0 ? (
          <p style={{ padding: '16px' }}>No items in review queue.</p>
        ) : (
          <DataTable
            columnContentTypes={['text', 'text', 'text', 'text', 'numeric']}
            headings={['ASIN', 'SKU', 'Title', 'Reason', 'Actions']}
            rows={rows}
          />
        )}
      </Card>
      <Modal
        open={resolveState.open}
        onClose={closeResolve}
        title="Resolve listing"
        primaryAction={{ content: 'Resolve', onAction: handleResolve, disabled: !resolveState.bom_id }}
        secondaryActions={[{ content: 'Cancel', onAction: closeResolve }]}
      >
        {resolveState.item && (
          <Modal.Section>
            <Stack vertical>
              <Select
                label="BOM"
                options={bomOptions}
                value={resolveState.bom_id}
                onChange={(value) => setResolveState((prev) => ({ ...prev, bom_id: value }))}
              />
              <TextField
                label="ASIN"
                value={resolveState.asin}
                onChange={(value) => setResolveState((prev) => ({ ...prev, asin: value }))}
              />
              <TextField
                label="SKU"
                value={resolveState.sku}
                onChange={(value) => setResolveState((prev) => ({ ...prev, sku: value }))}
              />
              <TextField
                label="Title"
                value={resolveState.title}
                onChange={(value) => setResolveState((prev) => ({ ...prev, title: value }))}
              />
            </Stack>
          </Modal.Section>
        )}
      </Modal>
    </Page>
  );
}